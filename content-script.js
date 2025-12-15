let isScraping = false;
let extractedData = [];

// Status Overlay Helper
let statusOverlay = null;

function createStatusOverlay() {
    if (!statusOverlay) {
        statusOverlay = document.createElement('div');
        statusOverlay.style.position = 'fixed';
        statusOverlay.style.top = '10px';
        statusOverlay.style.right = '10px';
        statusOverlay.style.padding = '15px';
        statusOverlay.style.backgroundColor = 'rgba(0, 0, 0, 0.85)';
        statusOverlay.style.color = '#00ff00';
        statusOverlay.style.zIndex = '9999';
        statusOverlay.style.borderRadius = '8px';
        statusOverlay.style.fontFamily = 'Consolas, monospace';
        statusOverlay.style.fontSize = '14px';
        statusOverlay.style.minWidth = '250px';
        statusOverlay.style.maxWidth = '350px';
        statusOverlay.style.whiteSpace = 'pre-wrap';
        statusOverlay.style.boxShadow = '0 4px 6px rgba(0,0,0,0.3)';
        statusOverlay.innerHTML = 'Initializing scraper...';
        document.body.appendChild(statusOverlay);
    }
}

function updateOverlay(text) {
    if (statusOverlay) {
        statusOverlay.innerHTML = text;
    }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "start_scraping") {
        if (!isScraping) {
            isScraping = true;
            scrapeChats();
            sendResponse({ status: "Started" });
        }
    } else if (request.action === "stop_scraping") {
        isScraping = false;
        downloadCSV();
        sendResponse({ status: "Stopped" });
    }
});

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function highlight(element, color = "red") {
    if (element) {
        element.style.border = `3px solid ${color}`;
        setTimeout(() => { element.style.border = "none"; }, 2000);
    }
}

async function scrapeChats() {
    createStatusOverlay();
    updateOverlay("Starting scraping...");
    console.log("Starting scraping...");

    // Find scrollable container (usually #pane-side)
    const chatListContainer = document.querySelector('#pane-side');
    if (!chatListContainer) {
        alert("Could not find chat list container (#pane-side). WhatsApp structure may have changed.");
        return;
    }

    const rowSelector = 'div[role="row"]';
    let consecutiveEmptyScrolls = 0;
    let totalProcessed = 0;

    while (isScraping) {
        // Find all rows currently in DOM
        const rows = Array.from(document.querySelectorAll(rowSelector));

        // Find the first row that hasn't been scraped yet
        // We use a custom attribute 'data-scraped' to track this
        const nextRow = rows.find(r => !r.hasAttribute('data-scraped'));

        if (nextRow) {
            consecutiveEmptyScrolls = 0; // Reset scroll counter

            // Mark as processed immediately so we don't pick it up again
            nextRow.setAttribute('data-scraped', 'true');

            try {
                // Scroll row into view
                nextRow.scrollIntoView({ block: 'center', behavior: 'instant' });
                highlight(nextRow, "blue");

                // Get List Display Name
                let displayName = "Unknown";
                try {
                    const titleEl = nextRow.querySelector('span[title]');
                    if (titleEl) displayName = titleEl.getAttribute('title');
                } catch (e) { }

                updateOverlay(`Chats Found: ${totalProcessed}\nCurrent: ${displayName}\nStep: Opening Chat...`);
                await sleep(800);

                // Click Logic
                ['mousedown', 'mouseup', 'click'].forEach(eventType => {
                    const event = new MouseEvent(eventType, { bubbles: true, cancelable: true, view: window });
                    nextRow.dispatchEvent(event);
                });
                nextRow.click();

                await sleep(2500);

                // --- EXTRACTION LOGIC ---
                let phoneNumber = "";
                let publicName = "";
                let lastMessage = "";

                // Robust Header Search
                const header = document.querySelector('#main header') || document.querySelector('header[data-testid="conversation-header"]');
                if (header) {
                    highlight(header, "orange");
                    let validClick = false;

                    // 1. Try Title
                    if (!validClick) {
                        try {
                            const titleSpan = header.querySelector('span[title]');
                            if (titleSpan) {
                                titleSpan.click();
                                validClick = true;
                                highlight(titleSpan, "red");
                            }
                        } catch (e) { }
                    }
                    // 2. Try Header Click
                    if (!validClick) {
                        header.click();
                        validClick = true;
                    }

                    updateOverlay(`Chats Found: ${totalProcessed}\nCurrent: ${displayName}\nStep: Reading Info...`);

                    // Smart Retry Loop for Sidebar
                    let retry = 0;
                    let found = false;
                    while (retry < 3 && !found) {
                        await sleep(2000 + (retry * 1000));

                        const sidebar = document.querySelector('aside') || document.querySelector('div[contenteditable="false"]')?.closest('aside') || document.querySelector('section');

                        if (sidebar) {
                            highlight(sidebar, "green");
                            const sidebarText = sidebar.innerText;

                            // Name Strategy
                            if (!publicName) {
                                try {
                                    // Deep search for ~
                                    const allSpans = sidebar.getElementsByTagName('span');
                                    for (let s of allSpans) {
                                        const t = s.innerText?.trim();
                                        if (t && t.startsWith('~') && t.length > 1) {
                                            publicName = t;
                                            break;
                                        }
                                    }
                                } catch (e) { }
                            }

                            // Phone Strategy
                            const isPhone = (s) => /^\+?[\d\s\-]+$/.test(s) && s.replace(/\D/g, '').length >= 10;
                            if (!phoneNumber && isPhone(displayName)) phoneNumber = displayName;

                            if (!phoneNumber) {
                                // 1. Scan Text
                                const lines = sidebarText.split('\n');
                                for (let line of lines) {
                                    if (line.trim().startsWith('+') && isPhone(line.trim())) {
                                        phoneNumber = line.trim();
                                        break;
                                    }
                                }
                                // 2. Scan Spans (About)
                                if (!phoneNumber) {
                                    const spans = sidebar.querySelectorAll('span[dir="auto"]');
                                    for (let s of spans) {
                                        if (isPhone(s.innerText)) {
                                            phoneNumber = s.innerText;
                                            break;
                                        }
                                    }
                                }
                            }

                            if (publicName || phoneNumber) found = true;
                        }

                        if (!found) {
                            retry++;
                            updateOverlay(`Chats Found: ${totalProcessed}\nCurrent: ${displayName}\nStep: Retry ${retry}/3...`);
                        }
                    }

                    // Close Sidebar
                    const closeBtn = document.querySelector('div[aria-label="Close"]');
                    if (closeBtn) closeBtn.click();
                    else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
                }

                // Last Message
                try {
                    const lines = nextRow.innerText.split('\n');
                    lastMessage = lines[lines.length - 1];
                } catch (e) { }

                extractedData.push({
                    "Display Name": displayName,
                    "Public Name": publicName,
                    "Phone Number": phoneNumber,
                    "Last Message": lastMessage
                });

                totalProcessed++;
                updateOverlay(`Chats Found: ${totalProcessed}\nLast: ${publicName || displayName}\nPhone: ${phoneNumber}\nStatus: Saved.`);
                await sleep(500);

            } catch (err) {
                console.error("Error processing row", err);
            }

        } else {
            // No new rows found in current view, try scrolling
            updateOverlay(`Chats Found: ${totalProcessed}\nStep: Scrolling for more...`);

            const previousScrollTop = chatListContainer.scrollTop;
            chatListContainer.scrollTop += 600; // Scroll down
            await sleep(2000); // Wait for load

            // Check if we hit bottom (scroll didn't change)
            if (Math.abs(chatListContainer.scrollTop - previousScrollTop) < 5) {
                consecutiveEmptyScrolls++;
                if (consecutiveEmptyScrolls > 2) {
                    updateOverlay(`Finished! Processed ${totalProcessed} chats.\nDownloading...`);
                    break; // End of list
                }
            }
        }
    }

    downloadCSV();
}

function downloadCSV() {
    if (extractedData.length === 0) {
        alert("No data extracted!");
        return;
    }

    const headers = ["Display Name", "Public Name", "Phone Number", "Last Message"];
    const csvContent = [
        headers.join(","),
        ...extractedData.map(row =>
            headers.map(fieldName => `"${(row[fieldName] || '').replace(/"/g, '""')}"`).join(",")
        )
    ].join("\n");

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", "whatsapp_data.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    chrome.runtime.sendMessage({ action: "update_status", status: "Done! Downloading CSV..." });
    setTimeout(() => { if (statusOverlay) statusOverlay.remove(); }, 5000);
}
