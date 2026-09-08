// TV external article viewer and card link manager.
window.TvXCard = window.TvXCard || (function() {
    let session = null;
    let previousFocus = null;

    function escapeHtml(str) {
        if (!str) return '';
        return String(str).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
    }

    function extractDomain(url) {
        try {
            const host = new URL(url).hostname;
            return host.replace(/^www\./, '');
        } catch (_) {
            return '外链';
        }
    }

    function findExternalLinks(article) {
        if (!article) return [];
        const links = [];
        const seenUrls = new Set();

        // 1. Web Cards
        const cardWrappers = Array.from(article.querySelectorAll('[data-testid="card.wrapper"], [data-testid="article-cover-image"]'));
        for (const card of cardWrappers) {
            if (card.closest('[data-testid="quoteTweet"]')) continue;
            const a = card.closest('a[href]') || card.querySelector('a[href]');
            if (a && a.href) {
                const rawUrl = a.href;
                if (!seenUrls.has(rawUrl)) {
                    seenUrls.add(rawUrl);
                    let title = a.getAttribute('aria-label') || '';
                    if (!title) {
                        const titleEl = card.querySelector('[dir="auto"]');
                        title = titleEl?.textContent || '';
                    }
                    if (!title) {
                        const spans = Array.from(card.querySelectorAll('span')).map(s => s.textContent.trim()).filter(Boolean);
                        title = spans[0] || '';
                    }
                    const domain = extractDomain(rawUrl);
                    links.push({
                        url: rawUrl,
                        title: (title || domain || '外部文章').trim(),
                        domain,
                        isCard: true
                    });
                }
            }
        }

        // 2. Links in tweetText
        const textNode = article.querySelector('[data-testid="tweetText"]');
        if (textNode) {
            const textLinks = Array.from(textNode.querySelectorAll('a[href]'));
            for (const a of textLinks) {
                const href = a.href;
                if (!href || seenUrls.has(href)) continue;
                try {
                    const parsed = new URL(href, location.origin);
                    if ((parsed.hostname.endsWith('x.com') || parsed.hostname.endsWith('twitter.com')) &&
                        !parsed.pathname.startsWith('/i/article')) {
                        continue;
                    }
                    seenUrls.add(href);
                    const text = a.textContent.trim();
                    const titleAttr = a.getAttribute('title') || '';
                    const domainSource = (parsed.hostname === 't.co' || parsed.hostname.endsWith('t.co'))
                        ? (titleAttr || text || href)
                        : href;
                    const domain = extractDomain(domainSource);
                    links.push({
                        url: href,
                        title: text || titleAttr || domain || '外部链接',
                        domain,
                        isCard: false
                    });
                } catch (_) {}
            }
        }

        return links;
    }

    let previousScroll = 0;

    function open(url, title) {
        if (session && session.isConnected) close();
        previousFocus = document.activeElement;
        previousScroll = window.scrollY;

        const domain = extractDomain(url);
        const displayTitle = title || domain || '外部文章';

        session = document.createElement('div');
        session.id = 'tv-article-session';
        session.setAttribute('role', 'dialog');
        session.setAttribute('aria-label', '文章阅读');
        session.setAttribute('aria-modal', 'true');

        session.innerHTML = `
            <div id="tv-article-header">
                <div id="tv-article-source">
                    <span class="tv-article-badge">WEB</span>
                    <span id="tv-article-domain">${escapeHtml(domain)}</span>
                </div>
                <div id="tv-article-title">${escapeHtml(displayTitle)}</div>
                <div id="tv-article-guidance">↑↓ 滚动阅读     返回 关闭</div>
            </div>
            <div id="tv-article-scroll">
                <iframe id="tv-article-frame" src="${escapeHtml(url)}" sandbox="allow-scripts allow-same-origin allow-popups"></iframe>
            </div>
        `;

        document.body.appendChild(session);
        return true;
    }

    function close() {
        if (!session) return false;
        session.remove();
        session = null;
        if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
        previousFocus = null;
        window.scrollTo({ top: previousScroll, behavior: 'instant' });
        return true;
    }

    function scroll(direction) {
        if (!session) return false;
        const scrollContainer = session.querySelector('#tv-article-scroll');
        const frame = session.querySelector('#tv-article-frame');
        const delta = (direction === 'down' ? 1 : -1) * (window.innerHeight * 0.7);

        if (scrollContainer) {
            scrollContainer.scrollBy({ top: delta, behavior: 'smooth' });
        }
        try {
            frame?.contentWindow?.scrollBy({ top: delta, behavior: 'smooth' });
        } catch (_) {}
        return true;
    }

    function move(direction) {
        if (session && session.isConnected) {
            scroll(direction);
            return true;
        }
        return false;
    }

    function back() {
        if (session && session.isConnected) {
            close();
            return true;
        }
        return false;
    }

    function isOpen() {
        return !!session && session.isConnected;
    }

    return {
        findExternalLinks,
        open,
        close,
        scroll,
        move,
        back,
        isOpen
    };
})();

