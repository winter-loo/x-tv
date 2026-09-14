/**
 * Media marks and the full-screen viewer. Kept apart from the reader so the rules for
 * "what is this and what will confirm do" live in one place, and are used both by the
 * post's media pane and by the viewer itself. ES5 only: the projector's WebView is old.
 */
(function(scope) {
'use strict';
var ZOOMS = [1, 2, 4], IDLE_MS = 3000, SEEK_SECONDS = 10;
var SPEEDS = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0];
var viewer = null, host = null;

function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function(c) {
        return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;'}[c];
    });
}
function qualityLabel(variant) {
    if (!variant) return '标清';
    var b = variant.bitrate || 0;
    if (b >= 1500000) return '1080p 超清';
    if (b >= 600000) return '720p 高清';
    return '360p 标清';
}
function qualityShort(variant) {
    if (!variant) return '360p';
    var b = variant.bitrate || 0;
    if (b >= 1500000) return '1080p';
    if (b >= 600000) return '720p';
    return '360p';
}
function currentVariantIndex(item) {
    if (!item || !item.variants || !item.variants.length) return -1;
    if (!item.video) return 0;
    for (var i = 0; i < item.variants.length; i++) {
        if (item.variants[i].url === item.video) return i;
    }
    return 0;
}
/** Clock time the way a viewer reads it; an unknown length has no honest rendering. */
function time(seconds) {
    if (typeof seconds !== 'number' || !isFinite(seconds) || seconds < 0) return '';
    var whole = Math.floor(seconds), hours = Math.floor(whole / 3600);
    var minutes = Math.floor((whole % 3600) / 60), rest = whole % 60;
    function pad(value) {
        return (value < 10 ? '0' : '') + value;
    }
    return hours ? hours + ':' + pad(minutes) + ':' + pad(rest) : minutes + ':' + pad(rest);
}
function seekTo(from, delta, duration) {
    var limit = typeof duration === 'number' && isFinite(duration) ? duration : Infinity;
    return Math.max(0, Math.min(limit, from + delta));
}
/** What this item is, and how far through the set it sits. Never invents a length. */
function mark(item, index, total) {
    if (!item) return '';
    var parts = '';
    if (item.type === 'video') {
        var length = typeof item.duration === 'number' ? time(item.duration / 1000) : '';
        parts += '<span class="kind"><span class="play"></span>视频' +
            (length ? ' ' + length : '') + '</span>';
    }
    else if (item.type === 'animated_gif')
        parts += '<span class="kind"><span class="play"></span>GIF</span>';
    if (total > 1) parts += '<span class="count">' + (index + 1) + ' / ' + total + '</span>';
    return parts ? '<div class="media-mark">' + parts + '</div>' : '';
}
function playable(item) {
    return !!item && (item.type === 'video' || item.type === 'animated_gif');
}
/** The prompt has to say what confirm will do, before anything is tried. */
function prompt(item) {
    if (!item) return '';
    if (item.type === 'animated_gif') return '确认 播放动图';
    return item.type === 'video' ? '确认 播放视频' : '确认 查看图片';
}

/** How far a zoomed image may be moved before its edge would come inside the frame. */
function panLimit() {
    if (!viewer || !viewer.image) return {x: 0, y: 0};
    // Layout size, not the painted rectangle: the transform is what we are about to change.
    var frame = viewer.node.getBoundingClientRect();
    return {
        x: Math.max(0, (viewer.image.offsetWidth * viewer.scale - frame.width) / 2),
        y: Math.max(0, (viewer.image.offsetHeight * viewer.scale - frame.height) / 2)
    };
}
function applyView() {
    var limit = panLimit();
    viewer.x = Math.max(-limit.x, Math.min(limit.x, viewer.x));
    viewer.y = Math.max(-limit.y, Math.min(limit.y, viewer.y));
    viewer.image.style.transform =
        'translate(' + viewer.x + 'px,' + viewer.y + 'px) scale(' + viewer.scale + ')';
    viewer.node.dataset.scale = String(viewer.scale);
    viewer.node.dataset.x = String(Math.round(viewer.x));
    viewer.node.dataset.y = String(Math.round(viewer.y));
    var map = viewer.node.querySelector('.minimap');
    if (viewer.scale <= 1) {
        if (map) map.remove();
        return;
    }
    if (!map) {
        map = document.createElement('div');
        map.className = 'minimap';
        map.innerHTML = '<div class="window"></div>';
        viewer.node.appendChild(map);
    }
    // The window shows which part of the picture the frame is on.
    var window_ = map.querySelector('.window');
    window_.style.width = (100 / viewer.scale) + '%';
    window_.style.height = (100 / viewer.scale) + '%';
    window_.style.left = (50 - 50 / viewer.scale - (limit.x ? (viewer.x / limit.x) * (50 - 50 / viewer.scale) : 0)) + '%';
    window_.style.top = (50 - 50 / viewer.scale - (limit.y ? (viewer.y / limit.y) * (50 - 50 / viewer.scale) : 0)) + '%';
}
function resetView() {
    viewer.scale = 1;
    viewer.x = viewer.y = 0;
    applyView();
}

function controlsHtml(item) {
    if (!playable(item)) return '';
    var badges = '';
    if (item.type === 'video') {
        var rate = SPEEDS[viewer ? viewer.speedIndex : 2];
        badges += '<span class="speed-badge' + (rate !== 1 ? ' active' : '') + '">' + rate + 'x</span>';
        if (item.variants && item.variants.length > 1) {
            var vIdx = (viewer && viewer.variantIndex >= 0) ? viewer.variantIndex : currentVariantIndex(item);
            var v = item.variants[vIdx] || item.variants[0];
            badges += '<span class="quality-badge">' + esc(qualityShort(v)) + '</span>';
        }
    }
    return '<div class="controls"><span class="elapsed">0:00</span>' +
        '<span class="bar"><span class="buffered"></span><span class="played"></span></span>' +
        '<span class="total"></span>' +
        badges +
        '</div>';
}
function updateSpeedBadge() {
    if (!viewer || !viewer.node) return;
    var badge = viewer.node.querySelector('.speed-badge');
    if (!badge) return;
    var rate = SPEEDS[viewer.speedIndex];
    badge.textContent = rate + 'x';
    if (rate !== 1) badge.classList.add('active');
    else badge.classList.remove('active');
}
function updateQualityBadge() {
    if (!viewer || !viewer.node) return;
    var badge = viewer.node.querySelector('.quality-badge');
    if (!badge) return;
    var item = viewer.items[viewer.index];
    if (!item || !item.variants) return;
    var vIdx = viewer.variantIndex >= 0 ? viewer.variantIndex : currentVariantIndex(item);
    var v = item.variants[vIdx] || item.variants[0];
    badge.textContent = qualityShort(v);
}
function changeSpeed(delta) {
    if (!viewer || !viewer.video) return;
    var next = Math.max(0, Math.min(SPEEDS.length - 1, viewer.speedIndex + delta));
    if (next === viewer.speedIndex) {
        if (host && host.notice) host.notice('倍速已达限制：' + SPEEDS[viewer.speedIndex] + 'x');
        return;
    }
    viewer.speedIndex = next;
    var rate = SPEEDS[viewer.speedIndex];
    viewer.video.playbackRate = rate;
    updateSpeedBadge();
    showControls();
    if (host && host.notice) host.notice('播放倍速：' + rate + 'x');
}
function cycleQuality() {
    if (!viewer || !viewer.video) return;
    var item = viewer.items[viewer.index];
    if (!item.variants || item.variants.length < 2) {
        if (host && host.notice) host.notice('当前已是最佳画质');
        return;
    }
    var currentIdx = viewer.variantIndex >= 0 ? viewer.variantIndex : currentVariantIndex(item);
    var nextIdx = (currentIdx + 1) % item.variants.length;
    switchQuality(nextIdx);
}
function switchQuality(index) {
    var item = viewer.items[viewer.index];
    if (!item || !item.variants || !item.variants[index]) return;
    viewer.variantIndex = index;
    var variant = item.variants[index];
    var video = viewer.video;
    var cur = video.currentTime;
    var wasPaused = video.paused;
    var rate = SPEEDS[viewer.speedIndex];

    var onLoaded = function() {
        video.removeEventListener('loadedmetadata', onLoaded);
        try {
            if (cur > 0) video.currentTime = cur;
        } catch (_) {}
        try {
            video.defaultPlaybackRate = rate;
            video.playbackRate = rate;
        } catch (_) {}
    };
    video.addEventListener('loadedmetadata', onLoaded);
    video.src = variant.url;
    try {
        video.currentTime = cur;
    } catch (_) {}
    video.defaultPlaybackRate = rate;
    video.playbackRate = rate;
    if (!wasPaused) {
        video.play().catch(function() {});
    }
    updateQualityBadge();
    showControls();
    var label = qualityLabel(variant);
    if (host && host.notice) host.notice('清晰度：' + label);
}
/** Renders whatever the element currently reports; an unseekable stream loses its bar. */
function describe(video) {
    if (!viewer || !viewer.node.querySelector('.controls')) return;
    var controls = viewer.node.querySelector('.controls');
    // Until the element has metadata its duration is NaN, but X already told us the length.
    var declared = viewer.items[viewer.index].duration;
    var duration = typeof video.duration === 'number' && !isNaN(video.duration) ? video.duration :
        typeof declared === 'number'                                           ? declared / 1000 :
                                                                                 NaN;
    var seekable = isFinite(duration) && duration > 0;
    viewer.duration = seekable ? duration : 0;
    if (viewer.pendingSeek === undefined)
        viewer.node.dataset.seek = String(Math.round(video.currentTime || 0));
    controls.querySelector('.elapsed').textContent = time(video.currentTime) || '0:00';
    controls.querySelector('.total').textContent = seekable ? time(duration) : '直播';
    var bar = controls.querySelector('.bar');
    if (!seekable) {
        if (bar) bar.remove();
        return;
    }
    if (!bar) return;
    bar.querySelector('.played').style.width = (video.currentTime / duration) * 100 + '%';
    var buffered = 0;
    try {
        if (video.buffered && video.buffered.length)
            buffered = video.buffered.end(video.buffered.length - 1);
    } catch (_) {}
    bar.querySelector('.buffered').style.width = (buffered / duration) * 100 + '%';
}
function showControls() {
    if (!viewer || !viewer.node.querySelector('.controls')) return;
    viewer.node.classList.remove('idle');
    clearTimeout(viewer.idle);
    viewer.idle = setTimeout(function() {
        if (viewer) viewer.node.classList.add('idle');
    }, IDLE_MS);
}

function render() {
    var item = viewer.items[viewer.index], total = viewer.items.length;
    var hasQuality = item && item.type === 'video' && item.variants && item.variants.length > 1;
    viewer.node.innerHTML =
        (playable(item) ?
             '<video src="' + esc(item.video) + '" poster="' + esc(item.image) + '" playsinline' +
                 (item.type === 'animated_gif' ? ' loop muted' : '') + '></video>' :
             '<img src="' + esc(item.image) + '" alt="' + esc(item.alt) + '">') +
        (total > 1 ? '<div class="count">' + (viewer.index + 1) + ' / ' + total + '</div>' +
                         '<div class="step-prev" role="button">‹</div>' +
                         '<div class="step-next" role="button">›</div>' :
                     '') +
        controlsHtml(item) +
        '<div class="hint">' +
        (playable(item) ?
            ('确认 播放 / 暂停　 ←→ 快退快进 10 秒' + (item.type === 'video' ? '　 ↑↓ 倍速' + (hasQuality ? '　 菜单 画质' : '') : '')) :
            ('确认 缩放　 ←→ ' + (total > 1 ? '切换图片' : '平移') + '　 ↑↓ 平移')) +
        '　 返回 关闭</div>';
    viewer.image = viewer.node.querySelector('img');
    viewer.video = viewer.node.querySelector('video');
    var prev = viewer.node.querySelector('.step-prev'), next = viewer.node.querySelector('.step-next');
    if (prev) prev.onclick = function() {
        step(viewer.index - 1);
    };
    if (next) next.onclick = function() {
        step(viewer.index + 1);
    };
    if (viewer.image) {
        resetView();
        viewer.image.ondragstart = function() {
            return false;
        };
    }
    if (viewer.video) bindVideo(viewer.video);
}
function bindVideo(video) {
    video.style.objectFit = 'contain';
    if (viewer && viewer.speedIndex !== undefined) {
        var rate = SPEEDS[viewer.speedIndex];
        video.defaultPlaybackRate = rate;
        video.playbackRate = rate;
    }
    if (viewer && viewer.node) {
        var speedBadge = viewer.node.querySelector('.speed-badge');
        if (speedBadge) {
            speedBadge.onclick = function(e) {
                e.stopPropagation();
                changeSpeed(1);
            };
        }
        var qualityBadge = viewer.node.querySelector('.quality-badge');
        if (qualityBadge) {
            qualityBadge.onclick = function(e) {
                e.stopPropagation();
                cycleQuality();
            };
        }
    }
    ['loadedmetadata', 'timeupdate', 'progress', 'durationchange'].forEach(function(name) {
        video.addEventListener(name, function() {
            describe(video);
        });
    });
    video.addEventListener('ended', function() {
        showControls();
        if (host && host.notice) host.notice('播放结束　 确认 重播　 返回 关闭');
    });
    video.addEventListener('error', function() {
        viewer.failed = true;
        if (host && host.notice) host.notice('视频无法播放　 确认 重试　 返回 关闭');
    });
    video.addEventListener('playing', function() {
        viewer.failed = false;
    });
    describe(video);
    showControls();
    var started = video.play();
    if (started && started.catch)
        started.catch(function() {
            if (host && host.notice) host.notice('按确认播放');
        });
}

function open(items, index, hooks) {
    close();
    host = hooks || {};
    var initIndex = Math.max(0, Math.min(items.length - 1, index || 0));
    var initItem = items[initIndex];
    viewer = {
        node: document.createElement('div'),
        items: items,
        index: initIndex,
        scale: 1,
        x: 0,
        y: 0,
        idle: 0,
        speedIndex: 2,
        variantIndex: (initItem && initItem.variants) ? currentVariantIndex(initItem) : -1
    };
    viewer.node.className = 'viewer';
    document.body.appendChild(viewer.node);
    render();
    viewer.node.addEventListener('wheel', onWheel, {passive: false});
    viewer.node.addEventListener('mousedown', onDown);
    viewer.node.addEventListener('mousemove', onMove);
    viewer.node.addEventListener('mouseup', onUp);
    viewer.node.addEventListener('mouseleave', onUp);
    return true;
}
function close() {
    if (!viewer) return false;
    clearTimeout(viewer.idle);
    if (viewer.video) {
        viewer.video.pause();
        viewer.video.removeAttribute('src');
        viewer.video.load();
    }
    viewer.node.remove();
    viewer = null;
    host = null;
    return true;
}
/** A failed element will not play again until its source is loaded afresh. */
function retry() {
    var item = viewer.items[viewer.index], video = viewer.video;
    viewer.failed = false;
    video.dataset.retried = String(Number(video.dataset.retried || 0) + 1);
    video.setAttribute('src', item.video);
    video.load();
    video.play().catch(function() {});
}
function isOpen() {
    return !!viewer;
}
function step(index) {
    if (!viewer || viewer.items.length < 2) return;
    viewer.index = (index + viewer.items.length) % viewer.items.length;
    var nextItem = viewer.items[viewer.index];
    viewer.variantIndex = (nextItem && nextItem.variants) ? currentVariantIndex(nextItem) : -1;
    render();
}

/** True when the viewer consumed the key. Back is handled by the reader. */
function key(name) {
    if (!viewer) return false;
    showControls();
    var item = viewer.items[viewer.index];
    if (viewer.video) {
        if (name === 'ok') {
            if (viewer.failed || viewer.video.error) retry();
            else if (viewer.video.paused) viewer.video.play().catch(function() {});
            else viewer.video.pause();
        } else if (name === 'left' || name === 'right') {
            seekBy(name === 'right' ? SEEK_SECONDS : -SEEK_SECONDS);
        } else if (name === 'up') {
            changeSpeed(1);
        } else if (name === 'down') {
            changeSpeed(-1);
        } else if (name === 'menu') {
            cycleQuality();
        }
        return true;
    }
    if (name === 'ok') {
        viewer.scale = ZOOMS[(ZOOMS.indexOf(viewer.scale) + 1) % ZOOMS.length];
        viewer.x = viewer.y = 0;
        applyView();
        return true;
    }
    if (viewer.scale === 1 && (name === 'left' || name === 'right') && viewer.items.length > 1) {
        step(viewer.index + (name === 'right' ? 1 : -1));
        return true;
    }
    if (name === 'left' || name === 'right' || name === 'up' || name === 'down') {
        var limit = panLimit(), stepX = Math.max(40, limit.x / 3), stepY = Math.max(40, limit.y / 3);
        if (name === 'left') viewer.x += stepX;
        if (name === 'right') viewer.x -= stepX;
        if (name === 'up') viewer.y += stepY;
        if (name === 'down') viewer.y -= stepY;
        applyView();
        return true;
    }
    return true;
}
/** Where a point on the bar lands in the video, clamped to its ends. */
function seekFromBar(clientX) {
    var bar = viewer && viewer.node.querySelector('.bar');
    if (!bar || !viewer.duration) return null;
    var box = bar.getBoundingClientRect();
    if (!box.width) return null;
    var fraction = Math.max(0, Math.min(1, (clientX - box.left) / box.width));
    return fraction * viewer.duration;
}
/**
 * Repeated presses scrub: the target is shown at once and only committed once they settle,
 * so holding the key does not fire a seek per press at the element.
 */
function seekBy(delta) {
    var from = viewer.pendingSeek === undefined ? viewer.video.currentTime : viewer.pendingSeek;
    viewer.pendingSeek = seekTo(from, delta, viewer.duration || Infinity);
    previewSeek();
    clearTimeout(viewer.seekTimer);
    viewer.seekTimer = setTimeout(commitSeek, 350);
}
function previewSeek() {
    var controls = viewer.node.querySelector('.controls');
    if (controls) controls.querySelector('.elapsed').textContent = time(viewer.pendingSeek) || '0:00';
    var played = viewer.node.querySelector('.played');
    if (played && viewer.duration)
        played.style.width = (viewer.pendingSeek / viewer.duration) * 100 + '%';
    markSeeking();
    if (host && host.notice) host.notice('定位到 ' + (time(viewer.pendingSeek) || '0:00'));
}
function commitSeek() {
    if (!viewer || viewer.pendingSeek === undefined) return;
    viewer.video.currentTime = viewer.pendingSeek;
    viewer.pendingSeek = undefined;
    describe(viewer.video);
}
function markSeeking() {
    var bar = viewer.node.querySelector('.bar');
    if (!bar) return;
    bar.classList.add('seeking');
    clearTimeout(viewer.seekMark);
    viewer.seekMark = setTimeout(function() {
        if (viewer && bar) bar.classList.remove('seeking');
    }, 900);
}
function afterSeek() {
    describe(viewer.video);
    markSeeking();
    if (host && host.notice) host.notice('定位到 ' + (time(viewer.video.currentTime) || '0:00'));
}
/** Back unwinds the zoom before it leaves the picture. */
function back() {
    if (!viewer) return false;
    if (viewer.image && viewer.scale > 1) {
        resetView();
        return true;
    }
    return close();
}

function onWheel(event) {
    if (!viewer || !viewer.image) return;
    event.preventDefault();
    showControls();
    var frame = viewer.node.getBoundingClientRect();
    var pointerX = event.clientX - frame.left - frame.width / 2;
    var pointerY = event.clientY - frame.top - frame.height / 2;
    var next = Math.max(1, Math.min(4, viewer.scale * (event.deltaY < 0 ? 1.25 : 0.8)));
    if (next === viewer.scale) return;
    // Keep whatever is under the pointer under the pointer.
    var ratio = next / viewer.scale;
    viewer.x = pointerX - (pointerX - viewer.x) * ratio;
    viewer.y = pointerY - (pointerY - viewer.y) * ratio;
    viewer.scale = next;
    applyView();
}
function onDown(event) {
    if (!viewer) return;
    showControls();
    if (viewer.video) {
        var bar = viewer.node.querySelector('.bar');
        if (bar && event.target.closest && event.target.closest('.bar') === bar) {
            viewer.scrubbing = true;
            scrub(event.clientX);
        }
        return;
    }
    if (viewer.image) viewer.dragging = {x: event.clientX, y: event.clientY};
}
function scrub(clientX) {
    var at = seekFromBar(clientX);
    if (at === null) return;
    viewer.video.currentTime = at;
    afterSeek();
}
function onMove(event) {
    if (!viewer) return;
    if (viewer.scrubbing) { scrub(event.clientX); return; }
    if (!viewer.dragging) return;
    viewer.x += event.clientX - viewer.dragging.x;
    viewer.y += event.clientY - viewer.dragging.y;
    viewer.dragging = {x: event.clientX, y: event.clientY};
    applyView();
}
function onUp() {
    if (!viewer) return;
    viewer.dragging = null;
    viewer.scrubbing = false;
}

scope.TvXMedia = {
    mark: mark,
    prompt: prompt,
    playable: playable,
    time: time,
    seekTo: seekTo,
    describe: describe,
    panLimit: panLimit,
    open: open,
    close: close,
    back: back,
    key: key,
    isOpen: isOpen,
    SPEEDS: SPEEDS,
    speed: function() {
        return viewer ? SPEEDS[viewer.speedIndex] : 1.0;
    },
    changeSpeed: changeSpeed,
    cycleQuality: cycleQuality,
    switchQuality: switchQuality,
    quality: function() {
        if (!viewer) return null;
        var item = viewer.items[viewer.index];
        if (!item || !item.variants) return null;
        var vIdx = viewer.variantIndex >= 0 ? viewer.variantIndex : currentVariantIndex(item);
        return item.variants[vIdx] || null;
    }
};
})(typeof window === 'undefined' ? globalThis : window);
