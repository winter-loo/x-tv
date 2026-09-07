// Canonical post identity for expanded native X articles. Home keeps its narrower lookup.
window.TvXPostIdentity = window.TvXPostIdentity || (function() {
    function canonicalPath(link) {
        const href = link?.getAttribute('href');
        if (!href) return null;
        let url;
        try { url = new URL(href, location.href); }
        catch (_) { return null; }
        if (url.origin !== location.origin) return null;
        // Edited-post timestamps open native edit history for the same post.
        return url.pathname.match(/^(\/[^/]+\/status\/\d+)(?:\/history)?$/)?.[1] || null;
    }

    function ownStatusLink(article, findTimelineLink) {
        function isOwnTimestamp(link) {
            if (!link || !link.querySelector('time') || link.closest('article') !== article) return false;
            if (!canonicalPath(link)) return false;
            // Quote cards have their own identity/time. Their permalink is never
            // the containing post's identity, even when the real root is absent.
            for (let node = link.parentElement; node && node !== article; node = node.parentElement) {
                if (node.matches('[role="link"], [data-testid="quoteTweet"], [data-testid="card.wrapper"], [data-testid="tweetText"]')) return false;
            }
            return true;
        }
        const timelineLink = findTimelineLink?.(article);
        if (isOwnTimestamp(timelineLink)) return timelineLink;
        // Native detail places the canonical timestamp below the body, outside
        // User-Name. Keep this broader lookup local to detail presentation.
        const candidates = Array.from(article.querySelectorAll('a[href]')).filter(isOwnTimestamp);
        const paths = new Set(candidates.map(canonicalPath));
        return paths.size === 1 ? candidates[0] : null;
    }

    return { statusLink: ownStatusLink, canonicalPath };
})();
