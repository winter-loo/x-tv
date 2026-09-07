// TV-owned action UI. Native post nodes and their event handlers stay in place.
window.TvXActions = window.TvXActions || (function() {
    let overlay = null;
    let selected = 0;
    let context = null;
    let previousFocus = null;
    let transaction = null;
    let returnTimer = null;
    let listening = false;
    let originalPath = '';

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
        const button = control(context.article());
        if (!button) { status('帖子暂不可用，请返回后重试'); return; }
        const liked = button.dataset.testid === 'unlike';
        const action = transaction?.postId === context.postId ? transaction : null;
        const pending = action && ['arming', 'pending', 'waiting'].includes(action.phase);
        const confirmed = action?.phase === 'confirmed' && !action.consumed && liked === action.liked;
        const label = pending ? '正在确认…' : confirmed && action.liked ? '已喜欢' : liked ? '取消喜欢' : '喜欢';
        const target = buttons()[1];
        if (target.textContent !== label) target.textContent = label;
        target.classList.toggle('tv-action-liked', liked && !pending);
        target.setAttribute('aria-busy', String(!!pending));
        if (pending) status(action.phase === 'waiting' ? 'X 仍未确认，请稍候或返回关闭' : '正在等待 X 确认…    返回 关闭');
        else if (confirmed) {
            status(action.liked ? '已喜欢，即将返回帖子' : '已取消喜欢');
            if (action.liked && !returnTimer) returnTimer = setTimeout(() => {
                returnTimer = null;
                if (transaction === action && action.phase === 'confirmed') close();
            }, 800);
        } else if (action?.phase === 'failed') status('未能完成操作，请确认重试');
        else if (action && action.phase !== 'confirmed' && action.phase !== 'pending' && action.phase !== 'arming') status('尚未确认操作结果，请返回后检查，或稍后重试');
    }
    async function like() {
        const article = context.article();
        const button = control(article);
        if (!button || button.disabled || button.getAttribute('aria-disabled') === 'true') {
            status('喜欢按钮暂不可用，请稍后重试'); return;
        }
        if (transaction && ['arming', 'pending', 'waiting'].includes(transaction.phase)) return;
        const prior = transaction?.postId === context.postId ? transaction : null;
        // An unknown response plus an optimistic toggle is unsafe to invert on retry.
        if (prior?.sent && prior.phase !== 'confirmed' && button.dataset.testid === (prior.liked ? 'unlike' : 'like')) {
            status('结果尚未确认，请返回并重新打开帖子检查'); return;
        }
        const action = { postId: context.postId, liked: button.dataset.testid === 'like',
            token: crypto.randomUUID(), phase: 'arming' };
        transaction = action;
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

    function buttons() { return overlay ? Array.from(overlay.querySelectorAll('button')) : []; }
    function focus() {
        buttons().forEach((button, index) => button.classList.toggle('tv-action-focused', index === selected));
        buttons()[selected]?.focus({ preventScroll: true });
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
        overlay.remove();
        overlay = null;
        document.removeEventListener('focusin', trap, true);
        if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
        context?.restore();
        context = null;
        return true;
    }
    function trap(event) { if (overlay && !overlay.contains(event.target)) focus(); }
    function open(options) {
        if (overlay) return true;
        if (!options.article()) return false;
        context = options;
        originalPath = location.pathname;
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
        overlay = document.createElement('div');
        overlay.id = 'tv-action-overlay';
        overlay.innerHTML = '<section id="tv-action-menu" role="dialog" aria-modal="true" aria-labelledby="tv-action-title"><h2 id="tv-action-title">帖子操作</h2><button type="button">评论</button><button type="button">喜欢</button><p id="tv-action-status" role="status">↑↓ 选择    确认 执行    返回 关闭</p></section>';
        document.body.appendChild(overlay);
        buttons().forEach((button, index) => button.addEventListener('click', () => { selected = index; activate(); }));
        selected = 0;
        document.addEventListener('focusin', trap, true);
        focus();
        update();
        return true;
    }
    function move(direction) {
        if (!overlay) return false;
        if (direction === 'up' || direction === 'down') selected = 1 - selected;
        focus();
        return true;
    }
    function activate() {
        if (!overlay) return false;
        if (returnTimer || (transaction && ['arming', 'pending', 'waiting'].includes(transaction.phase))) return true;
        if (selected === 1) { like(); return true; }
        if (selected === 0 && context.article()) {
            const openPost = context.openPost;
            close();
            openPost();
        }
        return true;
    }
    function key(event) {
        if (!overlay) return false;
        if (event.key === 'Tab') move(event.shiftKey ? 'up' : 'down');
        else if (event.key.startsWith('Arrow')) move(event.key.slice(5).toLowerCase());
        else if (event.key === 'Enter' || event.key === ' ') activate();
        else if (event.key === 'Escape') close();
        // Consume other page shortcuts too: the native page must stay behind the menu.
        event.preventDefault();
        event.stopImmediatePropagation();
        return true;
    }
    return { open, close, move, activate, key, update, isOpen: () => !!overlay };
})();
