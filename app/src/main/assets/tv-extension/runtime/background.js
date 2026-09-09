// TV WebExtension Background Script
console.log("[TV-Extension] Background script loaded.");

let nativePort = null;
let reconnectTimer = null;
let activeTabId = null;
let lastPong = 0;

function connectToNative() {
    try {
        console.log("[TV-Extension] Connecting to native port: browser_nav_bridge...");
        nativePort = browser.runtime.connectNative("browser_nav_bridge");

        lastPong = Date.now();
        nativePort.onMessage.addListener((message) => {
            if (message.command === "pong") { lastPong = Date.now(); return; }
            if (message.command === 'writePrepare') { prepareWrite(message); return; }
            console.log("[TV-Extension] Native command:", message.command);
            forwardToActiveTab(message);
        });

        const connectedPort = nativePort;
        nativePort.onDisconnect.addListener((p) => {
            if (nativePort !== connectedPort) return;
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

// Explicit, read-only preparation for a correlated native write. Never forwards a mutation to the page.
async function prepareWrite(message) {
    const port = nativePort;
    if (!/^[a-f0-9-]{36}$/.test(message.id || '') ||
        !['FavoriteTweet','UnfavoriteTweet','CreateTweet'].includes(message.operation)) return;
    let result = {error:'not_ready'};
    try {
        const tabs = (await browser.tabs.query({})).filter(t => {
            try { return new URL(t.url).origin === 'https://x.com'; } catch (_) { return false; }
        });
        const tab = tabs.find(t => new URL(t.url).pathname === '/home') || tabs[0];
        if (tab) result = await browser.tabs.sendMessage(tab.id,
            {command:'writePrepare',operation:message.operation}, {frameId:0});
    } catch (_) {}
    if (nativePort === port && port) port.postMessage({event:'write_metadata',id:message.id,result:result || {error:'not_ready'}});
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
        console.warn("[TV-Extension] Native port unavailable for event:", msg.event);
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
    return browser.tabs.executeScript(tabId, { file: "sites/x/write-api.js" })
        .then(() => browser.tabs.executeScript(tabId, { file: "sites/x/bootstrap.js" }))
        .then(() => browser.tabs.executeScript(tabId, { file: "runtime/navigation-runtime.js" }))
        .then(() => browser.tabs.executeScript(tabId, { file: "sites/x/post-identity.js" }))
        .then(() => browser.tabs.executeScript(tabId, { file: "sites/x/reading.js" }))
        .then(() => browser.tabs.executeScript(tabId, { file: "sites/x/detail.js" }))
        .then(() => browser.tabs.executeScript(tabId, { file: "sites/x/card.js" }))
        .then(() => browser.tabs.executeScript(tabId, { file: "sites/x/actions.js" }))
        .then(() => browser.tabs.executeScript(tabId, { file: "sites/x/media.js" }))
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
            // Reinstall listeners, but never replay an ambiguous activate: it
            // might already have clicked a mutating action before failing.
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
    if (["tv_like_arm", "tv_like_disarm"].includes(message.event)) return;
    if (sender?.tab?.active === false) return;
    if (message.event === 'content_ready' && nativePort && sender?.tab) {
        browser.tabs.sendMessage(sender.tab.id, {command:'hostMode'}, {frameId:0}).catch(() => {});
    }
    console.log("[TV-Extension] Received message from content script:", JSON.stringify(message));
    if (sender && sender.tab) {
        activeTabId = sender.tab.id;
    }
    sendToNative(message);
});

// Start initial connection
connectToNative();

// Capture successful read-query templates so native reading can start before Gecko.
// This listener never starts a write or exports session headers outside the app.
if (browser.webRequest?.onBeforeSendHeaders) {
    const requests = new Map();
    const filter = {urls:['https://x.com/i/api/graphql/*'],types:['xmlhttprequest']};
    function operation(details) {
        const url = new URL(details.url);
        return url.hostname === 'x.com' && /^\/i\/api\/graphql\/[^/]+\/(HomeTimeline|HomeLatestTimeline|TweetDetail)$/.test(url.pathname);
    }
    browser.webRequest.onBeforeRequest.addListener(details => {
        if (!operation(details) || !['GET','POST'].includes(details.method)) return;
        const raw=details.requestBody?.raw || [];
        if(raw.reduce((n,x)=>n+(x.bytes?.byteLength||0),0)>200000)return;
        const decoder=new TextDecoder();
        const body=raw.map(x=>decoder.decode(x.bytes,{stream:true})).join('')+decoder.decode();
        while(requests.size>=20)requests.delete(requests.keys().next().value);
        requests.set(details.requestId,{url:details.url,method:details.method,body});
    },filter,['requestBody']);
    browser.webRequest.onBeforeSendHeaders.addListener(details => {
        const request=requests.get(details.requestId);
        if(request)request.headers=details.requestHeaders;
    },filter,['requestHeaders']);
    browser.webRequest.onCompleted.addListener(details => {
        const request=requests.get(details.requestId);requests.delete(details.requestId);
        if(details.statusCode===200 && request?.headers)sendToNative({event:'read_api_template',...request});
    },filter);
    browser.webRequest.onErrorOccurred.addListener(details=>requests.delete(details.requestId),filter);
    browser.webRequest.onBeforeRequest.addListener(()=>sendToNative({event:'read_session_clear'}),
        {urls:['https://x.com/logout*','https://x.com/i/api/1.1/account/logout.json*']});
}

// A surviving background page can retain a port owned by a destroyed Activity.
// A heartbeat detects that half-open connection even without onDisconnect.
setInterval(() => {
    if (nativePort && Date.now() - lastPong > 6000) {
        const stale = nativePort; nativePort = null;
        try { stale.disconnect(); } catch (_) {}
    }
    if (!nativePort) connectToNative();
    sendToNative({event:'ping'});
}, 2000);

// Relax Content-Security-Policy and X-Frame-Options to allow in-app article reading
if (browser.webRequest?.onHeadersReceived) {
    function relaxCSPForFrameSrc(cspValue) {
        if (!cspValue) return "frame-src * data: blob: 'self' https: http:; child-src * data: blob: 'self' https: http:";
        let directives = cspValue.split(';').map(d => d.trim()).filter(Boolean);
        let foundFrameSrc = false;
        let foundChildSrc = false;
        directives = directives.map(dir => {
            if (/^frame-src\b/i.test(dir)) {
                foundFrameSrc = true;
                return "frame-src * data: blob: 'self' https: http:";
            }
            if (/^child-src\b/i.test(dir)) {
                foundChildSrc = true;
                return "child-src * data: blob: 'self' https: http:";
            }
            return dir;
        });
        if (!foundFrameSrc) directives.push("frame-src * data: blob: 'self' https: http:");
        if (!foundChildSrc) directives.push("child-src * data: blob: 'self' https: http:");
        return directives.join('; ');
    }

    function stripFrameAncestors(cspValue) {
        if (!cspValue) return '';
        let directives = cspValue.split(';').map(d => d.trim()).filter(Boolean);
        directives = directives.filter(dir => !/^frame-ancestors\b/i.test(dir));
        return directives.join('; ');
    }

    browser.webRequest.onHeadersReceived.addListener(
        (details) => {
            if (!details.responseHeaders) return;
            let responseHeaders = details.responseHeaders;

            if (details.type === 'main_frame') {
                const url = details.url || '';
                if (url.includes('x.com') || url.includes('twitter.com')) {
                    for (let i = 0; i < responseHeaders.length; i++) {
                        const name = responseHeaders[i].name.toLowerCase();
                        if (name === 'content-security-policy') {
                            responseHeaders[i].value = relaxCSPForFrameSrc(responseHeaders[i].value);
                        }
                    }
                }
            } else if (details.type === 'sub_frame') {
                responseHeaders = responseHeaders.filter(
                    h => h.name.toLowerCase() !== 'x-frame-options'
                );
                for (let i = 0; i < responseHeaders.length; i++) {
                    const name = responseHeaders[i].name.toLowerCase();
                    if (name === 'content-security-policy') {
                        responseHeaders[i].value = stripFrameAncestors(responseHeaders[i].value);
                    }
                }
            }

            return { responseHeaders };
        },
        { urls: ['<all_urls>'], types: ['main_frame', 'sub_frame'] },
        ['blocking', 'responseHeaders']
    );
}
