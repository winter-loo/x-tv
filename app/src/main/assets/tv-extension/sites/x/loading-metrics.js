// Bounded local timing only: never record URLs, post content or account identifiers.
window.TvXLoadMetrics = window.TvXLoadMetrics || (() => {
    if (!/(^|\.)(x\.com|twitter\.com)$/.test(location.hostname)) return { mark() {} };
    const samples = {};
    const resources = [];
    let domObserver, resourceObserver, deadline;
    function mark(stage) {
        if (samples[stage] !== undefined) return;
        samples[stage] = Math.round(performance.now());
        if (document.documentElement) document.documentElement.dataset.tvxLoad = JSON.stringify({ stages: samples, resources });
        console.log('[TvXLoad]', stage, samples[stage]);
    }
    mark('content_start');
    document.addEventListener('DOMContentLoaded', () => mark('dom_content_loaded'), { once: true });
    addEventListener('load', () => mark('load'), { once: true });
    domObserver = new MutationObserver(() => {
        if (document.querySelector('article[data-testid="tweet"] [data-testid="tweetText"], article[data-testid="tweet"] [data-testid="tweetPhoto"], article[data-testid="tweet"] video')) {
            mark('first_article');
            domObserver.disconnect();
        }
    });
    domObserver.observe(document, { childList: true, subtree: true });
    try {
        resourceObserver = new PerformanceObserver(list => {
            for (const entry of list.getEntries()) {
                const name = new URL(entry.name).pathname.split('/').pop();
                if (!['HomeTimeline', 'HomeLatestTimeline', 'TweetDetail'].includes(name) || resources.length >= 8) continue;
                resources.push({ operation: name, start: Math.round(entry.startTime), end: Math.round(entry.responseEnd), duration: Math.round(entry.duration) });
                if (document.documentElement) document.documentElement.dataset.tvxLoad = JSON.stringify({ stages: samples, resources });
            }
        });
        resourceObserver.observe({ type: 'resource', buffered: true });
    } catch (_) { /* DOM stages remain available when resource timing is restricted. */ }
    function stop() { domObserver.disconnect(); resourceObserver?.disconnect(); clearTimeout(deadline); }
    deadline = setTimeout(stop, 30_000);
    addEventListener('pagehide', stop, { once: true });
    return { mark };
})();
