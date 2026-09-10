(function() {
'use strict';
var stage = document.getElementById('stage'), title = document.getElementById('title'),
    help = document.getElementById('help');
var sequence = 0, pending = 'r0', stack = [], homeRefresh = '',
    state = {mode: 'home', posts: [], index: 0, cursor: '', region: 'post'}, viewer = null, paging = false,
    refreshing = false;
var homeScene = state, actionMenu = null, external = null, likeOps = {}, likeQueue = [],
    likeSending = '', verifySequence = 0, writeSequence = 0, pendingWrite = null, writeRevision = 0, readRevision = 0, written = {};
function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function(c) {
        return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;'}[c];
    });
}
function notice(text) {
    document.getElementById('notice').textContent = text;
}
function current() {
    return state.mode === 'home' ? state.posts[state.index] : state.root;
}
/** Recent posts read better as an age; older ones need a date, and another year needs the year. */
function timeLabel(created) {
    var at = Date.parse(created || '');
    if (isNaN(at)) return '';
    var seconds = Math.floor((Date.now() - at) / 1000), when = new Date(at);
    if (seconds < 60) return '刚刚';
    if (seconds < 3600) return Math.floor(seconds / 60) + ' 分钟前';
    if (seconds < 86400) return Math.floor(seconds / 3600) + ' 小时前';
    if (seconds < 86400 * 7) return Math.floor(seconds / 86400) + ' 天前';
    return (when.getFullYear() === new Date().getFullYear() ? '' : when.getFullYear() + ' 年 ') +
        (when.getMonth() + 1) + ' 月 ' + when.getDate() + ' 日';
}
/** The detail spells it out, so a post from another year is never ambiguous. */
function fullTime(created) {
    var at = Date.parse(created || '');
    if (isNaN(at)) return '';
    var when = new Date(at);
    function pad(value) {
        return (value < 10 ? '0' : '') + value;
    }
    return when.getFullYear() + ' 年 ' + (when.getMonth() + 1) + ' 月 ' + when.getDate() + ' 日 ' +
        pad(when.getHours()) + ':' + pad(when.getMinutes());
}
function timeHtml(post, detail) {
    var label = detail ? fullTime(post.created) : timeLabel(post.created);
    return label ? '<span class="time">' + esc(label) + '</span>' : '';
}
function author(post, detail) {
    return '<div class="author">' +
        (post.author.avatar ? '<img class="avatar" src="' + esc(post.author.avatar) + '" alt="">' : '') +
        '<div><div class="name">' + esc(post.author.name) + '</div><div class="handle">@' +
        esc(post.author.handle) + timeHtml(post, detail) + '</div></div></div>';
}
function media(post) {
    var item = post.media[0];
    return item ? '<div class="media' + (state.region === 'media' ? ' focus' : '') + '"><img src="' +
            esc(item.image) + '" alt="' + esc(item.alt) + '"></div>' :
                  '';
}
function text(post) {
    return '<div class="text">' + esc(post.text) + '</div>' +
        (post.quoted ? '<div class="quote"><b>' + esc(post.quoted.author.name) + '</b><br>' +
                 esc(post.quoted.text) + '</div>' :
                       '');
}
/** A label with its count, or just the label when X sent no count for it. */
function countLabel(label, value) {
    return value == null ? label : label + ' ' + esc(value);
}
function actionCounts(post) {
    return [countLabel('评论', post.replies), countLabel('喜欢', post.likes)].join(' · ');
}
/** Only counts X actually sent are shown, and every number carries its own icon. */
function stat(kind, label, value, extra) {
    if (value == null) return '';
    return '<span class="stat' + (extra || '') + '">' + statIcon(kind) + '<span>' + label + ' ' +
        esc(value) + '</span></span>';
}
function stats(post) {
    var row = stat('comments', '评论', post.replies) +
        stat('like', post.liked ? '已喜欢' : '喜欢', post.likes, post.liked ? ' like liked' : ' like') +
        stat('views', '浏览', post.views);
    return row ? '<div class="stats">' + row + '</div>' : '';
}
function statIcon(kind) {
    var paths = {
        comments: 'M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-7l-5 4v-4H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
        like: 'M12 21 3.5 12.5C-2 6.5 6 0 12 6c6-6 14 .5 8.5 6.5z',
        views: 'M4 20V10m5 10V3m6 17v-7m5 7V7'
    };
    return '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor"' +
        ' stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="' +
        paths[kind] + '"></path></svg>';
}
function linkIcon() {
    return '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor"' +
        ' stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0' +
        ' 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"></path><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7' +
        'l1.7-1.7"></path></svg>';
}
function closeActions() {
    if (!actionMenu) return;
    actionMenu.node.remove();
    actionMenu = null;
    render();
}
function focusAction() {
    var buttons = actionMenu.node.querySelectorAll('button');
    for (var i = 0; i < buttons.length; i++) {
        buttons[i].classList.toggle('selected', i === actionMenu.index);
        if (i === actionMenu.index) buttons[i].focus();
    }
}
function activateAction() {
    var item = actionMenu.items[actionMenu.index], post = actionMenu.post;
    closeActions();
    if (item.action === 'external') { openExternal(item.link); return; }
    if (item.action === 'like') { toggleLike(post); return; }
    if (pendingWrite) { notice('上一项操作正在完成…'); return; }
    var id = 'w' + (++writeSequence);
    pendingWrite = {id: id, postId: post.id};
    notice('');
    ReaderHost.write(id, post.id, 'reply', false, post.author.name || post.author.handle);
}
function scenes() {
    return [state, homeScene].concat(stack);
}
/** Puts a like state on every copy of the post and shields it from reads already in flight. */
function applyLike(postId, liked, likes) {
    var seen = [], revision = ++writeRevision, count = likes;
    function update(post) {
        if (!post || post.id !== postId || seen.indexOf(post) >= 0) return;
        seen.push(post);
        var changed = post.liked !== liked;
        if (typeof count === 'number') post.likes = count;
        else if (changed && /^\d+$/.test(String(post.likes)))
            post.likes = Math.max(0, Number(post.likes) + (liked ? 1 : -1));
        post.liked = liked;
        if (typeof count !== 'number' && /^\d+$/.test(String(post.likes))) count = Number(post.likes);
    }
    scenes().forEach(function(scene) {
        update(scene.root);
        (scene.posts || []).forEach(update);
        if (scene.pendingHome) scene.pendingHome.posts.forEach(update);
    });
    var change = written[postId] || (written[postId] = {});
    change.likeRevision = revision;
    change.like = {liked: liked};
    if (typeof count === 'number') change.like.likes = count;
    updateLikeView(postId);
}
// Update only the statistics and menu: network callbacks must not rebuild a reading scene.
function updateLikeView(postId) {
    var post = current();
    if (post && post.id === postId) {
        var node = stage.querySelector('.stats');
        if (node) node.outerHTML = stats(post);
    }
    if (actionMenu && actionMenu.post.id === postId) {
        post = actionMenu.post;
        var change = written[postId].like;
        post.liked = change.liked;
        if (typeof change.likes === 'number') post.likes = change.likes;
        var button = actionMenu.node.querySelectorAll('button')[1];
        actionMenu.items[1].label = post.liked ? '取消喜欢' : '喜欢';
        button.querySelector('.label').textContent = actionMenu.items[1].label;
        button.classList.toggle('liked', post.liked);
        actionMenu.node.querySelector('.action-counts').textContent = actionCounts(post);
    }
}
function likeNotice(postId, message) {
    written[postId].message = message;
    if (current() && current().id === postId) notice(message);
}
/** The remote is the only authority on intent; the request that carries it goes out behind it. */
function toggleLike(post) {
    var postId = post.id, op = likeOps[postId];
    if (!op)
        op = likeOps[postId] = {
            confirmed: !!post.liked,
            desired: !!post.liked,
            author: post.author.name || post.author.handle,
            count: /^\d+$/.test(String(post.likes)) ? Number(post.likes) : undefined,
            attempts: 0,
            sending: '',
            verifying: ''
        };
    op.desired = !op.desired;
    applyLike(postId, op.desired, typeof op.count === 'number' ?
        Math.max(0, op.count + (op.desired === op.confirmed ? 0 : op.desired ? 1 : -1)) : undefined);
    likeNotice(postId, op.unknown ? '喜欢结果正在核对…' : '');
    if (op.unknown) verifyLike(postId);
    else queueLike(postId);
}
/**
 * Delays before each retry. A cold app answers "not ready" until the browser has warmed up,
 * which took ~2.8 s on the projector, so the ladder has to outlast that and still be bounded.
 */
var LIKE_RETRY_MS = [800, 1600, 3200];
function queueLike(postId) {
    if (likeQueue.indexOf(postId) < 0) likeQueue.push(postId);
    pumpLikes();
}
function retryLike(postId) {
    var op = likeOps[postId];
    if (!op) return;
    var delay = LIKE_RETRY_MS[op.attempts - 1];
    if (delay === undefined) { giveUpLike(postId); return; }
    op.waiting = setTimeout(function() {
        op.waiting = 0;
        queueLike(postId);
    }, delay);
}
function giveUpLike(postId) {
    var op = likeOps[postId];
    if (!op) return;
    applyLike(postId, op.confirmed, op.count);
    delete likeOps[postId];
    likeNotice(postId, '喜欢状态未能提交，请稍后重试。');
    pumpLikes();
}
/** One like request in flight at a time: the native writer serialises them anyway. */
function pumpLikes() {
    while (!likeSending && likeQueue.length) {
        var postId = likeQueue.shift(), op = likeOps[postId];
        if (!op || op.sending || op.unknown) continue;
        if (op.waiting) continue;
        if (op.confirmed === op.desired) { delete likeOps[postId]; continue; }
        if (op.attempts >= LIKE_RETRY_MS.length + 1) { giveUpLike(postId); continue; }
        op.attempts++;
        op.sentDesired = op.desired;
        op.sending = likeSending = 'w' + (++writeSequence);
        ReaderHost.write(op.sending, postId, 'like', op.desired, op.author);
    }
}
/** Shows the intent the user is waiting on, keeping the server's count as the baseline. */
function showIntent(postId, op) {
    applyLike(postId, op.desired,
        typeof op.count === 'number' ? Math.max(0, op.count + (op.desired ? 1 : -1)) : undefined);
}
function likeResult(postId, id, result) {
    var op = likeOps[postId];
    op.sending = '';
    if (likeSending === id) likeSending = '';
    if (result.status === 'ok') {
        op.attempts = 0;
        if (typeof result.likes === 'number') op.count = result.likes;
        else if (typeof op.count === 'number' && op.confirmed !== !!result.liked)
            op.count = Math.max(0, op.count + (result.liked ? 1 : -1));
        op.confirmed = !!result.liked;
        if (op.confirmed === op.desired) {
            applyLike(postId, op.confirmed, op.count);
            likeNotice(postId, '');
            delete likeOps[postId];
        } else {
            showIntent(postId, op);
            queueLike(postId);
        }
    } else if (result.status === 'unknown') {
        op.unknown = true;
        op.checks = 0;
        verifyLike(postId);
    } else if (result.status === 'busy' || result.status === 'not_ready') {
        retryLike(postId);
    } else {
        applyLike(postId, op.confirmed, op.count);
        likeNotice(postId, writeMessage(result.status));
        delete likeOps[postId];
    }
    pumpLikes();
}
/** Keep uncertainty separate from failure, even if the read itself fails. */
function verifyLike(postId) {
    var op = likeOps[postId];
    if (!op || !op.unknown || op.verifying || op.checkWaiting) return;
    op.verifying = 'v' + (++verifySequence);
    op.checks++;
    likeNotice(postId, '喜欢结果正在核对…');
    ReaderHost.verify(op.verifying, postId);
}
function verifyResult(id, postId, payload, error) {
    var op = likeOps[postId];
    if (!op || op.verifying !== id) return;
    op.verifying = '';
    var root = !error && payload ? TvXReadData.parse(payload, 'detail', postId).root : null;
    if (!root || !root.likeKnown) {
        var delay = LIKE_RETRY_MS[op.checks - 1];
        if (delay !== undefined) op.checkWaiting = setTimeout(function() {
            op.checkWaiting = 0;
            verifyLike(postId);
        }, delay);
        else likeNotice(postId, '喜欢结果暂时无法核对，请刷新后查看。');
        pumpLikes();
        return;
    }
    op.unknown = false;
    op.confirmed = root.liked;
    if (/^\d+$/.test(String(root.likes))) op.count = Number(root.likes);
    // Only an intent different from the uncertain submission may cause a new write.
    // A read that disagrees with that submission is not proof it can safely be replayed.
    if (op.desired === op.sentDesired || op.confirmed === op.desired) {
        applyLike(postId, op.confirmed, op.count);
        likeNotice(postId, op.confirmed ? '核对完成：已喜欢' : '核对完成：未喜欢');
        delete likeOps[postId];
    } else {
        showIntent(postId, op);
        queueLike(postId);
    }
    pumpLikes();
}
function recheckLikes() {
    Object.keys(likeOps).forEach(function(postId) {
        var op = likeOps[postId];
        if (op.unknown && !op.verifying && !op.checkWaiting) {
            op.checks = 0;
            verifyLike(postId);
        }
    });
}
function writeMessage(status) {
    var messages = {
        unknown: '操作结果尚未确认，请刷新查看，勿重复提交。',
        not_ready: '登录会话正在准备，请稍后重试。',
        session: '登录状态已变化，请重新登录。',
        rate_limit: '操作过于频繁，请稍后再试。',
        busy: '上一项操作正在完成，请稍候。'
    };
    return messages[status] || '操作未完成，请稍后重试。';
}
function writeResult(id, postId, result) {
    var op = likeOps[postId];
    if (op && op.sending === id) { likeResult(postId, id, result); return; }
    if (!pendingWrite || pendingWrite.id !== id || pendingWrite.postId !== postId) return;
    pendingWrite = null;
    if (result.status === 'ok') {
        var seen = [], revision = ++writeRevision;
        var reply = result.reply ? TvXReadData.parse({data:{tweet_results:{result:result.reply}}},'home').posts[0] : null;
        var change = written[postId] || {};
        change.replyRevision = revision;
        change.reply = reply;
        written[postId] = change;
        function update(post) {
            if (!post || post.id !== postId || seen.indexOf(post) >= 0) return;
            seen.push(post);
            if (/^\d+$/.test(String(post.replies))) { post.replies = Number(post.replies)+1; change.replyCount = post.replies; }
        }
        scenes().forEach(function(scene) {
            update(scene.root); (scene.posts || []).forEach(update);
            if (scene.pendingHome) scene.pendingHome.posts.forEach(update);
            if (reply && scene.mode === 'detail' && scene.id === postId && !scene.posts.some(function(p){return p.id===reply.id;})) scene.posts.unshift(reply);
        });
        saveScroll(); render();
        notice('评论已发送');
    } else if (result.status !== 'cancelled') {
        notice(writeMessage(result.status));
    }
}
// Protect successful writes against reads that were already in flight when the write completed.
function preserveWrites(data, requestedAt) {
    [data.root].concat(data.posts || []).forEach(function(post) {
        if (!post) return;
        var change = written[post.id];
        if (!change) return;
        // A like still being coordinated outranks any read, however fresh that read looks.
        if (change.likeRevision > requestedAt || likeOps[post.id]) {
            post.liked = change.like.liked;
            if (typeof change.like.likes === 'number') post.likes = change.like.likes;
        }
        if (change.replyRevision > requestedAt && typeof change.replyCount === 'number') post.replies = Math.max(Number(post.replies)||0,change.replyCount);
    });
    var rootId = data.root ? data.root.id : state.mode === 'detail' ? state.id : '';
    var change = written[rootId];
    if (change && change.replyRevision > requestedAt && change.reply) {
        if (!(data.posts || []).some(function(p){return p.id===change.reply.id;})) data.posts.unshift(change.reply);
    }
    return data;
}
/** Opening an external target is modal: the reader stays put until the host reports back. */
function openExternal(link) {
    saveScroll();
    external = {url: link.url, title: link.title, domain: link.domain, failed: false};
    renderExternal();
    ReaderHost.openExternal(link.url);
}
function renderExternal() {
    var node = document.querySelector('.external-status');
    if (!external) {
        if (node) node.remove();
        return;
    }
    if (!node) {
        node = document.createElement('div');
        node.className = 'external-status';
        node.setAttribute('role', 'status');
        document.body.appendChild(node);
    }
    node.innerHTML = '<section><div class="domain">' + linkIcon() + esc(external.domain) +
        '</div><div class="title">' + esc(external.title) + '</div><p>' +
        (external.failed ? '未能打开这个链接　 确认 重试　 返回 回到帖子' : '正在打开…　 返回 取消') +
        '</p></section>';
}
function externalFailed(url) {
    if (!external || external.url !== url) return;
    external.failed = true;
    renderExternal();
}
function closeExternal() {
    if (!external) return false;
    external = null;
    renderExternal();
    render();
    return true;
}
function externalClosed() {
    closeExternal();
}
function openActions() {
    var post = current();
    if (!post || actionMenu) return;
    saveScroll();
    if (state.mode === 'home') state.interacted = true;
    var items = [
        {label: '写评论', icon: 'comments', path: post.path, action: 'reply'},
        {label: post.liked ? '取消喜欢' : '喜欢', icon: 'like', path: post.path, action: 'like'}
    ];
    (post.links || []).forEach(function(link) {
        items.push({label: link.title, domain: link.domain, link: link, action: 'external'});
    });
    var node = document.createElement('div');
    node.className = 'action-overlay';
    node.innerHTML = '<section class="action-dialog" role="dialog" aria-modal="true" aria-labelledby="action-title">' +
        '<h2 id="action-title">帖子操作</h2><div class="action-counts">' + actionCounts(post) + '</div><div class="action-options">' +
        items.map(function(item, i) {
            return '<button type="button" class="' +
                (item.action === 'external' ? 'external' : i === 1 && post.liked ? 'liked' : '') + '">' +
                (item.icon ? statIcon(item.icon) : linkIcon()) + '<span class="lines"><span class="label">' +
                esc(item.label) + '</span>' +
                (item.domain ? '<span class="domain">' + esc(item.domain) + '</span>' : '') +
                '</span></button>';
        }).join('') + '</div><p>↑↓ 选择　 确认 打开　 返回 关闭</p></section>';
    document.body.appendChild(node);
    actionMenu = {node: node, items: items, index: 0, post: post};
    var buttons = node.querySelectorAll('button');
    for (var i = 0; i < buttons.length; i++) (function(index) {
        buttons[index].onclick = function() {
            actionMenu.index = index;
            activateAction();
        };
    })(i);
    focusAction();
}
function fetching(post, detail) {
    if (!detail || post.complete) return '';
    return '<div class="fetching">' +
        (state.error ? '完整正文获取失败　 确认 重试' : '正在取完整正文…') + '</div>';
}
function linkCards(post) {
    return (post.links || [])
        .map(function(link, index) {
            return '<div class="link-card" role="button" tabindex="-1" data-link="' + index + '">' +
                linkIcon() + '<span class="lines"><span class="label">' + esc(link.title) +
                '</span><span class="domain">' + esc(link.domain) + '</span></span></div>';
        })
        .join('');
}
function bindLinkCards(post) {
    var cards = stage.querySelectorAll('.link-card');
    for (var i = 0; i < cards.length; i++) (function(index) {
        cards[index].onclick = function() {
            openExternal(post.links[index]);
        };
    })(i);
}
function postHtml(post, detail) {
    return '<section class="post ' + (detail ? 'detail-post ' : '') +
        (state.region === 'post' ? 'focus' : '') + '">' +
        (post.repostedBy ? '<div class="repost">' + esc(post.repostedBy) + ' 转帖</div>' : '') +
        author(post, detail) + '<div class="body">' + text(post) + fetching(post, detail) +
        linkCards(post) + (detail ? media(post) : '') + '</div>' +
        (detail ? '' : '<div class="more-slot"></div>') + stats(post) + '</section>';
}
function render() {
    var post = current();
    notice(post && written[post.id] ? written[post.id].message || '' : '');
    var freshness = document.getElementById('freshness'), refresh = document.getElementById('refresh');
    refresh.hidden = state.mode !== 'home';
    refresh.textContent = homeRefresh ? '正在刷新…' : '刷新';
    freshness.textContent = state.mode !== 'home' ?
        (state.cachedAt            ? '上次内容 ' + new Date(state.cachedAt).toLocaleString() :
             state.commentsLoading ? '正文已载入 · 评论更新中' :
                                     '') :
        state.pendingHome ? '有 ' + state.pendingHome.fresh + ' 条新帖 · ↑ 刷新' :
        state.cachedAt    ? '上次时间线 ' + new Date(state.cachedAt).toLocaleString() +
            (state.updateFailed ? ' · 更新未完成' : ' · 正在更新') :
                         '刚刚更新';
    title.textContent = state.mode === 'home' ? 'X · 时间线' : '← 帖子详情';
    document.getElementById('position').textContent =
        state.mode === 'home' && post ? (state.index + 1) + ' / ' + state.posts.length : '';
    if (!post) {
        stage.innerHTML = '<div class="loading">' +
            (state.error               ? '加载未完成，按确认重试 · 返回上一层' :
                 state.mode === 'home' ? '正在加载时间线…' :
                                         '正在加载完整帖子…') +
            '</div>';
        help.textContent = '确认 重试　 返回 上一层';
        return;
    }
    if (state.mode === 'home') {
        stage.innerHTML = postHtml(post, false) + media(post);
        help.textContent = state.region === 'media' ?
            '确认 查看媒体　 ← 返回正文　 ↑↓ 切换帖子' :
            '↑↓ 切换帖子　 顶部 ↑ 刷新　 确认 帖子详情　 → 查看媒体　 菜单 更多操作';
    } else {
        var comments = state.posts
                           .map(function(comment, i) {
                               return '<div class="comment' +
                                   (state.region === 'comments' && state.comment === i ? ' selected' : '') +
                                   '" data-index="' + i + '"><div class="name">' + esc(comment.author.name) +
                                   ' <span class="handle">@' + esc(comment.author.handle) +
                                   timeHtml(comment, false) + '</span></div>' + text(comment) +
                                   (comment.media[0] ? '<img style="max-width:100%" src="' +
                                            esc(comment.media[0].image) + '" alt="">' :
                                                       '') +
                                   commentMore(comment, i) + stats(comment) + '</div>';
                           })
                           .join('');
        stage.innerHTML = postHtml(post, true) + '<aside class="comments"><h2>' + countLabel('评论', post.replies) +
            '</h2><div class="comment-list">' +
            (comments ||
             '<div class="handle">' + (state.commentsLoading ? '正在加载评论…' : '暂无已加载评论') +
                 '</div>') +
            '</div><div class="write-hint">菜单 · 写评论 / 喜欢</div></aside>';
        help.textContent = state.region === 'post' ?
            '↑↓ 阅读正文　 → 评论　 确认 查看媒体　 菜单 更多操作　 返回 上一层' :
            '↑↓ 阅读评论　 确认 打开评论　 ← 正文　 菜单 更多操作　 返回 上一层';
    }
    bindLinkCards(post);
    bindCommentMore();
    stopScrolling();
    var body = stage.querySelector('.body');
    if (body) body.scrollTop = state.bodyY || 0;
    markTruncated(post, body);
    var list = stage.querySelector('.comment-list');
    if (list) list.scrollTop = state.commentsY || 0;
}
/**
 * A page is what fits on screen less three lines, so the reader keeps their place across the
 * turn. Measured from the pane, never a fixed fraction, so a font or window change follows.
 */
var OVERLAP_LINES = 3;
function pageStep(node) {
    var style = getComputedStyle(node), line = parseFloat(style.lineHeight);
    if (!isFinite(line) || line <= 0) line = parseFloat(style.fontSize) * 1.4;
    var overlap = Math.min(node.clientHeight / 2, line * OVERLAP_LINES);
    return Math.max(line, node.clientHeight - overlap);
}
var scrolling = null;
/** One animation at a time; a further press chains from where this one is heading. */
function pageScroll(node, direction) {
    if (!node) return;
    var limit = Math.max(0, node.scrollHeight - node.clientHeight);
    if (limit <= 0) return;
    var from = scrolling && scrolling.node === node ? scrolling.to : node.scrollTop;
    var to = Math.max(0, Math.min(limit, from + direction * pageStep(node)));
    if (scrolling) cancelAnimationFrame(scrolling.frame);
    if (to === node.scrollTop) { scrolling = null; return; }
    scrolling = {node: node, to: to, from: node.scrollTop, started: 0, frame: 0};
    scrolling.frame = requestAnimationFrame(function step(now) {
        if (!scrolling || scrolling.node !== node) return;
        if (!scrolling.started) scrolling.started = now;
        var progress = Math.min(1, (now - scrolling.started) / 200);
        var eased = 1 - Math.pow(1 - progress, 3);
        node.scrollTop = scrolling.from + (scrolling.to - scrolling.from) * eased;
        if (progress < 1) scrolling.frame = requestAnimationFrame(step);
        else scrolling = null;
    });
}
function stopScrolling() {
    if (!scrolling) return;
    cancelAnimationFrame(scrolling.frame);
    scrolling = null;
}
/** Where a pane is heading, so a re-render lands on the intended spot, not a mid-tween one. */
function pendingScroll(node) {
    if (!node) return 0;
    return scrolling && scrolling.node === node ? scrolling.to : node.scrollTop;
}
/** A comment X truncated says so too, and opening it reads the whole thing. */
function commentMore(comment, index) {
    return comment.complete ? '' :
        '<div class="show-more" role="button" data-comment="' + index + '">Show more</div>';
}
/** Only a body that is really clipped, or a text X truncated, gets the marker. */
function bindCommentMore() {
    var markers = stage.querySelectorAll('.comment .show-more');
    for (var i = 0; i < markers.length; i++) (function(marker) {
        marker.onclick = function(event) {
            event.stopPropagation();
            open(state.posts[Number(marker.getAttribute('data-comment'))]);
        };
    })(markers[i]);
}
function markTruncated(post, body) {
    var slot = stage.querySelector('.more-slot');
    if (!slot || !body) return;
    var clipped = body.scrollHeight - body.clientHeight > 1;
    if (!clipped && post.complete) {
        slot.innerHTML = '';
        return;
    }
    // A preview is only honest if it admits it is one; the full reading is one confirm away.
    slot.innerHTML = '<div class="show-more" role="button">Show more</div>';
    slot.querySelector('.show-more').onclick = function() {
        open(post);
    };
}
function saveScroll() {
    state.bodyY = pendingScroll(stage.querySelector('.body'));
    state.commentsY = pendingScroll(stage.querySelector('.comment-list'));
}
function request(cursor) {
    recheckLikes();
    refreshing = false;
    pending = 'r' + (++sequence);
    readRevision = writeRevision;
    state.error = false;
    state.requestCursor = cursor || '';
    paging = !!cursor;
    ReaderHost.request(pending, state.mode, state.id || '', cursor || '');
}
function open(post) {
    if (!post) return;
    saveScroll();
    stack.push(state);
    var savedAt = state.cachedAt || 0;
    state = {
        mode: 'detail',
        id: post.id,
        path: post.path,
        posts: [],
        // Keep the preview on screen while the full text is fetched: a blank loading pane
        // would throw away text the reader already had.
        root: post,
        cachedAt: savedAt,
        commentsLoading: true,
        region: 'post',
        comment: 0
    };
    render();
    request('');
    if (post.complete) {
        var id = pending, kind = savedAt ? 'detail_cached' : 'detail_reused';
        requestAnimationFrame(function() {
            requestAnimationFrame(function() {
                if (id === pending && state.commentsLoading) ReaderHost.rendered(id, kind);
            });
        });
    }
}
function cachedHome(payload, at) {
    if (state !== homeScene || state.posts.length) return;
    var data = preserveWrites(TvXReadData.parse(payload, 'home'), 0);
    if (!data.posts.length) return;
    state.updateFailed = !!state.error;
    state.error = false;
    state.posts = data.posts;
    state.cursor = data.cursor;
    state.cachedAt = at;
    render();
    requestAnimationFrame(function() {
        requestAnimationFrame(function() {
            if (state === homeScene && state.cachedAt === at && pending === 'r0')
                ReaderHost.rendered('r0', 'home_cached');
        });
    });
}
/** How many of these posts the reader is not already showing. */
function countNew(posts) {
    var known = {}, count = 0;
    homeScene.posts.forEach(function(post) {
        known[post.id] = true;
    });
    posts.forEach(function(post) {
        if (!known[post.id]) count++;
    });
    return count;
}
/** Up at the top of the timeline: take what is waiting, otherwise go and ask. */
function refreshHome() {
    if (homeScene.pendingHome) {
        var fresh = homeScene.pendingHome.fresh;
        applyHome();
        notice('已加入 ' + fresh + ' 条新帖子');
        return;
    }
    if (homeRefresh) return;
    request('');
    homeRefresh = pending;
    render();
    notice('正在刷新…');
}
function homeRefreshed(id, payload, error) {
    homeRefresh = '';
    if (error || !payload) {
        render();
        notice('刷新未完成，按上键重试');
        return;
    }
    var data = preserveWrites(TvXReadData.parse(payload, 'home'), readRevision);
    data.fresh = countNew(data.posts);
    if (!data.posts.length || !data.fresh) {
        homeScene.cachedAt = 0;
        homeScene.updateFailed = false;
        render();
        notice('暂无新帖子');
        return;
    }
    homeScene.pendingHome = data;
    applyHome();
    notice('已加入 ' + data.fresh + ' 条新帖子');
    requestAnimationFrame(function() {
        requestAnimationFrame(function() {
            if (id === pending) ReaderHost.rendered(id, 'home');
        });
    });
}
function homeUpdated(payload, error) {
    if (error || !payload) {
        homeScene.updateFailed = true;
        if (state === homeScene) render();
        return;
    }
    var data = preserveWrites(TvXReadData.parse(payload, 'home'), 0);
    if (!data.posts.length) {
        homeScene.updateFailed = true;
        return;
    }
    data.fresh = countNew(data.posts);
    homeScene.pendingHome = data;
    // Nobody is reading yet, so the first live timeline may take over from the cached one.
    if (!homeScene.interacted) {
        if (state === homeScene) applyHome();
        return;
    }
    if (!data.fresh) {
        homeScene.pendingHome = null;
        homeScene.cachedAt = 0;
        homeScene.updateFailed = false;
    }
    if (state === homeScene) render();
}
function applyHome() {
    var data = homeScene.pendingHome;
    if (!data) return;
    homeScene.posts = data.posts;
    homeScene.cursor = data.cursor;
    homeScene.pendingHome = null;
    homeScene.cachedAt = 0;
    homeScene.updateFailed = false;
    homeScene.index = 0;
    homeScene.bodyY = 0;
    homeScene.region = 'post';
    render();
}

function receive(id, payload, error) {
    if (id !== pending) return;
    if (id === homeRefresh) { homeRefreshed(id, payload, error); return; }
    if (refreshing) {
        refreshing = false;
        if (!error && payload) {
            var updated = preserveWrites(TvXReadData.parse(payload, 'detail', current().id), readRevision).root;
            if (updated && updated.complete) {
                saveScroll();
                if (state.mode === 'home')
                    state.posts[state.index] = updated;
                else
                    state.root = updated;
                stack.forEach(function(parent) {
                    if (parent.root && parent.root.id === updated.id) parent.root = updated;
                    parent.posts = parent.posts.map(function(p) {
                        return p.id === updated.id ? updated : p;
                    });
                });
                render();
            }
        }
        return;
    }
    if (state.mode === 'home' && state.cachedAt && !paging) {
        homeUpdated(payload, error);
        if (!state.cachedAt)
            requestAnimationFrame(function() {
                ReaderHost.rendered(id, 'home');
            });
        return;
    }
    if (error || !payload) {
        state.error = error || 'network';
        state.commentsLoading = false;
        if (current()) saveScroll();
        render();
        if (current()) notice('内容更新未完成，确认重试');
        paging = false;
        return;
    }
    var data = preserveWrites(TvXReadData.parse(payload, state.mode, state.id), readRevision);
    if (state.mode === 'detail' && !paging && (!data.root || !data.root.complete)) {
        state.error = true;
        state.commentsLoading = false;
        if (current()) saveScroll();
        render();
        notice('正文未完整返回，确认重试 · 菜单打开原帖');
        paging = false;
        return;
    }
    if (state.mode === 'home' && !data.posts.length) {
        state.error = true;
        render();
        notice('暂无可显示的时间线，确认刷新');
        paging = false;
        return;
    }
    saveScroll();
    if (paging) {
        var ids = new Set(state.posts.map(function(p) {
            return p.id;
        }));
        state.posts = state.posts.concat(data.posts.filter(function(p) {
            return !ids.has(p.id);
        }));
    } else {
        state.posts = data.posts;
        if (state.mode === 'detail') {
            state.root = data.root;
            state.cachedAt = 0;
            state.commentsLoading = false;
        }
    }
    state.cursor = data.cursor;
    state.error = false;
    paging = false;
    render();
    requestAnimationFrame(function() {
        requestAnimationFrame(function() {
            if (id === pending) ReaderHost.rendered(id, state.mode);
        });
    });
}
function refreshCurrent() {
    recheckLikes();
    var post = current();
    if (!post) return;
    pending = 'r' + (++sequence);
    refreshing = true;
    readRevision = writeRevision;
    ReaderHost.request(pending, 'detail', post.id, '');
}
function more() {
    if (state.cursor && !paging) {
        notice('正在加载更多…');
        request(state.cursor);
    }
}
function closeViewer() {
    if (!viewer) return;
    var v = viewer.querySelector('video');
    if (v) {
        v.pause();
        v.removeAttribute('src');
        v.load();
    }
    viewer.remove();
    viewer = null;
}
function showMedia() {
    var post = current();
    if (!post || !post.media.length) return;
    var item = post.media[0];
    viewer = document.createElement('div');
    viewer.className = 'viewer';
    viewer.innerHTML = (item.video ? '<video src="' + esc(item.video) + '" poster="' + esc(item.image) +
                                '" playsinline></video>' :
                                     '<img src="' + esc(item.image) + '" alt="' + esc(item.alt) + '">') +
        '<div class="hint">' + (item.video ? '确认 播放 / 暂停　 ←→ 快进快退' : '←→ 切换图片　 ↑↓ 缩放') +
        '　 返回 关闭</div>';
    viewer.dataset.index = '0';
    viewer.dataset.scale = '1';
    document.body.appendChild(viewer);
    var v = viewer.querySelector('video');
    if (v)
        v.play().catch(function() {
            notice('按确认播放');
        });
}
function back() {
    if (closeExternal()) {
        ReaderHost.cancelExternal();
        return;
    }
    if (actionMenu) {
        closeActions();
        return;
    }
    if (viewer) {
        closeViewer();
        return;
    }
    if (stack.length) {
        state = stack.pop();
        pending = 'r' + (++sequence);
        paging = false;
        refreshing = false;
        render();
        ReaderHost.restoreScene(pending, state.mode);
        return;
    }
    if (state.region === 'media') {
        state.region = 'post';
        render();
        return;
    }
    if (state.index > 0) {
        state.index = 0;
        state.bodyY = 0;
        render();
        return;
    }
    ReaderHost.exit();
}
function key(key) {
    if (key === 'back') {
        back();
        return;
    }
    var post = current();
    if (actionMenu) {
        if (key === 'up' || key === 'down') {
            actionMenu.index = (actionMenu.index + (key === 'down' ? 1 : -1) + actionMenu.items.length) % actionMenu.items.length;
            focusAction();
        } else if (key === 'ok') activateAction();
        else if (key === 'menu') closeActions();
        return;
    }
    if (external) {
        if (key === 'ok' && external.failed) {
            external.failed = false;
            renderExternal();
            ReaderHost.openExternal(external.url);
        }
        return;
    }
    if (viewer) {
        var video = viewer.querySelector('video');
        if (video) {
            if (key === 'ok') {
                if (video.paused)
                    video.play().catch(function() {});
                else
                    video.pause();
            }
            if (key === 'left' || key === 'right')
                video.currentTime = Math.max(
                    0,
                    Math.min(video.duration || Infinity, video.currentTime + (key === 'right' ? 10 : -10)));
        } else if (key === 'left' || key === 'right') {
            var index = (Number(viewer.dataset.index) + (key === 'right' ? 1 : -1) + post.media.length) %
                post.media.length;
            viewer.dataset.index = String(index);
            viewer.querySelector('img').src = post.media[index].image;
        } else if (key === 'up' || key === 'down') {
            var scale = Math.max(1, Math.min(3, Number(viewer.dataset.scale) + (key === 'up' ? .25 : -.25)));
            viewer.dataset.scale = String(scale);
            viewer.querySelector('img').style.transform = 'scale(' + scale + ')';
        }
        return;
    }
    if (key === 'menu') {
        if (post) openActions();
        else ReaderHost.browser(state.path || '/home', 'menu');
        return;
    }
    if (state.error && key === 'ok') {
        if (state.error === 'session')
            ReaderHost.browser('/home', 'login');
        else {
            render();
            request(state.requestCursor || '');
        }
        return;
    }
    if (!post) return;
    saveScroll();
    if (state.mode === 'home') {
        state.interacted = true;
        if (key === 'up' && state.index === 0 && state.region === 'post') {
            refreshHome();
            return;
        }

        if (key === 'up' || key === 'down') {
            var next = state.index + (key === 'down' ? 1 : -1);
            if (next >= 0 && next < state.posts.length) {
                state.index = next;
                state.bodyY = 0;
                state.region = 'post';
                render();
            } else if (key === 'down')
                more();
            return;
        }
        if (key === 'right' && post.media.length) {
            state.region = 'media';
            render();
            return;
        }
        if (key === 'left') {
            state.region = 'post';
            render();
            return;
        }
        if (key === 'ok') {
            if (state.region === 'media')
                showMedia();
            else
                open(post);
        }
        return;
    }
    if (key === 'left') {
        state.region = 'post';
        render();
        return;
    }
    if (key === 'right') {
        if (state.posts.length) state.region = 'comments';
        render();
        return;
    }
    if (key === 'ok') {
        if (state.region === 'comments')
            open(state.posts[state.comment]);
        else
            showMedia();
        return;
    }
    if (key === 'up' || key === 'down') {
        var delta = key === 'down' ? 1 : -1;
        if (state.region === 'post') {
            pageScroll(stage.querySelector('.body'), delta);
            return;
        }
        var selected = stage.querySelector('.comment.selected'), list = stage.querySelector('.comment-list');
        if (selected) {
            var r = selected.getBoundingClientRect(), area = list.getBoundingClientRect();
            if ((delta > 0 && r.bottom > area.bottom + 4) || (delta < 0 && r.top < area.top - 4)) {
                // The comment column follows a selection rather than being read straight
                // through, so it keeps its smaller step: a bigger one loses the selected item.
                list.scrollTop += delta * list.clientHeight * .65;
                return;
            }
        }
        var index = state.comment + delta;
        if (index >= 0 && index < state.posts.length) {
            state.comment = index;
            render();
            stage.querySelector('.comment.selected').scrollIntoView({block: 'nearest'});
        } else if (delta > 0)
            more();
    }
}
document.getElementById('refresh').onclick = function() {
    if (state === homeScene && !actionMenu && !viewer && !external) refreshHome();
};
window.TvXReader = {
    receive: receive,
    key: key,
    notice: notice,
    refreshCurrent: refreshCurrent,
    cachedHome: cachedHome,
    externalFailed: externalFailed,
    verifyResult: verifyResult,
    externalClosed: externalClosed,
    homeUpdated: homeUpdated,
    writeResult: writeResult
};
render();
ReaderHost.ready();
})();
