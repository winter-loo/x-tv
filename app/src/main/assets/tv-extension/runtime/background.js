// TV WebExtension Background Script
console.log("[TV-Extension] Background script loaded.");

let nativePort = null;
let reconnectTimer = null;
let activeTabId = null;

function connectToNative() {
    try {
        console.log("[TV-Extension] Connecting to native port: browser_nav_bridge...");
        nativePort = browser.runtime.connectNative("browser_nav_bridge");

        nativePort.onMessage.addListener((message) => {
            console.log("[TV-Extension] Native message received:", JSON.stringify(message));
            forwardToActiveTab(message);
        });

        nativePort.onDisconnect.addListener((p) => {
            console.warn("[TV-Extension] Native port disconnected.");
            nativePort = null;
            scheduleReconnect();
        });

        console.log("[TV-Extension] Connected to native port successfully.");
        sendToNative({ event: "ready", timestamp: Date.now() });
    } catch (err) {
        console.error("[TV-Extension] Failed to connect to native port:", err);
        scheduleReconnect();
    }
}

function scheduleReconnect() {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connectToNative();
    }, 2000);
}

function sendToNative(msg) {
    if (nativePort) {
        try {
            nativePort.postMessage(msg);
        } catch (e) {
            console.error("[TV-Extension] Failed to postMessage to native:", e);
        }
    } else {
        console.warn("[TV-Extension] Cannot sendToNative, port is null:", msg);
    }
}

// Track active tab and ensure scripts are injected if needed
browser.tabs.onActivated.addListener((activeInfo) => {
    activeTabId = activeInfo.tabId;
    console.log("[TV-Extension] Active tab switched to:", activeTabId);
});

browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === "complete") {
        activeTabId = tabId;
        console.log("[TV-Extension] Tab " + tabId + " completed loading, injecting scripts if needed...");
        injectContentScripts(tabId);
    }
});

function injectContentScripts(tabId) {
    browser.tabs.executeScript(tabId, { file: "runtime/navigation-runtime.js" })
        .then(() => browser.tabs.executeScript(tabId, { file: "sites/x/reading.js" }))
        .then(() => browser.tabs.executeScript(tabId, { file: "sites/x/post-identity.js" }))
        .then(() => browser.tabs.executeScript(tabId, { file: "sites/x/detail.js" }))
        .then(() => browser.tabs.executeScript(tabId, { file: "sites/x/actions.js" }))
        .then(() => browser.tabs.executeScript(tabId, { file: "sites/x/adapter.js" }))
        .then(() => browser.tabs.executeScript(tabId, { file: "runtime/adapter-registry.js" }))
        .then(() => browser.tabs.executeScript(tabId, { file: "runtime/content.js" }))
        .then(() => console.log("[TV-Extension] Content scripts successfully executed in tab " + tabId))
        .catch((err) => console.log("[TV-Extension] executeScript skipped (already injected or restricted):", err.message));
}

// Forward command from Android host to active web tab
function forwardToActiveTab(cmd) {
    browser.tabs.query({}).then((tabs) => {
        if (!tabs || tabs.length === 0) {
            console.warn("[TV-Extension] No tabs found to forward command.");
            if (cmd.command === "back") {
                sendToNative({ event: "backResult", handled: false });
            }
            return;
        }

        const targetTab = tabs.find(t => t.active) || tabs[0];
        activeTabId = targetTab.id;
        console.log("[TV-Extension] Forwarding command [" + cmd.command + "] to tab id: " + targetTab.id);

        browser.tabs.sendMessage(targetTab.id, cmd, { frameId: 0 }).then((response) => {
            console.log("[TV-Extension] Content script responded:", JSON.stringify(response));
            if (response) {
                sendToNative(response);
            }
        }).catch((err) => {
            console.warn("[TV-Extension] Error sending message to tab " + targetTab.id + ":", err);
            // Attempt injection and retry once
            injectContentScripts(targetTab.id);
            if (cmd.command === "back") {
                sendToNative({ event: "backResult", handled: false });
            }
        });
    }).catch((err) => {
        console.error("[TV-Extension] tabs.query error:", err);
    });
}

// Listen for direct events from content scripts
browser.runtime.onMessage.addListener((message, sender) => {
    if (message.event === "tv_like_arm" || message.event === "tv_like_disarm") return;
    console.log("[TV-Extension] Received message from content script:", JSON.stringify(message));
    if (sender && sender.tab) {
        activeTabId = sender.tab.id;
    }
    sendToNative(message);
});

// Start initial connection
connectToNative();
