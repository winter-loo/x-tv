// Remote media controller. Keep React's video and MediaSource attached in place.
window.TvXMedia = window.TvXMedia || (() => {
    let article = null, identity = null, items = [], index = 0, selected = null;
    let viewer = null, controls = null, video = null, controlIndex = 0, fullscreen = false;
    let fullscreenRoot = null, fullscreenScroll = 0, zoom = false, previousFocus = null;
    const labels = ['播放 / 暂停', '全屏', '后退 10 秒', '前进 10 秒', '声音', '关闭'];
    function candidates(post) {
        return Array.from(post.querySelectorAll('video, [data-testid="tweetPhoto"] img')).filter(node =>
            node.closest('article') === post && !node.closest('[data-testid="quoteTweet"]') &&
            !(node.tagName === 'IMG' && node.closest('[data-testid="videoPlayer"]')));
    }
    function hint(text) { window.TvXReading?.waiting(text); }
    function mark() {
        selected?.removeAttribute('data-tv-media-selected');
        selected = items[index];
        selected?.setAttribute('data-tv-media-selected', 'true');
        article?.setAttribute('data-tv-focus-target', 'media');
        const mediaType = selected?.tagName === 'VIDEO' ? '视频' : '图片';
        hint(`【当前焦点：${mediaType}】 ← 返回正文     → 下一项媒体     确认 ` + (selected?.tagName === 'VIDEO' ? '播放视频' : '查看图片') + `     ${index + 1} / ${items.length}`);
    }
    function select(post) {
        if (!post) return false;
        const found = candidates(post);
        if (!found.length) return false;
        reset(); article = post; identity = window.TvXPostIdentity?.canonicalPath(window.TvXPostIdentity.statusLink(post));
        items = found; index = 0; previousFocus = document.activeElement; mark(); return true;
    }
    function update() {
        if (!article) return;
        const current = window.TvXPostIdentity?.canonicalPath(window.TvXPostIdentity.statusLink(article));
        if (location.pathname !== '/home') { reset(); return; }
        if (article.isConnected && selected?.isConnected && current === identity) return;
        // React replaces the home row again after its router restores the URL.
        // Follow the logical post, never the recycled DOM node or its old index.
        const replacement = Array.from(document.querySelectorAll('article')).find(node =>
            window.TvXPostIdentity?.canonicalPath(window.TvXPostIdentity.statusLink(node)) === identity);
        const replacementItems = replacement && candidates(replacement);
        if (replacementItems?.length) {
            closePresentation();
            selected?.removeAttribute('data-tv-media-selected');
            article = replacement; items = replacementItems;
            index = Math.min(index, items.length - 1); selected = null;
            mark();
        } else reset();
    }
    function syncFullscreen() {
        fullscreen = !!fullscreenRoot && document.fullscreenElement === fullscreenRoot;
        video?.classList.toggle('tv-media-fullscreen', fullscreen);
        document.body.classList.toggle('tv-media-fullscreen-active', fullscreen);
        if (!fullscreen && fullscreenRoot) {
            fullscreenRoot.classList.remove('tv-media-fullscreen-root');
            if (controls) document.body.append(controls);
            fullscreenRoot = null;
            window.scrollTo({top:fullscreenScroll,behavior:'instant'});
        }
        renderControls();
    }
    function setFullscreen(value) {
        if (!value) {
            if (document.fullscreenElement && fullscreenRoot) document.exitFullscreen().catch(() => {});
            else syncFullscreen();
            return;
        }
        if (!video || fullscreenRoot) return;
        // Use the browser's top layer. Changing every ancestor's position or
        // overflow breaks X's virtual row measurements and can recycle the post.
        fullscreenRoot = video.closest('[data-testid="videoPlayer"]') || video.parentElement;
        fullscreenScroll = window.scrollY;
        fullscreenRoot.classList.add('tv-media-fullscreen-root');
        fullscreenRoot.append(controls);
        const requestedRoot = fullscreenRoot;
        fullscreenRoot.requestFullscreen().then(() => {
            if (fullscreenRoot !== requestedRoot) {
                if (document.fullscreenElement === requestedRoot) document.exitFullscreen().catch(() => {});
                return;
            }
            syncFullscreen();
        }).catch(() => {
            syncFullscreen(); renderControls('未能进入全屏，请按确认重试');
        });
    }
    document.addEventListener('fullscreenchange', syncFullscreen);
    function renderControls(message) {
        if (!controls) return;
        controls.querySelectorAll('button').forEach((button, i) => {
            button.setAttribute('aria-current', String(i === controlIndex));
            button.textContent = i === 0 ? (video.paused ? '播放' : '暂停') : i === 1 ? (fullscreen ? '退出全屏' : '全屏') : i === 4 ? (video.muted ? '开启声音' : '静音') : labels[i];
        });
        const status = controls.querySelector('[role="status"]');
        const time = Number.isFinite(video.duration) ? `${Math.floor(video.currentTime)} / ${Math.floor(video.duration)} 秒` : '正在加载视频…';
        status.textContent = message || `${time}     ←→ 选择操作 · 确认 执行 · 返回 退出`;
    }
    function syncControls() { renderControls(); }
    function togglePlay() {
        if (!video) return;
        if (!video.paused && !video.ended) video.pause();
        else {
            if (video.ended) video.currentTime = 0;
            video.play().catch(() => renderControls('播放未成功，请按确认重试；返回可退出'));
        }
        renderControls();
    }
    function runControl() {
        if (controlIndex === 0) togglePlay();
        else if (controlIndex === 1) setFullscreen(!fullscreen);
        else if (controlIndex === 2 || controlIndex === 3) {
            if (Number.isFinite(video.duration)) video.currentTime = Math.max(0, Math.min(video.duration, video.currentTime + (controlIndex === 2 ? -10 : 10)));
            renderControls();
        } else if (controlIndex === 4) { video.muted = !video.muted; renderControls(); }
        else closePresentation();
    }
    function showImage() {
        viewer = document.createElement('div'); viewer.id = 'tv-media-viewer';
        viewer.setAttribute('role','dialog'); viewer.setAttribute('aria-label','图片查看器'); viewer.setAttribute('aria-modal','true');
        const img = document.createElement('img'); img.alt = selected.alt || '帖子图片'; img.src = selected.currentSrc || selected.src;
        const help = document.createElement('div'); help.textContent = `图片 ${index + 1} / ${items.length}     ←→ 切换 · 确认 放大 / 还原（放大后方向键移动） · 返回 关闭`;
        viewer.append(img, help); document.body.append(viewer);
    }
    function showVideo() {
        video = selected; controlIndex = 0;
        controls = document.createElement('div'); controls.id = 'tv-media-controls';
        controls.setAttribute('role','toolbar'); controls.setAttribute('aria-label','视频控制');
        controls.addEventListener('click', event => event.stopPropagation());
        const status = document.createElement('div'); status.setAttribute('role','status'); controls.append(status);
        labels.forEach((label, i) => {
            const button = document.createElement('button'); button.textContent = label;
            button.onclick = () => { controlIndex = i; runControl(); }; controls.append(button);
        });
        document.body.append(controls);
        for (const name of ['play','pause','timeupdate','loadedmetadata','volumechange','ended']) video.addEventListener(name, syncControls);
        // Opening a playing native video must not unexpectedly pause it.
        if (video.paused) togglePlay(); else renderControls();
    }
    function closePresentation() {
        if (video) {
            video.pause(); setFullscreen(false);
            for (const name of ['play','pause','timeupdate','loadedmetadata','volumechange','ended']) video.removeEventListener(name, syncControls);
        }
        if (fullscreenRoot) {
            fullscreenRoot.classList.remove('tv-media-fullscreen-root'); fullscreenRoot = null;
        }
        video?.classList.remove('tv-media-fullscreen');
        fullscreen = false; document.body.classList.remove('tv-media-fullscreen-active');
        video = null; viewer?.remove(); viewer = null; controls?.remove(); controls = null; zoom = false;
        if (selected?.isConnected) mark();
    }
    function reset() {
        closePresentation(); selected?.removeAttribute('data-tv-media-selected');
        if (article) article.setAttribute('data-tv-focus-target', 'text');
        selected = null; article = null; items = []; identity = null;
        if (previousFocus?.isConnected) previousFocus.focus({preventScroll:true}); previousFocus = null;
    }
    function move(direction) {
        update();
        if (!selected) return false;
        if (controls) {
            if (direction === 'left' || direction === 'right') controlIndex = (controlIndex + (direction === 'right' ? 1 : -1) + labels.length) % labels.length;
            else if (direction === 'up' || direction === 'down') { controlIndex = direction === 'up' ? 2 : 3; runControl(); }
            renderControls(); return true;
        }
        if (viewer) {
            if (zoom) {
                viewer.scrollBy({left: direction === 'left' ? -window.innerWidth * .3 : direction === 'right' ? window.innerWidth * .3 : 0,
                    top: direction === 'up' ? -window.innerHeight * .3 : direction === 'down' ? window.innerHeight * .3 : 0, behavior:'instant'});
                return true;
            }
            if (direction === 'left' || direction === 'right') {
                const step = direction === 'right' ? 1 : -1;
                index = (index + step + items.length) % items.length;
                closePresentation(); mark(); activate();
            } else if (direction === 'up') toggleZoom(true);
            return true;
        }
        if (direction === 'left') {
            if (index > 0) { index--; mark(); }
            else { const post = article; reset(); window.TvXReading?.focus(post); }
            return true;
        }
        if (direction === 'right') { index = (index + 1) % items.length; mark(); return true; }
        reset(); return false; // Up/down continues ordinary post navigation.
    }
    function toggleZoom(value = !zoom) {
        zoom = value;
        viewer.classList.toggle('tv-media-zoom', zoom);
        viewer.scrollTo({left: zoom ? window.innerWidth * .3 : 0, top: zoom ? window.innerHeight * .3 : 0, behavior:'instant'});
    }
    function activate() {
        update(); if (!selected) return false;
        if (controls) runControl();
        else if (viewer) toggleZoom();
        else if (selected.tagName === 'VIDEO') showVideo();
        else showImage();
        return true;
    }
    function back() {
        if (fullscreen) { setFullscreen(false); return true; }
        if (viewer || controls) { closePresentation(); return true; }
        if (selected) { const post = article; reset(); window.TvXReading?.focus(post); return true; }
        return false;
    }
    return {select, move, activate, back, reset, update};
})();
