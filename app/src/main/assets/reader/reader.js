(function() {
'use strict';
var stage = document.getElementById('stage'), title = document.getElementById('title'),
    help = document.getElementById('help');
var sequence = 0, pending = 'r0', stack = [],
    state = {mode: 'home', posts: [], index: 0, cursor: '', region: 'post'}, viewer = null, paging = false,
    refreshing = false;
var homeScene = state, actionMenu = null, external = null, writeSequence = 0, pendingWrite = null, writeRevision = 0, readRevision = 0, written = {};
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
function author(post) {
    return '<div class="author">' +
        (post.author.avatar ? '<img class="avatar" src="' + esc(post.author.avatar) + '" alt="">' : '') +
        '<div><div class="name">' + esc(post.author.name) + '</div><div class="handle">@' +
        esc(post.author.handle) + '</div></div></div>';
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
function stats(post) {
    return '<div class="stats"><span class="stat">' + statIcon('comments') +
        '<span>评论 ' + esc(post.replies) + '</span></span><span class="stat like' +
        (post.liked ? ' liked' : '') + '">' + statIcon('like') +
        '<span>' + (post.liked ? '已喜欢 ' : '喜欢 ') + esc(post.likes) +
        '</span></span><span class="stat">' + statIcon('views') +
        '<span>浏览 ' + esc(post.views || '0') + '</span></span></div>';
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
    var item = actionMenu.items[actionMenu.index], post = current();
    closeActions();
    if (item.action === 'external') { openExternal(item.link); return; }
    if (pendingWrite) { notice('上一项操作正在完成…'); return; }
    var id = 'w' + (++writeSequence);
    pendingWrite = {id:id,postId:post.id,action:item.action,desired:!post.liked};
    notice(item.action === 'like' ? '正在更新喜欢状态…' : '');
    ReaderHost.write(id, post.id, item.action, !post.liked, post.author.name || post.author.handle);
}
function writeResult(id, postId, result) {
    if (!pendingWrite || pendingWrite.id !== id || pendingWrite.postId !== postId) return;
    var action = pendingWrite.action;
    pendingWrite = null;
    if (result.status === 'ok') {
        var seen = [], revision = ++writeRevision;
        var reply = result.reply ? TvXReadData.parse({data:{tweet_results:{result:result.reply}}},'home').posts[0] : null;
        var change = written[postId] || {};
        if (action === 'like') { change.likeRevision = revision; change.like = result; }
        else { change.replyRevision = revision; change.reply = reply; }
        written[postId] = change;
        function update(post) {
            if (!post || post.id !== postId || seen.indexOf(post) >= 0) return;
            seen.push(post);
            if (action === 'like') {
                var changed = post.liked !== result.liked;
                if (typeof result.likes === 'number') post.likes = result.likes;
                else if (changed && /^\d+$/.test(String(post.likes))) post.likes = Math.max(0,Number(post.likes)+(result.liked?1:-1));
                post.liked = result.liked;
            } else if (/^\d+$/.test(String(post.replies))) { post.replies = Number(post.replies)+1; change.replyCount = post.replies; }
        }
        [state,homeScene].concat(stack).forEach(function(scene) {
            update(scene.root); (scene.posts || []).forEach(update);
            if (scene.pendingHome) scene.pendingHome.posts.forEach(update);
            if (reply && scene.mode === 'detail' && scene.id === postId && !scene.posts.some(function(p){return p.id===reply.id;})) scene.posts.unshift(reply);
        });
        saveScroll(); render();
        notice(action === 'reply' ? '评论已发送' : result.liked ? '已喜欢' : '已取消喜欢');
    } else if (result.status !== 'cancelled') {
        var messages = {unknown:'操作结果尚未确认，请刷新查看，勿重复提交。',
            not_ready:'登录会话正在准备，请稍后重试。',session:'登录状态已变化，请重新登录。',
            rate_limit:'操作过于频繁，请稍后再试。',busy:'上一项操作正在完成，请稍候。'};
        notice(messages[result.status] || '操作未完成，请稍后重试。');
    }
}
// Protect successful writes against reads that were already in flight when the write completed.
function preserveWrites(data, requestedAt) {
    [data.root].concat(data.posts || []).forEach(function(post) {
        if (!post) return;
        var change = written[post.id];
        if (!change) return;
        if (change.likeRevision > requestedAt) {
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
        '<h2 id="action-title">帖子操作</h2><div class="action-counts">评论 ' + esc(post.replies) +
        ' · 喜欢 ' + esc(post.likes) + '</div><div class="action-options">' +
        items.map(function(item, i) {
            return '<button type="button" class="' +
                (item.action === 'external' ? 'external' : i === 1 && post.liked ? 'liked' : '') + '">' +
                (item.icon ? statIcon(item.icon) : linkIcon()) + '<span class="lines"><span class="label">' +
                esc(item.label) + '</span>' +
                (item.domain ? '<span class="domain">' + esc(item.domain) + '</span>' : '') +
                '</span></button>';
        }).join('') + '</div><p>↑↓ 选择　 确认 打开　 返回 关闭</p></section>';
    document.body.appendChild(node);
    actionMenu = {node: node, items: items, index: 0};
    var buttons = node.querySelectorAll('button');
    for (var i = 0; i < buttons.length; i++) (function(index) {
        buttons[index].onclick = function() {
            actionMenu.index = index;
            activateAction();
        };
    })(i);
    focusAction();
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
        author(post) + '<div class="body">' + text(post) + linkCards(post) +
        (detail ? media(post) : '') + '</div>' + stats(post) + '</section>';
}
function render() {
    var post = current();
    notice('');
    var freshness = document.getElementById('freshness'), refresh = document.getElementById('refresh');
    refresh.hidden = state.mode !== 'home';
    refresh.className = state.region === 'refresh' ? 'selected' : '';
    freshness.textContent = state.mode !== 'home' ?
        (state.cachedAt            ? '上次内容 ' + new Date(state.cachedAt).toLocaleString() :
             state.commentsLoading ? '正文已载入 · 评论更新中' :
                                     '') :
        state.pendingHome ? '有新内容 · ↑ 刷新' :
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
        help.textContent = state.region === 'refresh' ? '确认 刷新时间线　 ↓ 返回帖子' :
            state.region === 'media'                  ? '确认 查看媒体　 ← 返回正文　 ↑↓ 切换帖子' :
                                       '↑↓ 切换帖子　 确认 帖子详情　 → 查看媒体　 菜单 更多操作';
    } else {
        var comments = state.posts
                           .map(function(comment, i) {
                               return '<div class="comment' +
                                   (state.region === 'comments' && state.comment === i ? ' selected' : '') +
                                   '" data-index="' + i + '"><div class="name">' + esc(comment.author.name) +
                                   ' <span class="handle">@' + esc(comment.author.handle) + '</span></div>' +
                                   text(comment) +
                                   (comment.media[0] ? '<img style="max-width:100%" src="' +
                                            esc(comment.media[0].image) + '" alt="">' :
                                                       '') +
                                   '</div>';
                           })
                           .join('');
        stage.innerHTML = postHtml(post, true) + '<aside class="comments"><h2>评论 ' + esc(post.replies) +
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
    var body = stage.querySelector('.body');
    if (body) body.scrollTop = state.bodyY || 0;
    var list = stage.querySelector('.comment-list');
    if (list) list.scrollTop = state.commentsY || 0;
}
function saveScroll() {
    var body = stage.querySelector('.body'), list = stage.querySelector('.comment-list');
    state.bodyY = body ? body.scrollTop : 0;
    state.commentsY = list ? list.scrollTop : 0;
}
function request(cursor) {
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
        root: post.complete ? post : null,
        cachedAt: savedAt,
        commentsLoading: true,
        region: 'post',
        comment: 0
    };
    render();
    request('');
    if (state.root) {
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
    homeScene.pendingHome = data;
    if (state === homeScene) {
        if (!state.interacted)
            applyHome();
        else
            render();
    }
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
        if (state.region === 'refresh') {
            if (key === 'down') {
                state.region = 'post';
                render();
            } else if (key === 'ok') {
                if (state.pendingHome)
                    applyHome();
                else {
                    state.cachedAt = 0;
                    state.posts = [];
                    state.index = 0;
                    state.bodyY = 0;
                    state.region = 'post';
                    render();
                    request('');
                }
            }
            return;
        }
        if (key === 'up' && state.index === 0) {
            state.region = 'refresh';
            render();
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
            stage.querySelector('.body').scrollTop += delta * stage.clientHeight * .65;
            return;
        }
        var selected = stage.querySelector('.comment.selected'), list = stage.querySelector('.comment-list');
        if (selected) {
            var r = selected.getBoundingClientRect(), area = list.getBoundingClientRect();
            if ((delta > 0 && r.bottom > area.bottom + 4) || (delta < 0 && r.top < area.top - 4)) {
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
window.TvXReader = {
    receive: receive,
    key: key,
    notice: notice,
    refreshCurrent: refreshCurrent,
    cachedHome: cachedHome,
    externalFailed: externalFailed,
    externalClosed: externalClosed,
    homeUpdated: homeUpdated,
    writeResult: writeResult
};
render();
ReaderHost.ready();
})();
