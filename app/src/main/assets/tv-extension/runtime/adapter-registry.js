// Adapter Registry: Matches current URL and DOM to appropriate site adapter
window.TvAdapterRegistry = (function() {
    let currentAdapter = null;

    function getActiveAdapter() {
        if (currentAdapter) return currentAdapter;

        const host = window.location.hostname || "";
        const href = window.location.href || "";

        // Match X / Twitter domains or local test fixtures or data URIs containing timeline cards
        if (host.includes("x.com") ||
            host.includes("twitter.com") ||
            href.includes("mock_timeline") ||
            href.startsWith("data:") ||
            document.querySelector(".timeline-card") ||
            document.querySelector('article[data-testid="tweet"]') ||
            document.querySelector('article[role="article"]')) {
            currentAdapter = window.TvXAdapter;
        }

        return currentAdapter;
    }

    return {
        getActiveAdapter
    };
})();
