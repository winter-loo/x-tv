// Native X owns every post/reply node. The document remains the reply scroller
// so its virtual list and pagination continue receiving actual scroll events.
window.TvXDetail = window.TvXDetail || (function() {
    let route = null;
    let routeMountedAt = 0;
    let column = 'post';
    let root = null;
    let chrome = null;
    let savedPostScroll = 0;
    let savedCommentsScroll = 0;
    let replyAnchor = null;
    let replyEntry = false;
    let pendingReplyMove = null;
    let openingReply = false;
    const marked = new Set();

    let overlay = null;
    let selected = 0;
    let isPending = false;
    let savedDraft = '';
    let sentTimer = null;
    let domObserver = null;
    let replySettled = false;
    let cachedSnapshot = null;
    let instantRoot = null;

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
        chrome.innerHTML = '<div id="tv-detail-header">←　帖子详情</div><div id="tv-detail-comments-title">评论　　↓ 更多</div><div id="tv-detail-post-focus"></div><div id="tv-detail-comments-focus"></div><div id="tv-detail-status" role="status"></div><div id="tv-detail-reply-status" role="status"></div><div id="tv-detail-entry"><button disabled><img alt="" hidden>写评论…</button></div><div id="tv-detail-guidance">←→ 切换正文 / 评论　　↑↓ 滚动当前栏　　返回 上一层</div>';
        document.body.appendChild(chrome);
        document.addEventListener('click', handleReplyClick, true);
        const entryBtn = chrome.querySelector('#tv-detail-entry button');
        entryBtn.addEventListener('click', () => {
            if (!entryBtn.disabled) openComposer();
        });
    }

    const ownStatusLink = window.TvXPostIdentity.statusLink;

    function pruneStorage() {
        try {
            const now = Date.now();
            const keys = [];
            for (let i = 0; i < sessionStorage.length; i++) {
                const k = sessionStorage.key(i);
                if (k && k.startsWith('tvx_instant_detail_')) keys.push(k);
            }
            if (keys.length > 5) {
                const items = keys.map(k => {
                    try { return { key: k, data: JSON.parse(sessionStorage.getItem(k)) }; }
                    catch (_) { return { key: k, data: null }; }
                }).sort((a, b) => (b.data?.timestamp || 0) - (a.data?.timestamp || 0));
                for (let i = 5; i < items.length; i++) sessionStorage.removeItem(items[i].key);
            }
            for (const k of keys) {
                try {
                    const item = JSON.parse(sessionStorage.getItem(k));
                    if (!item || !item.timestamp || (now - item.timestamp > 10 * 60 * 1000)) {
                        sessionStorage.removeItem(k);
                    }
                } catch (_) {
                    sessionStorage.removeItem(k);
                }
            }
        } catch (_) {}
    }

    function findAttachment(article, boundaries) {
        const cover = article.querySelector('[data-testid="article-cover-image"]');
        const media = article.querySelector('[data-testid="card.wrapper"], [data-testid="videoPlayer"], [data-testid="tweetPhoto"]');
        let attachment = cover || media;
        if (!attachment) return null;
        while (attachment.parentElement && attachment.parentElement !== article &&
            !boundaries.some(node => attachment.parentElement.contains(node))) {
            attachment = attachment.parentElement;
        }
        return attachment;
    }

    function stash(article, targetPath) {
        if (!article) return null;
        const path = targetPath || window.TvXPostIdentity?.canonicalPath(ownStatusLink(article));
        const match = path?.match(/\/status\/(\d+)/);
        const id = match ? match[1] : null;
        if (!id) return null;

        const avatar = article.querySelector('[data-testid="Tweet-User-Avatar"]');
        const name = article.querySelector('[data-testid="User-Name"]');
        const text = article.querySelector('[data-testid="tweetText"]');
        const reply = article.querySelector('[data-testid="reply"]');
        const boundaries = [avatar, name, text, reply?.closest('[role="group"]')].filter(Boolean);
        const attachment = findAttachment(article, boundaries);
        const engagement = reply?.closest('[role="group"]');

        const snapshot = {
            id,
            path,
            avatarHtml: avatar ? avatar.outerHTML : '',
            nameHtml: name ? name.outerHTML : '',
            textHtml: text ? text.outerHTML : '',
            attachmentHtml: attachment ? attachment.outerHTML : '',
            engagementHtml: engagement ? engagement.outerHTML : '',
            replyCount: reply?.textContent.trim() || '',
            timestamp: Date.now()
        };

        try {
            sessionStorage.setItem('tvx_instant_detail_' + id, JSON.stringify(snapshot));
            pruneStorage();
        } catch (_) {}
        cachedSnapshot = snapshot;
        return snapshot;
    }

    function getSnapshot(id) {
        if (cachedSnapshot && cachedSnapshot.id === id) return cachedSnapshot;
        try {
            const raw = sessionStorage.getItem('tvx_instant_detail_' + id);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (parsed && parsed.id === id) {
                    cachedSnapshot = parsed;
                    return parsed;
                }
            }
        } catch (_) {}
        return null;
    }

    function clearSnapshot(id) {
        if (!id || (cachedSnapshot && cachedSnapshot.id === id)) cachedSnapshot = null;
        try {
            if (id) sessionStorage.removeItem('tvx_instant_detail_' + id);
            else {
                for (let i = sessionStorage.length - 1; i >= 0; i--) {
                    const k = sessionStorage.key(i);
                    if (k && k.startsWith('tvx_instant_detail_')) sessionStorage.removeItem(k);
                }
            }
        } catch (_) {}
    }

    function renderInstantRoot(snapshot) {
        if (!chrome) return null;
        let el = chrome.querySelector('#tv-detail-instant-root');
        if (!el) {
            el = document.createElement('article');
            el.id = 'tv-detail-instant-root';
            el.className = 'tv-detail-post tv-instant-post';
            el.setAttribute('data-fixture-id', snapshot.id);
            el.setAttribute('data-instant-detail', 'true');
            chrome.appendChild(el);
        } else if (el.getAttribute('data-fixture-id') !== snapshot.id) {
            el.setAttribute('data-fixture-id', snapshot.id);
            el.innerHTML = '';
        } else {
            instantRoot = el;
            return el;
        }

        const parts = [
            [snapshot.avatarHtml, 'avatar'],
            [snapshot.nameHtml, 'name'],
            [snapshot.textHtml, 'text'],
            [snapshot.attachmentHtml, 'attachment'],
            [snapshot.engagementHtml, 'engagement']
        ];
        for (const [html, kind] of parts) {
            if (!html) continue;
            const temp = document.createElement('div');
            temp.innerHTML = html;
            const child = temp.firstElementChild;
            if (child) {
                child.classList.add('tv-detail-' + kind, 'tv-detail-part');
                el.appendChild(child);
            }
        }

        instantRoot = el;
        return el;
    }

    function formatArticle(article, permalink) {
        const reply = article.querySelector('[data-testid="reply"]');
        const avatar = article.querySelector('[data-testid="Tweet-User-Avatar"]');
        const name = article.querySelector('[data-testid="User-Name"]');
        const text = article.querySelector('[data-testid="tweetText"]');
        const engagement = reply?.closest('[role="group"]');
        const boundaries = [avatar, name, text, engagement, permalink].filter(Boolean);
        const attachment = findAttachment(article, boundaries);
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

    function replyPath(article) {
        return article && window.TvXPostIdentity.canonicalPath(ownStatusLink(article));
    }

    function replies() {
        if (!root) return [];
        return Array.from(document.querySelectorAll('article.tv-detail-reply')).filter(article =>
            article.getBoundingClientRect().height > 0 && replyPath(article));
    }

    function currentReply() {
        return replies().find(article => replyPath(article) === replyAnchor) || null;
    }

    function visibleReply(items = replies()) {
        const u = window.innerWidth / 1920;
        return items.find(article => {
            const rect = article.getBoundingClientRect();
            return rect.bottom > 228 * u + 8 && rect.top < 832 * u;
        }) || items[0];
    }

    function renderReplyFocus() {
        const current = column === 'comments' && !replyEntry ? currentReply() : null;
        for (const article of document.querySelectorAll('[data-tv-reply-selected]')) {
            if (article !== current) article.removeAttribute('data-tv-reply-selected');
        }
        if (current) current.setAttribute('data-tv-reply-selected', 'true');
        const entry = chrome?.querySelector('#tv-detail-entry button');
        entry?.classList.toggle('tv-detail-focused', column === 'comments' && replyEntry);
        const guidance = chrome?.querySelector('#tv-detail-guidance');
        if (guidance) guidance.textContent = column === 'post'
            ? (window.TvXCard?.isCardFocused()
                ? '确认 阅读文章　　↑ 返回正文　　→ 选择评论　　返回 上一层'
                : '↑↓ 滚动正文　　→ 选择评论　　返回 上一层')
            : replyEntry ? '确认 写评论　　↑↓ 返回评论列表　　← 正文　　返回 上一层'
            : '↑↓ 选择 / 翻阅评论　　确认 查看详情　　→ 写评论　　← 正文　　返回 上一层';
    }

    function selectReply(article, align = true) {
        if (!article) return;
        replyAnchor = replyPath(article);
        replyEntry = false;
        const entry = chrome?.querySelector('#tv-detail-entry button');
        if (document.activeElement === entry) entry.blur();
        renderReplyFocus();
        if (align) {
            const rect = article.getBoundingClientRect();
            const top = 228 * window.innerWidth / 1920;
            const bottom = 832 * window.innerWidth / 1920;
            if (rect.top < top || rect.bottom > bottom) window.scrollBy({top:rect.top - top,behavior:'instant'});
            savedCommentsScroll = window.scrollY;
        }
    }

    function moveReply(direction) {
        const items = replies();
        if (!items.length) return;
        const current = currentReply();
        if (replyEntry || !current) {
            pendingReplyMove = null;
            selectReply(current || visibleReply(items));
            return;
        }
        if (pendingReplyMove && direction === 'down') return;
        pendingReplyMove = null;
        const u = window.innerWidth / 1920;
        const rect = current.getBoundingClientRect();
        const top = 228 * u, bottom = 832 * u;
        const remaining = direction === 'down' ? rect.bottom - bottom : top - rect.top;
        if (remaining > 2) {
            window.scrollBy({top:(direction === 'down' ? 1 : -1) * Math.min(remaining,604*u*.8),behavior:'instant'});
            savedCommentsScroll = window.scrollY;
            return;
        }
        const next = items[items.indexOf(current) + (direction === 'down' ? 1 : -1)];
        if (next) selectReply(next);
        else if (direction === 'down') {
            pendingReplyMove = {anchor:replyAnchor,known:items.map(replyPath)};
            window.scrollBy({top:604*u*.8,behavior:'instant'});
            savedCommentsScroll = window.scrollY;
        } else {
            replyEntry = true;
            renderReplyFocus();
        }
    }

    function openReply(article) {
        const path = replyPath(article);
        if (!root || !article?.isConnected || !path || path === route) return;
        stash(article, path);
        selectReply(article, false);
        savedCommentsScroll = window.scrollY;
        savedPostScroll = root.scrollTop;
        if (window.TvXNativeHost) window.TvXNativeHost.openPost(path);
        else {
            const link = ownStatusLink(article);
            const original = link.getAttribute('href');
            openingReply = true;
            try { link.setAttribute('href',path); link.click(); }
            finally { link.setAttribute('href',original); openingReply = false; }
        }
    }

    function handleReplyClick(event) {
        if (!route || openingReply || overlay || window.TvXActions?.isOpen?.()) return;
        const article = event.target.closest?.('article.tv-detail-reply');
        if (!article || event.target.closest('button,input,textarea,[contenteditable="true"]')) return;
        const link = event.target.closest('a[href]');
        if (link && window.TvXPostIdentity.canonicalPath(link) !== replyPath(article)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        column = 'comments';
        document.body.setAttribute('data-tv-detail-column',column);
        openReply(article);
    }

    function escapeHtml(str) {
        if (!str) return '';
        return String(str).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
    }

    function getAccountIdentity() {
        const switcher = document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]');
        const img = switcher?.querySelector('img') || chrome?.querySelector('#tv-detail-entry img');
        const src = img?.getAttribute('src') || '';
        let name = '';
        if (switcher) {
            const spans = Array.from(switcher.querySelectorAll('span')).map(s => s.textContent.trim()).filter(Boolean);
            const handle = spans.find(s => s.startsWith('@'));
            name = spans.find(s => s !== handle && !s.startsWith('@')) || handle || '';
        }
        return {
            avatar: src,
            name: name || '当前账号'
        };
    }

    function getReplyTarget() {
        if (!root) return '回复 帖子';
        const userNames = Array.from(root.querySelectorAll('[data-testid="User-Name"]'));
        const userName = userNames.find(n => !n.closest('[role="link"]')) || userNames[0];
        if (!userName) return '回复 帖子';
        const spans = Array.from(userName.querySelectorAll('span')).map(s => s.textContent.trim()).filter(Boolean);
        const handle = spans.find(s => s.startsWith('@'));
        if (handle) return '回复 ' + handle;
        const authorName = spans[0] || '';
        return authorName ? '回复 ' + authorName : '回复 帖子';
    }

    function interactiveItems() {
        return overlay ? [
            overlay.querySelector('#tv-composer-input'),
            overlay.querySelector('#tv-composer-submit'),
            overlay.querySelector('#tv-composer-cancel')
        ].filter(Boolean) : [];
    }

    function activateInput() {
        const input = overlay?.querySelector('#tv-composer-input');
        if (!input) return;
        input.focus();
        const len = input.value ? input.value.length : 0;
        try { input.setSelectionRange(len, len); } catch (_) {}
        try {
            input.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
        } catch (_) {}
    }

    function focusComposer() {
        const items = interactiveItems();
        if (!items.length) return;
        if (selected < 0) selected = 0;
        if (selected >= items.length) selected = items.length - 1;
        items.forEach((item, index) => {
            item.classList.toggle('tv-composer-focused', index === selected);
        });
        items[selected].focus();
        if (selected === 0) {
            const input = items[0];
            const len = input.value ? input.value.length : 0;
            try { input.setSelectionRange(len, len); } catch (_) {}
        }
    }

    function trapComposerFocus(event) {
        if (!overlay || !overlay.isConnected) return;
        if (!overlay.contains(event.target)) {
            event.stopPropagation();
            focusComposer();
        }
    }

    function handleComposerKeyDown(e) {
        if (!overlay || !overlay.isConnected) return;
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopImmediatePropagation();
            closeComposer(false);
            return;
        }
        if (e.key === 'Tab') {
            e.preventDefault();
            e.stopImmediatePropagation();
            move(e.shiftKey ? 'up' : 'down');
            return;
        }
        if (selected === 0) {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                e.stopImmediatePropagation();
                move('down');
                return;
            }
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                e.stopImmediatePropagation();
                move('up');
                return;
            }
            if (e.key === 'Enter') {
                if (e.ctrlKey || e.metaKey) {
                    e.preventDefault();
                    e.stopImmediatePropagation();
                    submitReply();
                    return;
                }
                e.preventDefault();
                e.stopImmediatePropagation();
                activateInput();
                return;
            }
        } else {
            if (e.key === 'ArrowDown') { e.preventDefault(); e.stopImmediatePropagation(); move('down'); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); e.stopImmediatePropagation(); move('up'); }
            else if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopImmediatePropagation(); move('left'); }
            else if (e.key === 'ArrowRight') { e.preventDefault(); e.stopImmediatePropagation(); move('right'); }
            else if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                e.stopImmediatePropagation();
                activate();
            }
        }
    }

    function openComposer() {
        if (overlay && overlay.isConnected) return;
        savedCommentsScroll = window.scrollY;
        if (root) savedPostScroll = root.scrollTop;

        overlay = document.createElement('div');
        overlay.id = 'tv-detail-composer-overlay';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-label', '写回复');

        const identity = getAccountIdentity();
        const targetText = getReplyTarget();

        overlay.innerHTML = `
            <div id="tv-detail-composer-dialog">
                <div id="tv-composer-header">
                    <div id="tv-composer-identity">
                        <img id="tv-composer-avatar" alt="Author avatar" src="${escapeHtml(identity.avatar)}"${identity.avatar ? '' : ' style="display:none"'}>
                        <div id="tv-composer-author-info">
                            <span id="tv-composer-author-name">${escapeHtml(identity.name)}</span>
                            <span id="tv-composer-target">${escapeHtml(targetText)}</span>
                        </div>
                    </div>
                    <button id="tv-composer-cancel" type="button" aria-label="Close">取消</button>
                </div>
                <div id="tv-composer-body">
                    <textarea id="tv-composer-input" placeholder="写下你的回复…" rows="4"></textarea>
                </div>
                <div id="tv-composer-footer">
                    <div id="tv-composer-status-container">
                        <div id="tv-composer-sent" role="status" hidden>
                            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
                            <span>已发送</span>
                        </div>
                        <div id="tv-composer-status" role="status"></div>
                    </div>
                    <div id="tv-composer-actions">
                        <button id="tv-composer-submit" type="button" aria-disabled="true">回复</button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        const input = overlay.querySelector('#tv-composer-input');
        const submitBtn = overlay.querySelector('#tv-composer-submit');
        const cancelBtn = overlay.querySelector('#tv-composer-cancel');

        if (savedDraft) {
            input.value = savedDraft;
            const hasText = !!savedDraft.trim();
            submitBtn.setAttribute('aria-disabled', String(!hasText));
        } else {
            submitBtn.setAttribute('aria-disabled', 'true');
        }

        function syncDraft() {
            savedDraft = input.value;
            const hasText = !!input.value.trim();
            submitBtn.setAttribute('aria-disabled', String(!hasText || isPending));
            const status = overlay?.querySelector('#tv-composer-status');
            if (status && status.classList.contains('tv-status-error')) {
                status.textContent = '';
                status.className = '';
                submitBtn.textContent = '回复';
            }
        }

        input.addEventListener('input', syncDraft);
        input.addEventListener('change', syncDraft);
        input.addEventListener('compositionend', syncDraft);

        input.addEventListener('focus', () => { selected = 0; focusComposer(); });
        submitBtn.addEventListener('focus', () => { selected = 1; focusComposer(); });
        cancelBtn.addEventListener('focus', () => { selected = 2; focusComposer(); });

        submitBtn.addEventListener('click', () => { selected = 1; submitReply(); });
        cancelBtn.addEventListener('click', () => { selected = 2; closeComposer(false); });

        selected = 0;
        focusComposer();
        activateInput();
        document.addEventListener('focusin', trapComposerFocus, true);
        window.addEventListener('keydown', handleComposerKeyDown, true);
    }

    function closeComposer(success) {
        clearTimeout(sentTimer);
        sentTimer = null;
        if (domObserver) {
            domObserver.disconnect();
            domObserver = null;
        }
        if (overlay) {
            document.removeEventListener('focusin', trapComposerFocus, true);
            window.removeEventListener('keydown', handleComposerKeyDown, true);
            overlay.remove();
            overlay = null;
        }
        isPending = false;
        column = 'comments';
        replyEntry = true;
        renderReplyFocus();
        document.body.setAttribute('data-tv-detail-column', 'comments');
        if (root && savedPostScroll) root.scrollTop = savedPostScroll;
        if (savedCommentsScroll) window.scrollTo({ top: savedCommentsScroll, behavior: 'instant' });
        const entryBtn = chrome?.querySelector('#tv-detail-entry button');
        if (entryBtn && !entryBtn.disabled) entryBtn.focus();
    }

    function submitReply() {
        if (!overlay || isPending) return false;
        const input = overlay.querySelector('#tv-composer-input');
        const text = input ? input.value.trim() : '';
        const submitBtn = overlay.querySelector('#tv-composer-submit');
        if (!text || submitBtn?.getAttribute('aria-disabled') === 'true') return false;

        isPending = true;
        savedDraft = input.value;
        const status = overlay.querySelector('#tv-composer-status');

        input.disabled = true;
        submitBtn.setAttribute('aria-disabled', 'true');
        submitBtn.setAttribute('aria-busy', 'true');
        status.textContent = '正在发送回复…';
        status.className = 'tv-status-pending';

        const primary = document.querySelector('[data-testid="primaryColumn"]');
        const nativeInput = primary?.querySelector('[data-testid="tweetTextarea_0"]');
        const nativeSubmit = primary?.querySelector('[data-testid="tweetButtonInline"]');

        if (nativeInput) {
            if ('value' in nativeInput) {
                const proto = Object.getPrototypeOf(nativeInput);
                const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
                if (setter) setter.call(nativeInput, text);
                else nativeInput.value = text;
            } else {
                nativeInput.textContent = text;
            }
            nativeInput.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
            nativeInput.dispatchEvent(new Event('change', { bubbles: true }));
        }

        const prevCountText = root?.querySelector('[data-testid="reply"]')?.textContent.trim() || '0';
        const prevCount = parseInt(prevCountText, 10) || 0;
        const existingArticles = new Set(Array.from(primary?.querySelectorAll('article[data-testid="tweet"]') || []));

        replySettled = false;
        let timeoutTimer = null;

        function cleanup() {
            if (domObserver) {
                domObserver.disconnect();
                domObserver = null;
            }
            window.removeEventListener('tv_reply_result', onReplyResult);
            clearTimeout(timeoutTimer);
        }

        function succeed() {
            if (replySettled) return;
            replySettled = true;
            cleanup();
            handleSuccess();
        }

        function fail(err) {
            if (replySettled) return;
            replySettled = true;
            cleanup();
            handleFailure(err);
        }

        function onReplyResult(e) {
            const d = e.detail || {};
            if (d.outcome === 'confirmed' || d.status === 'confirmed' || d.success) succeed();
            else if (d.outcome === 'failed' || d.error) fail(d.error || '未能发送回复，请确认重试');
        }
        window.addEventListener('tv_reply_result', onReplyResult);

        domObserver = new MutationObserver(() => {
            if (replySettled) return;
            const currentArticles = Array.from(primary?.querySelectorAll('article[data-testid="tweet"]') || []);
            const hasNewArticle = currentArticles.some(a => a !== root && !existingArticles.has(a));
            if (hasNewArticle) {
                succeed();
                return;
            }
            const currentCountText = root?.querySelector('[data-testid="reply"]')?.textContent.trim() || '0';
            const currentCount = parseInt(currentCountText, 10) || 0;
            if (currentCount > prevCount) {
                succeed();
                return;
            }
            if (nativeInput && (nativeInput.value === '' || nativeInput.textContent === '') && nativeSubmit?.getAttribute('aria-disabled') === 'true') {
                succeed();
                return;
            }
            const toast = document.querySelector('[data-testid="toast"], [role="alert"]');
            if (toast && /error|failed|失败|错误/i.test(toast.textContent)) {
                fail('未能发送回复，请确认重试');
                return;
            }
        });
        domObserver.observe(document.body, { childList: true, subtree: true, characterData: true });

        timeoutTimer = setTimeout(() => {
            if (!replySettled) {
                fail('发送超时，请确认重试');
            }
        }, 15000);

        if (nativeSubmit && !nativeSubmit.disabled && nativeSubmit.getAttribute('aria-disabled') !== 'true') {
            nativeSubmit.click();
        }
        return true;
    }

    function handleSuccess() {
        isPending = false;
        savedDraft = '';
        if (!overlay) return;

        const status = overlay.querySelector('#tv-composer-status');
        const submitBtn = overlay.querySelector('#tv-composer-submit');
        const sentBadge = overlay.querySelector('#tv-composer-sent');

        if (status) {
            status.textContent = '已发送，即将返回评论';
            status.className = 'tv-status-success';
        }
        if (sentBadge) sentBadge.hidden = false;
        if (submitBtn) {
            submitBtn.setAttribute('aria-disabled', 'true');
            submitBtn.removeAttribute('aria-busy');
            submitBtn.textContent = '已发送';
        }
        overlay.classList.add('tv-composer-success');

        sentTimer = setTimeout(() => {
            sentTimer = null;
            closeComposer(true);
            column = 'comments';
            document.body.setAttribute('data-tv-detail-column', 'comments');
            update(true, ownStatusLink);
            if (root && savedPostScroll) root.scrollTop = savedPostScroll;
            if (savedCommentsScroll) window.scrollTo({ top: savedCommentsScroll, behavior: 'instant' });
        }, 600);
    }

    function handleFailure(err) {
        isPending = false;
        if (!overlay) return;

        const status = overlay.querySelector('#tv-composer-status');
        const submitBtn = overlay.querySelector('#tv-composer-submit');
        const input = overlay.querySelector('#tv-composer-input');

        if (input) {
            input.disabled = false;
            input.value = savedDraft;
        }
        if (status) {
            status.textContent = typeof err === 'string' ? err : '发送失败，请重试';
            status.className = 'tv-status-error';
        }
        if (submitBtn) {
            submitBtn.setAttribute('aria-disabled', 'false');
            submitBtn.removeAttribute('aria-busy');
            submitBtn.textContent = '重试';
        }
        selected = 1;
        focusComposer();
    }

    function hookAdapter() {
        if (!window.TvXAdapter || window.TvXAdapter._detailHooked) return;
        window.TvXAdapter._detailHooked = true;
        const origActivate = window.TvXAdapter.activate;
        window.TvXAdapter.activate = function() {
            if (route && window.TvXDetail?.activate?.()) return true;
            return origActivate ? origActivate.apply(this, arguments) : undefined;
        };
        const origHandleBack = window.TvXAdapter.handleBack;
        window.TvXAdapter.handleBack = function() {
            if (route && window.TvXDetail?.isOpen?.()) {
                window.TvXDetail.closeComposer(false);
                return { event: "backResult", handled: true };
            }
            return origHandleBack ? origHandleBack.apply(this, arguments) : { event: "backResult", handled: false };
        };
    }
    hookAdapter();
    let adapterVal = window.TvXAdapter;
    try {
        Object.defineProperty(window, 'TvXAdapter', {
            configurable: true,
            enumerable: true,
            get() { return adapterVal; },
            set(val) {
                adapterVal = val;
                hookAdapter();
            }
        });
    } catch (_) {}

    function update(enabled, findStatusLink) {
        hookAdapter();
        if (!enabled) {
            if (!route) return;
            window.TvXCard?.unselect();
            route = null;
            root = null;
            if (instantRoot) {
                instantRoot.remove();
                instantRoot = null;
            }
            replyAnchor = null;
            pendingReplyMove = null;
            document.removeEventListener('click', handleReplyClick, true);
            document.querySelectorAll('[data-tv-reply-selected]').forEach(node => node.removeAttribute('data-tv-reply-selected'));
            clearMarks();
            closeComposer(false);
            document.body.classList.remove('tv-detail-active');
            document.body.removeAttribute('data-tv-detail-column');
            if (chrome) chrome.remove();
            chrome = null;
            return;
        }
        const nextRoute = location.pathname.match(/^\/[^/]+\/status\/\d+/)?.[0];
        if (route !== nextRoute) {
            window.TvXCard?.unselect();
            clearMarks();
            closeComposer(false);
            if (instantRoot) {
                instantRoot.remove();
                instantRoot = null;
            }
            route = nextRoute;
            routeMountedAt = Date.now();
            root = null;
            column = 'post';
            savedPostScroll = 0;
            savedCommentsScroll = 0;
            savedDraft = '';
            replyAnchor = null;
            replyEntry = false;
            pendingReplyMove = null;
            window.scrollTo({top:0,behavior:'instant'});
        }
        if (!routeMountedAt) routeMountedAt = Date.now();
        if (!chrome || !chrome.isConnected) mount();
        document.body.classList.add('tv-detail-active');
        document.body.setAttribute('data-tv-detail-column', column);
        const primary = document.querySelector('[data-testid="primaryColumn"]');
        const articles = Array.from(primary?.querySelectorAll('article[data-testid="tweet"]') || []);
        const id = route.match(/\/status\/(\d+)/)?.[1];
        const selectedPost = articles.find(article => window.TvXPostIdentity.canonicalPath(ownStatusLink(article, findStatusLink))?.match(/\/status\/(\d+)$/)?.[1] === id);
        if (root && root !== selectedPost) savedPostScroll = root.scrollTop;
        clearMarks();
        root = selectedPost || null;
        if (root) {
            if (instantRoot) {
                savedPostScroll = instantRoot.scrollTop || savedPostScroll;
                instantRoot.remove();
                instantRoot = null;
            }
            clearSnapshot(id);
            mark(root, 'post');
            root.classList.remove('tv-focused');
            for (let parent = root.parentElement; parent && parent !== primary; parent = parent.parentElement) mark(parent, 'post-ancestor');
            formatArticle(root, ownStatusLink(root, findStatusLink));
            if (savedPostScroll) root.scrollTop = savedPostScroll;
        } else {
            const tombstone = !!(primary?.querySelector('[data-testid="tombstone"], [data-testid="error-detail"]') || document.querySelector('[data-testid="emptyState"]'));
            if (!tombstone && id) {
                const snapshot = getSnapshot(id);
                if (snapshot) {
                    renderInstantRoot(snapshot);
                    if (savedPostScroll && instantRoot) instantRoot.scrollTop = savedPostScroll;
                }
            } else if (tombstone && instantRoot) {
                instantRoot.remove();
                instantRoot = null;
            }
        }
        for (const article of articles) {
            if (article === root) continue;
            article.classList.remove('tv-focused');
            // A reply detail includes earlier conversation posts before its
            // root. They are ancestors, not comments on the selected reply.
            if (root && (article.compareDocumentPosition(root) & Node.DOCUMENT_POSITION_FOLLOWING)) {
                mark(article, 'context');
                continue;
            }
            mark(article, 'reply');
            if (!article.hasAttribute('data-tv-reply-animated')) {
                article.setAttribute('data-tv-reply-animated', 'true');
                article.classList.add('tv-reply-animated');
            }
            formatArticle(article);
        }
        if (column === 'comments' && !replyEntry) {
            const items = replies();
            if (pendingReplyMove) {
                const index = items.findIndex(article => replyPath(article) === pendingReplyMove.anchor);
                const next = index >= 0 ? items[index + 1] : items.find(article => !pendingReplyMove.known.includes(replyPath(article)));
                if (next) { pendingReplyMove = null; selectReply(next); }
            } else if (!replyAnchor) {
                const first = visibleReply(items);
                if (first) selectReply(first, false);
            }
        }
        renderReplyFocus();
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

        const tombstone = !!(primary?.querySelector('[data-testid="tombstone"], [data-testid="error-detail"]') || document.querySelector('[data-testid="emptyState"]'));
        const hasInstant = !root && !!instantRoot && !tombstone;

        const entryBtn = chrome.querySelector('#tv-detail-entry button');
        if (entryBtn) {
            entryBtn.disabled = !root && !hasInstant;
            if (!entryBtn._hasReplyListener) {
                entryBtn._hasReplyListener = true;
                entryBtn.addEventListener('click', () => {
                    if (!entryBtn.disabled) openComposer();
                });
            }
        }

        const count = (root || instantRoot)?.querySelector('[data-testid="reply"]')?.textContent.trim() || '';
        const title = chrome.querySelector('#tv-detail-comments-title');
        const titleText = '评论 ' + count + '　　↓ 更多';
        if (title.textContent !== titleText) title.textContent = titleText;
        const pending = !!primary?.querySelector('[role="progressbar"]');
        const isInitialGrace = (Date.now() - routeMountedAt < 6000) && (articles.length === 0);
        const isPostLoading = !root && !hasInstant && (pending || isInitialGrace) && !tombstone;
        const status = chrome.querySelector('#tv-detail-status');
        const message = (root || hasInstant) ? '' : isPostLoading ? '正在加载帖子…' : '帖子暂不可用，请返回后重试';
        if (status.textContent !== message) status.textContent = message;
        status.classList.toggle('tv-loading-shimmer', isPostLoading);
        status.classList.toggle('tv-status-error', !root && !hasInstant && !isPostLoading);

        let skeletonCard = chrome.querySelector('#tv-detail-skeleton-card');
        let errorCard = chrome.querySelector('#tv-detail-error-card');

        if (isPostLoading) {
            if (!skeletonCard) {
                skeletonCard = document.createElement('div');
                skeletonCard.id = 'tv-detail-skeleton-card';
                skeletonCard.innerHTML = '<div class="tv-skeleton-header"><div class="tv-skeleton-avatar"></div><div class="tv-skeleton-meta"><div class="tv-skeleton-line short"></div><div class="tv-skeleton-line tiny"></div></div></div><div class="tv-skeleton-body"><div class="tv-skeleton-line"></div><div class="tv-skeleton-line"></div><div class="tv-skeleton-line three-quarters"></div></div><div class="tv-skeleton-media"></div>';
                chrome.appendChild(skeletonCard);
            }
            if (errorCard) errorCard.remove();
        } else if (!root && !hasInstant) {
            if (skeletonCard) skeletonCard.remove();
            if (!errorCard) {
                errorCard = document.createElement('div');
                errorCard.id = 'tv-detail-error-card';
                errorCard.innerHTML = '<div class="tv-error-icon"><svg viewBox="0 0 24 24" width="40" height="40"><path fill="#f87171" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg></div><div class="tv-error-title">帖子暂不可用</div><div class="tv-error-desc">该帖子可能已被作者删除或链接失效</div><button id="tv-detail-error-back" type="button" class="tv-error-back-btn">返回上一页</button>';
                chrome.appendChild(errorCard);
                errorCard.querySelector('#tv-detail-error-back')?.addEventListener('click', () => {
                    if (window.TvXAdapter?.handleBack) window.TvXAdapter.handleBack();
                    else history.back();
                });
            }
        } else {
            if (skeletonCard) skeletonCard.remove();
            if (errorCard) errorCard.remove();
        }

        const replyStatus = chrome.querySelector('#tv-detail-reply-status');
        const hasReplies = articles.some(article => article.classList.contains('tv-detail-reply'));
        const replyMessage = hasReplies ? '' : (pending || hasInstant) ? '正在加载评论…' : root ? '暂无已加载评论' : '';
        if (replyStatus.textContent !== replyMessage) replyStatus.textContent = replyMessage;
        replyStatus.classList.toggle('tv-loading-shimmer', !hasReplies && (pending || hasInstant));
    }

    function move(direction) {
        if (!route) return false;
        if (overlay && overlay.isConnected) {
            const items = interactiveItems();
            if (!items.length) return true;
            if (direction === 'down') {
                if (selected === 0) selected = 1;
                else if (selected === 1) selected = 2;
                else if (selected === 2) selected = 0;
            } else if (direction === 'up') {
                if (selected === 0) selected = 2;
                else if (selected === 1) selected = 0;
                else if (selected === 2) selected = 1;
            } else if (direction === 'right' || direction === 'left') {
                if (selected === 1) selected = 2;
                else if (selected === 2) selected = 1;
            }
            focusComposer();
            return true;
        }
        if (direction === 'left' || direction === 'right') {
            pendingReplyMove = null;
            if (window.TvXCard?.isCardFocused()) window.TvXCard.unselect();
            if (direction === 'left') column = 'post';
            else if (column === 'comments') replyEntry = !replyEntry;
            else { column = 'comments'; replyEntry = !replies().length; }
            document.body.setAttribute('data-tv-detail-column', column);
            if (column === 'comments' && !replyEntry) selectReply(currentReply() || visibleReply());
            renderReplyFocus();
        } else if (direction === 'up' || direction === 'down') {
            if (column === 'post') {
                const target = root || instantRoot;
                if (direction === 'down' && target && window.TvXCard?.hasCard(target) && !window.TvXCard?.isCardFocused()) {
                    window.TvXCard.select(target);
                    renderReplyFocus();
                    return true;
                }
                if (direction === 'up' && window.TvXCard?.isCardFocused()) {
                    window.TvXCard.unselect();
                    renderReplyFocus();
                    return true;
                }
                const step = (direction === 'down' ? 1 : -1) * 716 * window.innerWidth / 1920 * 0.8;
                if (target) {
                    target.scrollBy({top:step,behavior:'instant'});
                    savedPostScroll = target.scrollTop;
                }
            } else if (column === 'comments') {
                moveReply(direction);
            }
        }
        return true;
    }

    function activate() {
        if (!route) return false;
        if (overlay && overlay.isConnected) {
            if (selected === 0) {
                activateInput();
                return true;
            }
            if (selected === 1) {
                submitReply();
                return true;
            }
            if (selected === 2) {
                closeComposer(false);
                return true;
            }
            return true;
        }
        if (column === 'post' && window.TvXCard?.isCardFocused()) {
            if (window.TvXCard.activate()) return true;
        }
        if (column === 'post' && !root && chrome?.querySelector('#tv-detail-error-card')) {
            if (window.TvXAdapter?.handleBack) window.TvXAdapter.handleBack();
            else history.back();
            return true;
        }
        if (column === 'comments' && !replyEntry) {
            const current = currentReply();
            if (current) openReply(current);
            else if (chrome) chrome.querySelector('#tv-detail-guidance').textContent = '评论已更新，按上下键重新选择　　→ 写评论　　返回 上一层';
            return true;
        }
        if (column === 'comments') {
            const entryBtn = chrome?.querySelector('#tv-detail-entry button');
            if (entryBtn && !entryBtn.disabled) {
                openComposer();
                return true;
            }
        }
        return false;
    }

    return {
        update,
        move,
        activate,
        statusLink: ownStatusLink,
        openComposer,
        closeComposer,
        submitReply,
        isOpen: () => !!overlay && overlay.isConnected,
        isPending: () => isPending,
        stash,
        getSnapshot,
        clearSnapshot
    };
})();
