// Observe only the native X request armed by a remote action. Never initiate,
// alter or replay an X API request; never retain request headers or response data.
// Firefox StreamFilter passthrough: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/webRequest/filterResponseData
(function() {
    const pending = new Map();
    const requests = new Map();
    const urls = ['https://x.com/i/api/graphql/*/FavoriteTweet', 'https://x.com/i/api/graphql/*/UnfavoriteTweet'];
    const supported = !!browser.webRequest?.filterResponseData;

    function report(action, outcome) {
        browser.tabs.sendMessage(action.tabId, {
            event: 'tv_like_result', token: action.token, postId: action.postId,
            liked: action.liked, outcome
        }, { frameId: 0 }).catch(() => {});
    }

    function finish(action, outcome) {
        if (!pending.has(action.token)) return;
        pending.delete(action.token);
        clearTimeout(action.timer);
        if (action.requestId) requests.delete(action.requestId);
        report(action, outcome);
    }

    browser.runtime.onMessage.addListener((message, sender) => {
        if (message.event === 'tv_like_disarm') {
            const action = pending.get(message.token);
            if (action && action.tabId === sender.tab?.id && sender.frameId === 0 && !action.requestId) {
                clearTimeout(action.timer);
                pending.delete(action.token);
            }
            return Promise.resolve({ cancelled: true });
        }
        if (message.event !== 'tv_like_arm') return;
        if (!supported || sender.frameId !== 0 || !sender.tab ||
            !/^https:\/\/x\.com\//.test(sender.url || '') ||
            !/^\d+$/.test(message.postId || '') || typeof message.liked !== 'boolean' ||
            !/^[\w-]{16,80}$/.test(message.token || '')) return Promise.resolve({ armed: false });
        if (Array.from(pending.values()).some(action => action.tabId === sender.tab.id)) return Promise.resolve({ armed: false });
        const action = { token: message.token, postId: message.postId, liked: message.liked, tabId: sender.tab.id };
        action.timer = setTimeout(() => {
            // A UI timeout does not mean the native network operation has ended.
            // Keep the one-request fence until its stream/error or tab closure.
            if (action.requestId) report(action, 'waiting');
            else finish(action, 'unconfirmed');
        }, 15000);
        pending.set(action.token, action);
        return Promise.resolve({ armed: true });
    });
    if (!supported) return;

    browser.webRequest.onBeforeRequest.addListener(details => {
        if (details.method !== 'POST' || details.frameId !== 0) return;
        const operation = new URL(details.url).pathname.split('/').pop();
        if (operation !== 'FavoriteTweet' && operation !== 'UnfavoriteTweet') return;
        const liked = operation === 'FavoriteTweet';
        let postId;
        try {
            const raw = details.requestBody?.raw;
            if (!raw || raw.reduce((size, part) => size + (part.bytes?.byteLength || 0), 0) > 16384) return;
            const decoder = new TextDecoder();
            const body = raw.map(part => decoder.decode(part.bytes, { stream: true })).join('') + decoder.decode();
            postId = JSON.parse(body).variables?.tweet_id;
        } catch (_) { return; }
        const action = Array.from(pending.values()).find(candidate => !candidate.requestId &&
            candidate.tabId === details.tabId && candidate.postId === postId && candidate.liked === liked);
        if (!action) return;
        action.requestId = details.requestId;
        requests.set(details.requestId, action);
        let filter;
        try { filter = browser.webRequest.filterResponseData(details.requestId); }
        catch (_) { finish(action, 'unconfirmed'); return; }
        let body = '';
        let oversized = false;
        const decoder = new TextDecoder();
        filter.ondata = event => {
            // Always deliver the original bytes, including oversized/unknown responses.
            filter.write(event.data);
            if (!oversized) {
                body += decoder.decode(event.data, { stream: true });
                if (body.length > 65536) { oversized = true; body = ''; }
            }
        };
        filter.onstop = () => {
            filter.close();
            let outcome = 'unconfirmed';
            try {
                const result = oversized ? null : JSON.parse(body + decoder.decode());
                const field = liked ? 'favorite_tweet' : 'unfavorite_tweet';
                if (action.statusCode < 200 || action.statusCode >= 300 || result?.errors?.length) outcome = 'failed';
                else if (action.statusCode >= 200 && action.statusCode < 300 && result?.data?.[field] === 'Done') outcome = 'confirmed';
            } catch (_) { /* A changed response schema is not confirmation. */ }
            body = '';
            finish(action, outcome);
        };
        filter.onerror = () => { body = ''; finish(action, 'unconfirmed'); };
    }, { urls, types: ['xmlhttprequest'] }, ['blocking', 'requestBody']);

    browser.webRequest.onHeadersReceived.addListener(details => {
        const action = requests.get(details.requestId);
        if (action) action.statusCode = details.statusCode;
    }, { urls, types: ['xmlhttprequest'] });
    browser.webRequest.onErrorOccurred.addListener(details => {
        const action = requests.get(details.requestId);
        if (action) finish(action, 'failed');
    }, { urls, types: ['xmlhttprequest'] });
    browser.tabs.onRemoved.addListener(tabId => {
        for (const action of pending.values()) if (action.tabId === tabId) finish(action, 'unconfirmed');
    });
})();
