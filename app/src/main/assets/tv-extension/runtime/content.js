// TV WebExtension Content Script Dispatcher
(function() {
    // Only run in top-level window, not in iframes
    if (window !== window.top) {
        return;
    }

    if (window.__tvContentScriptInjected) {
        console.log("[TV-Extension] Content script already initialized on:", window.location.href);
        return;
    }
    window.__tvContentScriptInjected = true;
    console.log("[TV-Extension] Content script injected on:", window.location.href);

    let activeAdapter = null;

    function ensureAdapter() {
        if (!activeAdapter && window.TvAdapterRegistry) {
            activeAdapter = window.TvAdapterRegistry.getActiveAdapter();
            if (activeAdapter && activeAdapter.init) {
                activeAdapter.init();
            }
        }
        return activeAdapter;
    }

    ensureAdapter();

    window.addEventListener("pagehide", () => {
        if (activeAdapter && activeAdapter.unmount) activeAdapter.unmount();
    });
    window.addEventListener("pageshow", event => {
        if (event.persisted && activeAdapter && activeAdapter.init) activeAdapter.init();
    });

    // Announce readiness to background script
    try {
        browser.runtime.sendMessage({
            event: "content_ready",
            url: window.location.href,
            title: document.title
        }).catch(() => {});
    } catch (e) {}

    // Listen for incoming commands from background script (from Android Native Messaging)
    browser.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.command === "writePrepare") return undefined;
        console.log("[TV-Extension] Content script received command:", JSON.stringify(request));
        const adapter = ensureAdapter();

        if (!adapter) {
            console.warn("[TV-Extension] No active adapter for this page.");
            if (request.command === "back") {
                return Promise.resolve({ event: "backResult", handled: false });
            }
            return Promise.resolve({ event: "error", message: "No adapter" });
        }

        const cmd = request.command;
        if(cmd==='readerAction' && /^\/[^/]+\/status\/\d+$/.test(request.path)) {
            if(window.TvXReaderBrowser?.path===request.path && window.TvXReaderBrowser.action===request.action && window.TvXReaderBrowser.announced) {
                browser.runtime.sendMessage({event:'reader_browser_ready',path:request.path}).catch(()=>{});
                return Promise.resolve({event:'ack',command:cmd});
            }
            window.TvXReaderBrowser={path:request.path,action:request.action,announced:false};
            if(location.pathname!==request.path) {
                const link=Array.from(document.querySelectorAll('a[href]')).find(a=>window.TvXPostIdentity?.canonicalPath(a)===request.path);
                if(link)link.click();else location.href='https://x.com'+request.path;
            }
            window.dispatchEvent(new PopStateEvent('popstate'));
            return Promise.resolve({event:'ack',command:cmd});
        }
        if (cmd === "move") {
            adapter.move(request.direction);
            return Promise.resolve({ event: "ack", command: "move" });
        } else if (cmd === "activate") {
            adapter.activate();
            return Promise.resolve({ event: "ack", command: "activate" });
        } else if (cmd === "menu") {
            if (adapter.menu) adapter.menu();
            return Promise.resolve({ event: "ack", command: "menu" });
        } else if (cmd === "back" || cmd === "dismissOverlay") {
            const backResult = adapter.handleBack();
            return Promise.resolve(backResult || { event: "backResult", handled: false });
        } else if (cmd === "restoreLogin") {
            adapter.restoreLogin();
            return Promise.resolve({ event: "ack", command: cmd });
        } else if (cmd === "googleAuth") {
            if (adapter.googleAuth) {
                adapter.googleAuth();
            }
            return Promise.resolve({ event: "ack", command: "googleAuth" });
        } else if (cmd === "getState") {
            adapter.reportState();
            return Promise.resolve({ event: "ack", command: "getState" });
        }

        return Promise.resolve({ event: "unknown_command", command: cmd });
    });
})();
