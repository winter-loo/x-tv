// TV-owned action UI. Native post nodes and their event handlers stay in place.
window.TvXActions = window.TvXActions || (function() {
    let overlay = null;
    let selected = 0;
    let context = null;
    let previousFocus = null;
    let transaction = null;
    const transactions = new Map();
    let returnTimer = null;
    let listening = false;
    let originalPath = '';

    let mode = 'menu'; // 'menu' | 'composer'
    let composerSelected = 0; // 0: input, 1: submit, 2: cancel
    let isReplyPending = false;
    const savedDrafts = new Map(); // postId -> string
    let cleanupReplyObserver = null;

    function isPending(action) { return !!action && ['arming', 'pending', 'waiting'].includes(action.phase); }
    function currentAction() { return context ? transactions.get(context.post.id) : null; }

    function needsRecovery(action, button) {
        return !!action?.sent && !isPending(action) && action.phase !== 'confirmed' &&
            (action.phase === 'unconfirmed' || button.dataset.testid === (action.liked ? 'unlike' : 'like'));
    }

    function control(article) {
        return article && Array.from(article.querySelectorAll('[data-testid="like"], [data-testid="unlike"]'))
            .find(button => button.closest('article') === article && button.closest('[role="group"]'));
    }
    function status(text) {
        const node = overlay?.querySelector('#tv-action-status');
        if (node && node.textContent !== text) node.textContent = text;
    }
    function result(message) {
        if (message.event !== 'tv_like_result' || !transaction || message.token !== transaction.token ||
            message.postId !== transaction.postId || message.liked !== transaction.liked) return;
        clearTimeout(transaction.timer);
        transaction.phase = message.outcome;
        if (!overlay) transaction.consumed = true;
        update();
    }
    function update() {
        if (!overlay) return;
        if (location.pathname !== originalPath) { close(); return; }
        if (mode !== 'menu') return;
        const button = control(context.article());
        if (!button) { status('帖子暂不可用，请返回后重试'); return; }
        const liked = button.dataset.testid === 'unlike';
        const action = currentAction();
        const pending = isPending(action);
        const synchronized = action?.phase === "confirmed" && liked === action.liked;
        const confirmed = action?.phase === 'confirmed' && !action.consumed && liked === action.liked;
        const recovery = needsRecovery(action, button);
        const label = recovery ? '重新载入帖子' : pending ? '正在确认…' : confirmed && action.liked ? '已喜欢' : liked ? '取消喜欢' : '喜欢';
        const target = buttons()[1];
        const awaitingCount = pending || recovery || (action?.phase === 'confirmed' && !synchronized);
        const count = awaitingCount ? action.previousCount : (button.textContent.trim() || '0');
        const comments = context.article().querySelector('[data-testid="reply"]')?.textContent.trim() || '0';
        const countText = '评论 ' + comments + ' · 喜欢 ' + count + (awaitingCount ? ' · 待确认' : '');
        const counts = overlay.querySelector('#tv-action-counts');
        if (counts && counts.textContent !== countText) counts.textContent = countText;
        if (target && target.textContent !== label) target.textContent = label;
        if (target) {
            target.classList.toggle('tv-action-liked', liked && !awaitingCount);
            target.setAttribute('aria-busy', String(!!pending));
        }
        if (recovery) status('尚未确认结果，确认重新载入帖子检查');
        else if (pending) status(action.phase === 'waiting' ? 'X 仍未确认，请稍候或返回关闭' : '正在等待 X 确认…    返回 关闭');
        else if (confirmed) {
            status(action.liked ? '已喜欢，即将返回帖子' : '已取消喜欢');
            if (action.liked && !returnTimer) returnTimer = setTimeout(() => {
                returnTimer = null;
                if (transaction === action && action.phase === 'confirmed') close();
            }, 800);
        } else if (action?.phase === 'failed') status('未能完成操作，请确认重试');
        else if (action && action.phase !== 'confirmed' && !isPending(action)) status('尚未确认操作结果，请返回后检查，或稍后重试');
    }
    async function like() {
        const article = context.article();
        const button = control(article);
        if (!button || button.disabled || button.getAttribute('aria-disabled') === 'true') {
            status('喜欢按钮暂不可用，请稍后重试'); return;
        }
        if (isPending(transaction)) {
            if (!currentAction()) status('另一条帖子的操作仍在确认，请稍候');
            return;
        }
        const prior = currentAction();
        if (needsRecovery(prior, button)) {
            const reloadPost = context.reloadPost;
            close();
            reloadPost();
            return;
        }
        const action = { postId: context.post.id, liked: button.dataset.testid === 'like',
            token: crypto.randomUUID(), phase: 'arming', previousCount: button.textContent.trim() || '0' };
        transaction = action;
        transactions.set(action.postId, action);
        update();
        let armed;
        try { armed = await browser.runtime.sendMessage({ event: 'tv_like_arm', postId: action.postId, liked: action.liked, token: action.token }); }
        catch (_) { /* The page control is not clicked without a confirmation channel. */ }
        if (transaction !== action || action.phase !== 'arming') {
            browser.runtime.sendMessage({ event: 'tv_like_disarm', token: action.token }).catch(() => {});
            return;
        }
        if (!armed?.armed || !overlay || control(context.article()) !== button || button.disabled ||
            button.getAttribute('aria-disabled') === 'true' || button.dataset.testid !== (action.liked ? 'like' : 'unlike')) {
            browser.runtime.sendMessage({ event: 'tv_like_disarm', token: action.token }).catch(() => {});
            action.phase = 'failed'; update(); return;
        }
        action.phase = 'pending';
        action.timer = setTimeout(() => { if (action.phase === 'pending') { action.phase = 'waiting'; update(); } }, 16000);
        action.sent = true;
        button.click();
        update();
    }

    function buttons() { return overlay ? Array.from(overlay.querySelectorAll('#tv-action-menu button')) : []; }
    function focus() {
        if (mode !== 'menu') return;
        buttons().forEach((button, index) => button.classList.toggle('tv-action-focused', index === selected));
        buttons()[selected]?.focus({ preventScroll: true });
    }

    function escapeHtml(str) {
        if (!str) return '';
        return String(str).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
    }

    function getAccountIdentity() {
        const switcher = document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]');
        const img = switcher?.querySelector('img');
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
        const article = context?.article?.();
        if (!article) return '回复 帖子';
        const userNames = Array.from(article.querySelectorAll('[data-testid="User-Name"]'));
        const userName = userNames.find(n => !n.closest('[role="link"]')) || userNames[0];
        if (!userName) return '回复 帖子';
        const spans = Array.from(userName.querySelectorAll('span')).map(s => s.textContent.trim()).filter(Boolean);
        const handle = spans.find(s => s.startsWith('@'));
        if (handle) return '回复 ' + handle;
        const authorName = spans[0] || '';
        return authorName ? '回复 ' + authorName : '回复 帖子';
    }

    function composerItems() {
        return overlay ? [
            overlay.querySelector('#tv-composer-input'),
            overlay.querySelector('#tv-composer-submit'),
            overlay.querySelector('#tv-composer-cancel')
        ].filter(Boolean) : [];
    }

    function activateInput() {
        const input = overlay?.querySelector('#tv-composer-input');
        if (!input) return;
        input.focus({ preventScroll: true });
        const len = input.value ? input.value.length : 0;
        try { input.setSelectionRange(len, len); } catch (_) {}
        try {
            input.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
        } catch (_) {}
    }

    function focusComposer() {
        const items = composerItems();
        if (!items.length) return;
        if (composerSelected < 0) composerSelected = 0;
        if (composerSelected >= items.length) composerSelected = items.length - 1;
        items.forEach((item, index) => {
            item.classList.toggle('tv-composer-focused', index === composerSelected);
        });
        items[composerSelected]?.focus({ preventScroll: true });
        if (composerSelected === 0) {
            const input = items[0];
            const len = input.value ? input.value.length : 0;
            try { input.setSelectionRange(len, len); } catch (_) {}
        }
    }

    function openComposer() {
        if (!overlay || !context?.article?.()) return false;
        mode = 'composer';
        overlay.classList.add('tv-composer-mode');

        const menuNode = overlay.querySelector('#tv-action-menu');
        if (menuNode) menuNode.remove();

        const identity = getAccountIdentity();
        const targetText = getReplyTarget();
        const existingDraft = (context?.post?.id && savedDrafts.get(context.post.id)) || '';

        const dialog = document.createElement('div');
        dialog.id = 'tv-composer-dialog';
        dialog.setAttribute('role', 'dialog');
        dialog.setAttribute('aria-modal', 'true');
        dialog.setAttribute('aria-label', '写回复');
        dialog.innerHTML = `
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
        `;
        overlay.appendChild(dialog);

        const input = dialog.querySelector('#tv-composer-input');
        const submitBtn = dialog.querySelector('#tv-composer-submit');
        const cancelBtn = dialog.querySelector('#tv-composer-cancel');

        if (existingDraft) {
            input.value = existingDraft;
            const hasText = !!existingDraft.trim();
            submitBtn.setAttribute('aria-disabled', String(!hasText));
        } else {
            submitBtn.setAttribute('aria-disabled', 'true');
        }

        function syncDraft() {
            if (context?.post?.id) savedDrafts.set(context.post.id, input.value);
            const hasText = !!input.value.trim();
            submitBtn.setAttribute('aria-disabled', String(!hasText || isReplyPending));
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

        input.addEventListener('focus', () => { composerSelected = 0; focusComposer(); });
        submitBtn.addEventListener('focus', () => { composerSelected = 1; focusComposer(); });
        cancelBtn.addEventListener('focus', () => { composerSelected = 2; focusComposer(); });

        submitBtn.addEventListener('click', () => { composerSelected = 1; submitReply(); });
        cancelBtn.addEventListener('click', () => { composerSelected = 2; close(); });

        composerSelected = 0;
        focusComposer();
        activateInput();
        return true;
    }

    function submitReply() {
        if (!overlay || mode !== 'composer' || isReplyPending) return false;
        const input = overlay.querySelector('#tv-composer-input');
        const text = input ? input.value.trim() : '';
        const submitBtn = overlay.querySelector('#tv-composer-submit');
        if (!text || submitBtn?.getAttribute('aria-disabled') === 'true') return false;

        isReplyPending = true;
        if (context?.post?.id) savedDrafts.set(context.post.id, input.value);
        const status = overlay.querySelector('#tv-composer-status');

        input.disabled = true;
        submitBtn.setAttribute('aria-disabled', 'true');
        submitBtn.setAttribute('aria-busy', 'true');
        if (status) {
            status.textContent = '正在发送回复…';
            status.className = 'tv-status-pending';
        }

        const article = context.article();

        let nativeInput = document.querySelector('[data-testid="tweetTextarea_0"]');
        if (!nativeInput && article) {
            const nativeReplyBtn = article.querySelector('[data-testid="reply"]');
            if (nativeReplyBtn) nativeReplyBtn.click();
        }

        nativeInput = document.querySelector('[data-testid="tweetTextarea_0"]');
        const nativeSubmit = document.querySelector('[data-testid="tweetButtonInline"], [data-testid="tweetButton"]');

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

        const prevCountText = article?.querySelector('[data-testid="reply"]')?.textContent.trim() || '0';
        const prevCount = parseInt(prevCountText, 10) || 0;
        const existingArticles = new Set(Array.from(document.querySelectorAll('article[data-testid="tweet"]')));

        let replySettled = false;
        let timeoutTimer = null;
        let domObserver = null;

        function cleanup() {
            if (domObserver) {
                domObserver.disconnect();
                domObserver = null;
            }
            window.removeEventListener('tv_reply_result', onReplyResult);
            clearTimeout(timeoutTimer);
            cleanupReplyObserver = null;
        }
        cleanupReplyObserver = cleanup;

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
            const currentArticles = Array.from(document.querySelectorAll('article[data-testid="tweet"]'));
            const hasNewArticle = currentArticles.some(a => !existingArticles.has(a));
            if (hasNewArticle) {
                succeed();
                return;
            }
            const currentCountText = article?.querySelector('[data-testid="reply"]')?.textContent.trim() || '0';
            const currentCount = parseInt(currentCountText, 10) || 0;
            if (currentCount > prevCount) {
                succeed();
                return;
            }
            const curInput = document.querySelector('[data-testid="tweetTextarea_0"]');
            const curSubmit = document.querySelector('[data-testid="tweetButtonInline"], [data-testid="tweetButton"]');
            if (curInput && (curInput.value === '' || curInput.textContent === '') && curSubmit?.getAttribute('aria-disabled') === 'true') {
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
        isReplyPending = false;
        if (context?.post?.id) savedDrafts.delete(context.post.id);
        if (!overlay || mode !== 'composer') return;

        const status = overlay.querySelector('#tv-composer-status');
        const submitBtn = overlay.querySelector('#tv-composer-submit');
        const sentBadge = overlay.querySelector('#tv-composer-sent');

        if (status) {
            status.textContent = '已发送，即将返回帖子';
            status.className = 'tv-status-success';
        }
        if (sentBadge) sentBadge.hidden = false;
        if (submitBtn) {
            submitBtn.setAttribute('aria-disabled', 'true');
            submitBtn.removeAttribute('aria-busy');
            submitBtn.textContent = '已发送';
        }
        overlay.classList.add('tv-composer-success');

        returnTimer = setTimeout(() => {
            returnTimer = null;
            close();
        }, 600);
    }

    function handleFailure(err) {
        isReplyPending = false;
        if (!overlay || mode !== 'composer') return;

        const status = overlay.querySelector('#tv-composer-status');
        const submitBtn = overlay.querySelector('#tv-composer-submit');
        const input = overlay.querySelector('#tv-composer-input');

        if (input) {
            input.disabled = false;
            input.value = (context?.post?.id && savedDrafts.get(context.post.id)) || '';
        }
        if (status) {
            status.textContent = typeof err === 'string' ? err : '未能发送回复，请确认重试';
            status.className = 'tv-status-error';
        }
        if (submitBtn) {
            submitBtn.setAttribute('aria-disabled', 'false');
            submitBtn.removeAttribute('aria-busy');
            submitBtn.textContent = '重试';
        }
        composerSelected = 1;
        focusComposer();
    }

    function close() {
        if (!overlay) return false;
        if (transaction?.phase === 'arming') {
            transaction.phase = 'cancelled';
            browser.runtime.sendMessage({ event: 'tv_like_disarm', token: transaction.token }).catch(() => {});
        }
        if (transaction?.phase === "confirmed") transaction.consumed = true;
        clearTimeout(returnTimer);
        returnTimer = null;
        if (cleanupReplyObserver) {
            cleanupReplyObserver();
            cleanupReplyObserver = null;
        }
        isReplyPending = false;
        mode = 'menu';
        overlay.remove();
        overlay = null;
        document.removeEventListener('focusin', trap, true);
        if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
        context?.restore();
        context = null;
        return true;
    }

    function trap(event) {
        if (!overlay) return;
        if (!overlay.contains(event.target)) {
            if (mode === 'composer') focusComposer();
            else focus();
        }
    }

    function open(options) {
        if (overlay) {
            if (mode === 'menu' && context?.post.id === options.post.id && options.initialAction === 'like') {
                selected = 1;
                focus();
            }
            return true;
        }
        if (!options.article()) return false;
        context = options;
        originalPath = location.pathname;
        mode = 'menu';
        selected = 0;
        composerSelected = 0;
        isReplyPending = false;
        if (!listening && browser.runtime.onMessage) {
            browser.runtime.onMessage.addListener(result);
            listening = true;
        }
        previousFocus = document.activeElement;
        if (!document.getElementById('tv-x-action-styles')) {
            const style = document.createElement('link');
            style.id = 'tv-x-action-styles';
            style.rel = 'stylesheet';
            style.href = browser.runtime.getURL('sites/x/actions.css');
            (document.head || document.documentElement).appendChild(style);
        }
        const article = options.article();
        const externalLinks = window.TvXCard?.findExternalLinks(article) || [];
        let linksHtml = '';
        if (externalLinks.length > 0) {
            linksHtml = '<div class="tv-action-divider"></div><div class="tv-action-section-title">外链文章</div>' +
                externalLinks.map(link => `
                    <button type="button" class="tv-action-btn-link" data-url="${escapeHtml(link.url)}" data-title="${escapeHtml(link.title)}" data-domain="${escapeHtml(link.domain)}">
                        <span class="tv-action-link-title">${escapeHtml(link.title)}</span>
                        <span class="tv-action-link-domain">${escapeHtml(link.domain)}</span>
                    </button>
                `).join('');
        }

        overlay = document.createElement('div');
        overlay.id = 'tv-action-overlay';
        overlay.innerHTML = `<section id="tv-action-menu" role="dialog" aria-modal="true" aria-labelledby="tv-action-title"><div id="tv-action-heading"><h2 id="tv-action-title">帖子操作</h2><span id="tv-action-counts" aria-label="帖子互动计数"></span></div><button type="button" class="tv-action-btn-comment">评论</button><button type="button" class="tv-action-btn-like">喜欢</button>${linksHtml}<p id="tv-action-status" role="status">↑↓ 选择    确认 执行    返回 关闭</p></section>`;
        document.body.appendChild(overlay);
        buttons().forEach((button, index) => button.addEventListener('click', () => { selected = index; activate(); }));
        selected = options.initialAction === 'like' ? 1 : 0;
        document.addEventListener('focusin', trap, true);
        focus();
        update();
        return true;
    }

    function move(direction) {
        if (!overlay) return false;
        if (mode === 'menu') {
            const list = buttons();
            if (!list.length) return true;
            if (direction === 'up') selected = (selected - 1 + list.length) % list.length;
            else if (direction === 'down') selected = (selected + 1) % list.length;
            focus();
            return true;
        }
        if (mode === 'composer') {
            const items = composerItems();
            if (!items.length) return true;
            if (direction === 'down') {
                if (composerSelected === 0) composerSelected = 1;
                else if (composerSelected === 1) composerSelected = 2;
                else if (composerSelected === 2) composerSelected = 0;
            } else if (direction === 'up') {
                if (composerSelected === 0) composerSelected = 2;
                else if (composerSelected === 1) composerSelected = 0;
                else if (composerSelected === 2) composerSelected = 1;
            } else if (direction === 'right' || direction === 'left') {
                if (composerSelected === 1) composerSelected = 2;
                else if (composerSelected === 2) composerSelected = 1;
            }
            focusComposer();
            return true;
        }
        return false;
    }

    function activate() {
        if (!overlay) return false;
        if (returnTimer) return true;
        if (mode === 'menu') {
            const list = buttons();
            const btn = list[selected];
            if (btn && btn.classList.contains('tv-action-btn-link')) {
                const url = btn.dataset.url;
                const title = btn.dataset.title;
                const domain = btn.dataset.domain;
                close();
                window.TvXCard?.open(url, title, domain);
                return true;
            }
            if (selected === 1) { like(); return true; }
            if (selected === 0 && context.article()) {
                if (location.pathname === '/home' || originalPath === '/home') {
                    openComposer();
                    return true;
                }
                const openPost = context.openPost;
                close();
                openPost();
                return true;
            }
            return true;
        }
        if (mode === 'composer') {
            if (composerSelected === 0) {
                activateInput();
                return true;
            }
            if (composerSelected === 1) {
                submitReply();
                return true;
            }
            if (composerSelected === 2) {
                close();
                return true;
            }
            return true;
        }
        return true;
    }

    function key(event) {
        if (!overlay) return false;
        if (mode === 'composer') {
            if (event.key === 'Escape') {
                close();
                event.preventDefault();
                event.stopImmediatePropagation();
                return true;
            }
            if (event.key === 'Tab') {
                move(event.shiftKey ? 'up' : 'down');
                event.preventDefault();
                event.stopImmediatePropagation();
                return true;
            }
            if (composerSelected === 0) {
                if (event.key === 'ArrowDown') {
                    move('down');
                    event.preventDefault();
                    event.stopImmediatePropagation();
                    return true;
                }
                if (event.key === 'ArrowUp') {
                    move('up');
                    event.preventDefault();
                    event.stopImmediatePropagation();
                    return true;
                }
                if (event.key === 'Enter') {
                    if (event.ctrlKey || event.metaKey) {
                        submitReply();
                        event.preventDefault();
                        event.stopImmediatePropagation();
                        return true;
                    }
                    activateInput();
                    event.preventDefault();
                    event.stopImmediatePropagation();
                    return true;
                }
            } else {
                if (event.key === 'ArrowDown') { move('down'); event.preventDefault(); event.stopImmediatePropagation(); return true; }
                if (event.key === 'ArrowUp') { move('up'); event.preventDefault(); event.stopImmediatePropagation(); return true; }
                if (event.key === 'ArrowLeft') { move('left'); event.preventDefault(); event.stopImmediatePropagation(); return true; }
                if (event.key === 'ArrowRight') { move('right'); event.preventDefault(); event.stopImmediatePropagation(); return true; }
                if (event.key === 'Enter' || event.key === ' ') { activate(); event.preventDefault(); event.stopImmediatePropagation(); return true; }
                event.preventDefault();
                event.stopImmediatePropagation();
                return true;
            }
            return true;
        }
        if (event.key === 'Tab') move(event.shiftKey ? 'up' : 'down');
        else if (event.key.startsWith('Arrow')) move(event.key.slice(5).toLowerCase());
        else if (event.key === 'Enter' || event.key === ' ') activate();
        else if (event.key === 'Escape') close();
        // Consume other page shortcuts too: the native page must stay behind the menu.
        event.preventDefault();
        event.stopImmediatePropagation();
        return true;
    }

    return {
        open,
        close,
        move,
        activate,
        key,
        update,
        isOpen: () => !!overlay,
        isComposerOpen: () => !!overlay && mode === 'composer',
        isReplyPending: () => isReplyPending,
        openComposer,
        submitReply,
        closeComposer: () => close()
    };
})();
