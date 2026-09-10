/**
 * Real-device acceptance for issues #17, #18 and #15: the media mark says what the item is
 * before anything is tried, a video plays full screen with a usable control bar, and a picture
 * zooms and pans. Read-only against X: it navigates and plays, nothing else.
 *
 * Usage: node scripts/check-media.mjs [--out <file.json>] [--shots <dir>]
 * Screenshots contain the signed-in timeline and stay out of version control.
 */
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {connect} from './reader-cdp.mjs';

const args = process.argv.slice(2);
const option = name => {
    const i = args.indexOf(name);
    return i < 0 ? null : args[i + 1];
};
const SERIAL = process.env.TVX_ADB_SERIAL || '192.168.10.100:5555';
const OUT = option('--out') || 'docs/validation/issue-15-17-18-samples.json';
const SHOTS = option('--shots');
const PORT = 9342;
const KEYS = {menu: 82, up: 19, down: 20, left: 21, right: 22, ok: 23, back: 4};

const adb = (...a) => execFileSync('adb', ['-s', SERIAL, ...a], {encoding: 'utf8', timeout: 40000});
const wait = ms => new Promise(ok => setTimeout(ok, ms));
const evidence = [];
function record(step, detail) {
    evidence.push({at: new Date().toISOString(), step, ...detail});
    console.log(step, JSON.stringify(detail));
}
async function launch() {
    adb('shell', 'am', 'force-stop', 'cn.deeloo.tvxbrowser');
    adb('logcat', '-c');
    adb('shell', 'am', 'start', '-n', 'cn.deeloo.tvxbrowser/.BrowserActivity');
    for (let i = 0; i < 60; i++) {
        await wait(500);
        const pid = adb('shell', 'pidof', 'cn.deeloo.tvxbrowser').trim().split(/\s+/)[0];
        if (!pid) continue;
        try {
            adb('forward', `tcp:${PORT}`, `localabstract:webview_devtools_remote_${pid}`);
            const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
            if (list.some(t => t.url.endsWith('/reader/index.html'))) return pid;
        } catch (_) {}
    }
    throw new Error('the reader never came up; is the build installed and signed in?');
}
function shot(name) {
    if (!SHOTS) return;
    adb('shell', 'screencap', '-p', '/sdcard/tvx-media.png');
    adb('pull', '/sdcard/tvx-media.png', `${SHOTS}/${name}.png`);
    adb('shell', 'rm', '-f', '/sdcard/tvx-media.png');
}

const pid = await launch();
const cdp = await connect(PORT);
const key = async name => {
    adb('shell', 'input', 'keyevent', String(KEYS[name]));
    await wait(500);
};
const PANE = `(function(){
    var text = function(sel){var n=document.querySelector(sel);return n?n.textContent.replace(/\\s+/g,' ').trim():null;};
    var mark = document.querySelector('.media .media-mark');
    var size = mark ? getComputedStyle(mark.querySelector('.kind, .count')) : null;
    return JSON.stringify({
        media: !!document.querySelector('.media'),
        kind: text('.media .kind'), count: text('.media .count'),
        play: !!document.querySelector('.media .play'),
        help: text('#help'), position: document.getElementById('position').textContent,
        markFontPx: size ? Math.round(parseFloat(size.fontSize) * 10) / 10 : null
    });})()`;
const pane = () => cdp.evaluate(PANE).then(JSON.parse);
const VIEWER = `(function(){
    var v = document.querySelector('.viewer');
    if (!v) return JSON.stringify(null);
    var video = v.querySelector('video'), img = v.querySelector('img');
    var text = function(sel){var n=v.querySelector(sel);return n?n.textContent.replace(/\\s+/g,' ').trim():null;};
    return JSON.stringify({
        kind: video ? 'video' : img ? 'image' : 'none',
        fit: video ? getComputedStyle(video).objectFit : img ? getComputedStyle(img).objectFit : null,
        elapsed: text('.elapsed'), total: text('.total'), bar: !!v.querySelector('.bar'),
        scale: Number(v.dataset.scale || 0), x: Number(v.dataset.x || 0),
        minimap: !!v.querySelector('.minimap'), count: text('.count'),
        currentTime: video ? Math.round(video.currentTime * 100) / 100 : null,
        paused: video ? video.paused : null,
        width: video ? video.videoWidth : img ? img.naturalWidth : 0,
        height: video ? video.videoHeight : img ? img.naturalHeight : 0
    });})()`;
const viewer = () => cdp.evaluate(VIEWER).then(JSON.parse);

/** Walks the timeline until a post whose focused media item matches. */
async function findMedia(label, matches, limit = 20) {
    for (let step = 0; step < limit; step++) {
        const at = await pane();
        if (at.media) {
            await key('right');
            const focused = await pane();
            if (matches(focused)) return {...focused, scanned: step};
            await key('left');
        }
        await key('down');
    }
    throw new Error('no post with ' + label + ' was reachable');
}

try {
    for (let i = 0; i < 120; i++) {
        const ready = await cdp.evaluate("typeof TvXReader === 'object' && !!document.querySelector('.post')")
                               .catch(() => false);
        if (ready) break;
        await wait(500);
    }
    for (let i = 0; i < 120; i++) {
        if ((await cdp.evaluate("document.getElementById('freshness').textContent")) === '刚刚更新') break;
        await wait(500);
    }

    // #17 — a video cover says it is a video, with its length, before anything is played.
    const cover = await findMedia('a video', at => !!at.play && /视频/.test(at.kind || ''));
    shot('01-video-mark');
    record('video-mark', cover);
    if (!/\d+:\d\d/.test(cover.kind)) throw new Error('the video mark carries no length: ' + cover.kind);
    if (!/确认 播放视频/.test(cover.help)) throw new Error('the prompt does not offer to play: ' + cover.help);

    // #18 — confirm goes straight to a full-screen player that actually plays.
    await key('ok');
    for (let i = 0; i < 40; i++) {
        const at = await viewer();
        if (at && at.total) break;
        await wait(500);
    }
    const opened = await viewer();
    shot('02-player');
    record('player-opened', opened);
    if (!opened || opened.kind !== 'video') throw new Error('confirm did not open the player');
    if (opened.fit !== 'contain') throw new Error('the video is stretched: object-fit ' + opened.fit);
    if (!opened.total) throw new Error('the control bar shows no total length');

    await wait(3000);
    const playing = await viewer();
    record('playing', playing);
    if (!(playing.currentTime > 0)) throw new Error('the video never advanced');
    if (playing.paused) throw new Error('the video did not start playing');

    await key('ok');
    const paused = await viewer();
    record('paused', paused);
    if (!paused.paused) throw new Error('confirm did not pause');

    const before = paused.currentTime;
    await key('right');
    const seeked = await viewer();
    record('seeked', {from: before, to: seeked.currentTime, elapsed: seeked.elapsed});
    if (!(seeked.currentTime > before)) throw new Error('the right key did not seek forward');

    await key('back');
    const closed = await viewer();
    const back = await pane();
    record('closed', {viewer: closed, pane: back});
    if (closed) throw new Error('back did not leave the player');
    if (!/确认 播放视频/.test(back.help)) throw new Error('the reader did not come back to the video');

    // #15 — a picture fits, then zooms and pans, and back unwinds the zoom first.
    await key('left');
    const picture = await findMedia('a picture', at => !at.play && /查看图片/.test(at.help || ''));
    record('picture-mark', picture);
    await key('ok');
    const fitted = await viewer();
    shot('03-picture-fit');
    record('picture-fit', fitted);
    if (!fitted || fitted.kind !== 'image') throw new Error('confirm did not open the picture');
    if (fitted.scale !== 1) throw new Error('the picture did not start fitted');
    if (fitted.minimap) throw new Error('a fitted picture needs no viewport hint');

    await key('ok');
    const zoomed = await viewer();
    shot('04-picture-zoom');
    record('picture-zoom', zoomed);
    if (zoomed.scale !== 2) throw new Error('confirm did not zoom to 2x, got ' + zoomed.scale);
    if (!zoomed.minimap) throw new Error('a zoomed picture shows no viewport hint');

    await key('right');
    const panned = await viewer();
    record('picture-pan', panned);
    if (panned.scale !== 2) throw new Error('panning changed the zoom');

    await key('back');
    const unzoomed = await viewer();
    record('picture-unzoom', unzoomed);
    if (!unzoomed) throw new Error('back left the picture instead of the zoom');
    if (unzoomed.scale !== 1) throw new Error('back did not restore the fitted view');
    await key('back');
    if (await viewer()) throw new Error('a second back did not leave the picture');
    record('picture-closed', {pane: await pane()});

    writeFileSync(OUT, JSON.stringify(evidence, null, 1) + '\n');
    console.log('\nPASS — evidence written to ' + OUT);
} catch (error) {
    writeFileSync(OUT, JSON.stringify(evidence.concat([{failure: String(error)}]), null, 1) + '\n');
    console.error('\nFAIL —', error.message);
    process.exitCode = 1;
} finally {
    cdp.close();
}
