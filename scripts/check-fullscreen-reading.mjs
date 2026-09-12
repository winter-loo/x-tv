/**
 * Read-only device acceptance: timeline OK -> detail -> full reading; Back unwinds each layer.
 * Usage: node scripts/check-fullscreen-reading.mjs [--out <file.json>]
 * Requires an installed, signed-in debug APK. It does not submit any X write.
 */
import {execFileSync} from 'node:child_process';
import {writeFileSync, mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import {connect} from './reader-cdp.mjs';

const args = process.argv.slice(2);
const option = name => {
    const i = args.indexOf(name);
    return i < 0 ? null : args[i + 1];
};
const SERIAL = process.env.TVX_ADB_SERIAL || '192.168.10.100:5555';
const OUT = option('--out') || '.scratch/fullscreen-reading-samples.json';
const PORT = 9341;
const KEYS = {up: 19, down: 20, left: 21, right: 22, ok: 23, back: 4};

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
async function until(check, label, seconds = 40) {
    const end = Date.now() + seconds * 1000;
    while (Date.now() < end) {
        const value = await check();
        if (value) return value;
        await wait(300);
    }
    throw new Error('timed out waiting for ' + label);
}
const cdp = await connect(await launch().then(p => (globalThis.__pid = p, PORT)));
/** Every measurement is CSS pixels as the reader itself lays them out. */
const scene = `(function(){
    function box(selector) {
        var node = document.querySelector(selector);
        if (!node) return null;
        var r = node.getBoundingClientRect();
        return {x: Math.round(r.left), y: Math.round(r.top),
                width: Math.round(r.width), height: Math.round(r.height)};
    }
    var header = document.querySelector('header');
    return JSON.stringify({
        reading: document.body.classList.contains('reading'),
        headerShown: !!header && getComputedStyle(header).display !== 'none',
        direction: getComputedStyle(document.getElementById('stage')).flexDirection,
        viewport: {width: window.innerWidth, height: window.innerHeight},
        stage: box('#stage'),
        post: box('.post'),
        media: box('#stage>.media'),
        comments: box('.comments'),
        detail: !!document.querySelector('.detail-post'),
        clipped: (function(){
            var b = document.querySelector('.body');
            return b ? b.scrollHeight - b.clientHeight > 1 : null;
        })(),
        position: document.getElementById('position').textContent,
        freshness: document.getElementById('freshness').textContent,
        author: (document.querySelector('.post .name') || {textContent: ''}).textContent,
        help: document.getElementById('help').textContent
    });
})()`;
const state = () => cdp.evaluate(scene).then(JSON.parse);
const key = async name => {
    adb('shell', 'input', 'keyevent', String(KEYS[name]));
    await wait(600);
};
let failure = null;
function check(condition, message) {
    if (!condition) throw new Error(message);
}

try {
    await until(() => cdp.evaluate("typeof TvXReader === 'object' && document.querySelectorAll('.post').length > 0")
                         .catch(() => false),
        'the reader to render its timeline');
    await until(async () => (await state()).freshness === '刚刚更新', 'the live timeline to settle', 60);
    // One step down and back marks the timeline as being read, so a background update cannot
    // swap the post out from under the measurements below.
    await key('down');
    await key('back');
    await until(async () => (await state()).position.indexOf('1 /') === 0, 'the first post', 20);

    // Pick a real overflowing post to verify the long-post route and reading geometry.
    const scan = [];
    for (let i = 0; i < 12; i++) {
        const at = await state();
        scan.push({step: i, position: at.position, clipped: at.clipped, media: !!at.media});
        if (at.position.split('/')[0].trim() === at.position.split('/')[1].trim()) break;
        await key('down');
    }
    record('scan', {pid: globalThis.__pid, posts: scan});
    const long = scan.find(p => p.clipped && p.media) || scan.find(p => p.clipped);
    check(!!long, 'no post in the live timeline overflows its pane, so reading mode cannot be checked');

    /** Back jumps to the first post in one press, so any post is two moves away. */
    async function goTo(step) {
        if ((await state()).position.split('/')[0].trim() !== '1') await key('back');
        for (let i = 0; i < step; i++) await key('down');
        return state();
    }
    const before = await goTo(long.step);
    check(before.clipped, 'the post picked as too long no longer overflows');
    record('timeline', {picked: long, scene: before});
    check(before.headerShown, 'the header was not showing before reading mode');
    check(before.direction === 'row', 'the ordinary timeline is not a row layout');
    if (before.media)
        check(before.media.x >= before.post.x + before.post.width - 1,
            'the media pane is not beside the post before reading mode');

    adb('logcat', '-c');
    await key('ok');
    const detail = await until(async () => {
        const at = await state();
        return at.detail && !at.reading && at.comments ? at : null;
    }, 'detail on the first confirm', 30);
    record('detail-first', {scene: detail});
    check(/确认 全屏阅读/.test(detail.help), 'detail does not advertise full reading');
    await key('back');
    const directHome = await state();
    check(!directHome.detail && !directHome.reading, 'one Back did not restore the ordinary timeline');
    check(directHome.position === before.position && directHome.author === before.author,
        'direct Back lost the selected timeline post');
    record('direct-back', {scene: directHome});

    await key('ok');
    await until(async () => (await state()).detail, 'detail to reopen', 30);
    await key('ok');
    const full = await until(async () => {
        const at = await state();
        return at.detail && at.reading ? at : null;
    }, 'full reading inside detail', 20);
    record('detail-fullscreen', {scene: full});
    check(!full.headerShown && !full.comments, 'full reading did not hide header/comments');
    check(Math.abs(full.stage.width / full.viewport.width - 0.75) <= 0.01,
        'the reading column is not three quarters wide');
    check(Math.abs(full.stage.x - (full.viewport.width - full.stage.x - full.stage.width)) <= 1,
        'the reading column is not centered');
    check(full.post.y >= 6, 'the focus frame reaches the top screen edge');
    check(/退出全屏/.test(full.help), 'the footer does not explain Back');

    await key('back');
    const restored = await state();
    check(restored.detail && !restored.reading && restored.comments,
        'Back from full reading did not restore detail and comments');
    record('detail-restored', {scene: restored});
    await key('back');
    const home = await state();
    check(!home.detail && !home.reading, 'detail Back left an extra full-screen timeline layer');
    check(home.position === before.position && home.author === before.author, 'timeline selection was lost');
    record('back-to-timeline', {scene: home});

    const writes = adb('logcat', '-d', '-s', 'TvXWritePerf').split('\n').filter(l => /TvXWritePerf/.test(l));
    record('no-writes', {writes});
    check(writes.length === 0, 'this run sent write traffic: ' + JSON.stringify(writes));
} catch (error) {
    failure = error.message;
    record('failed', {error: failure});
} finally {
    cdp.close();
    mkdirSync(dirname(OUT), {recursive: true});
    writeFileSync(OUT, JSON.stringify({serial: SERIAL, out: OUT, failure, evidence}, null, 2));
    console.log(failure ? 'FAIL — ' + failure : 'PASS — full-screen reading verified on device');
    console.log('evidence written to ' + OUT);
    process.exit(failure ? 1 : 0);
}
