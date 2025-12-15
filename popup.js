document.getElementById('startBtn').addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
        chrome.tabs.sendMessage(tab.id, { action: "start_scraping" }, (response) => {
            if (chrome.runtime.lastError) {
                document.getElementById('status').textContent = "Error: Please refresh WhatsApp page.";
            }
        });
        document.getElementById('status').textContent = "Starting...";
    }
});

document.getElementById('stopBtn').addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
        chrome.tabs.sendMessage(tab.id, { action: "stop_scraping" });
        document.getElementById('status').textContent = "Stopping...";
    }
});

chrome.runtime.onMessage.addListener((message) => {
    if (message.action === "update_status") {
        document.getElementById('status').textContent = message.status;
    }
});
