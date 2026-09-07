// Native X owns every post/reply node. The document remains the reply scroller
// so its virtual list and pagination continue receiving actual scroll events.
window.TvXDetail = window.TvXDetail || (function() {
    let route = null;
    let column = 'post';
    let root = null;
    let chrome = null;
    let savedPostScroll = 0;
    const marked = new Set();

    function mark(node, kind) {
        if (!node) return;
        node.classList.add('tv-detail-' + kind);
        marked.add(node);
    }

    function clearMarks() {
        for (const node of marked) {
            for (const name of Array.from(node.classList)) {
                if (name.startsWith('tv-detail-')) node.classList.remove(name);
            }
        }
        marked.clear();
    }

    function mount() {
        if (!document.getElementById('tv-x-detail-styles')) {
            const style = document.createElement('link');
            style.id = 'tv-x-detail-styles';
            style.rel = 'stylesheet';
            style.href = browser.runtime.getURL('sites/x/detail.css');
            (document.head || document.documentElement).appendChild(style);
        }
        chrome = document.createElement('div');
        chrome.id = 'tv-detail-chrome';
        chrome.innerHTML = '<div id="tv-detail-header">←　帖子详情</div><div id="tv-detail-comments-title">评论　　↓ 更多</div><div id="tv-detail-post-focus"></div><div id="tv-detail-comments-focus"></div><div id="tv-detail-status" role="status"></div><div id="tv-detail-reply-status" role="status"></div><div id="tv-detail-entry"><button disabled><img alt="" hidden>写评论…</button></div><div id="tv-detail-guidance">←→ 切换正文 / 评论　　↑↓ 滚动当前栏　　返回 回到时间线</div>';
        document.body.appendChild(chrome);
    }

    const ownStatusLink = window.TvXPostIdentity.statusLink;

    function formatArticle(article, permalink) {
        const reply = article.querySelector('[data-testid="reply"]');
        const cover = article.querySelector('[data-testid="article-cover-image"]');
        const media = article.querySelector('[data-testid="card.wrapper"], [data-testid="videoPlayer"], [data-testid="tweetPhoto"]');
        const avatar = article.querySelector('[data-testid="Tweet-User-Avatar"]');
        const name = article.querySelector('[data-testid="User-Name"]');
        const text = article.querySelector('[data-testid="tweetText"]');
        const engagement = reply?.closest('[role="group"]');
        let attachment = cover || media;
        // Retain the native media-only branch, including its aspect-ratio sizer.
        // tweetPhoto's immediate parent is an absolute overlay on current X.
        const boundaries = [avatar, name, text, engagement, permalink].filter(Boolean);
        while (attachment?.parentElement && attachment.parentElement !== article &&
            !boundaries.some(node => attachment.parentElement.contains(node))) attachment = attachment.parentElement;
        const parts = [
            [avatar, 'avatar'],
            [name, 'name'],
            [text, 'text'],
            [permalink && !permalink.closest('[data-testid="User-Name"]') ? permalink : null, 'time'],
            [attachment, 'attachment'],
            [engagement, 'engagement']
        ];
        for (const [node, kind] of parts) {
            if (!node) continue;
            mark(node, kind);
            mark(node, 'part');
            for (let parent = node.parentElement; parent && parent !== article; parent = parent.parentElement) mark(parent, 'branch');
        }
    }

    function update(enabled, findStatusLink) {
        if (!enabled) {
            if (!route) return;
            route = null;
            root = null;
            clearMarks();
            document.body.classList.remove('tv-detail-active');
            document.body.removeAttribute('data-tv-detail-column');
            if (chrome) chrome.remove();
            chrome = null;
            return;
        }
        const nextRoute = location.pathname.match(/^\/[^/]+\/status\/\d+/)?.[0];
        if (route !== nextRoute) {
            clearMarks();
            route = nextRoute;
            root = null;
            column = 'post';
            savedPostScroll = 0;
            window.scrollTo({top:0,behavior:'instant'});
        }
        if (!chrome || !chrome.isConnected) mount();
        document.body.classList.add('tv-detail-active');
        document.body.setAttribute('data-tv-detail-column', column);
        const primary = document.querySelector('[data-testid="primaryColumn"]');
        const articles = Array.from(primary?.querySelectorAll('article[data-testid="tweet"]') || []);
        const id = route.match(/\/status\/(\d+)/)?.[1];
        const selected = articles.find(article => window.TvXPostIdentity.canonicalPath(ownStatusLink(article, findStatusLink))?.match(/\/status\/(\d+)$/)?.[1] === id);
        if (root && root !== selected) savedPostScroll = root.scrollTop;
        clearMarks();
        root = selected || null;
        if (root) {
            mark(root, 'post');
            root.classList.remove('tv-focused');
            for (let parent = root.parentElement; parent && parent !== primary; parent = parent.parentElement) mark(parent, 'post-ancestor');
            formatArticle(root, ownStatusLink(root, findStatusLink));
            if (savedPostScroll) root.scrollTop = savedPostScroll;
        }
        for (const article of articles) {
            if (article === root) continue;
            article.classList.remove('tv-focused');
            mark(article, 'reply');
            formatArticle(article);
        }
        // Suppress native submission while #5 is not implemented. Keep React nodes intact.
        for (const input of primary?.querySelectorAll('[data-testid="tweetTextarea_0"]') || []) {
            let container = input;
            while (container.parentElement && container.parentElement !== primary && !container.parentElement.querySelector('article')) container = container.parentElement;
            mark(container, 'composer');
        }
        for (const tab of primary?.querySelectorAll('[role="tablist"]') || []) mark(tab, 'composer');
        // The native app bar has no stable test id; constrain the structural
        // fallback to headings/back controls outside posts and a sticky ancestor.
        for (const heading of primary?.querySelectorAll('h2, [data-testid="app-bar-back"]') || []) {
            if (heading.closest('article')) continue;
            for (let parent = heading.parentElement; parent && parent !== primary; parent = parent.parentElement) {
                if (getComputedStyle(parent).position === 'sticky') {
                    mark(parent, 'native-header');
                    break;
                }
            }
        }
        const avatar = chrome.querySelector('#tv-detail-entry img');
        const account = document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"] img');
        const source = account?.getAttribute('src');
        if (source && avatar.getAttribute('src') !== source) avatar.src = source;
        avatar.hidden = !source;
        const count = root?.querySelector('[data-testid="reply"]')?.textContent.trim() || '';
        const title = chrome.querySelector('#tv-detail-comments-title');
        const titleText = '评论 ' + count + '　　↓ 更多';
        if (title.textContent !== titleText) title.textContent = titleText;
        const pending = !!primary?.querySelector('[role="progressbar"]');
        const status = chrome.querySelector('#tv-detail-status');
        const message = root ? '' : pending ? '正在加载帖子…' : '帖子暂不可用，请返回后重试';
        if (status.textContent !== message) status.textContent = message;
        const replyStatus = chrome.querySelector('#tv-detail-reply-status');
        const replyMessage = articles.some(article => article !== root) ? '' : pending ? '正在加载评论…' : root ? '暂无已加载评论' : '';
        if (replyStatus.textContent !== replyMessage) replyStatus.textContent = replyMessage;
    }

    function move(direction) {
        if (!route) return false;
        if (direction === 'left' || direction === 'right') {
            column = direction === 'left' ? 'post' : 'comments';
            document.body.setAttribute('data-tv-detail-column', column);
        } else if (direction === 'up' || direction === 'down') {
            const step = (direction === 'down' ? 1 : -1) * (column === 'post' ? 716 : 604) * window.innerWidth / 1920 * 0.8;
            if (column === 'post' && root) {
                root.scrollBy({top:step,behavior:'instant'});
                savedPostScroll = root.scrollTop;
            } else if (column === 'comments') window.scrollBy({top:step,behavior:'instant'});
        }
        return true;
    }

    return { update, move, statusLink: ownStatusLink };
})();
