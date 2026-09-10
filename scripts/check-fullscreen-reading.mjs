/**
 * Real-device acceptance for full-screen reading: on a post whose text does not fit, confirm
 * drops the header, stacks the post above what accompanies it, and gives the column three
 * quarters of the screen; back puts the page back exactly as it was. On a post that already
 * fits, confirm keeps its old meaning and opens the detail straight away.
 *
 * Read-only against X: it only reads the timeline and one detail, and checks for write traffic.
 *
 * Usage: node scripts/check-fullscreen-reading.mjs [--out <file.json>]
 * The debug APK must already be installed and signed in.
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
const OUT = option('--out') || 'docs/validation/fullscreen-reading-samples.json';
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
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

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

    // Walk the live timeline once and note which posts overflow their pane and which fit,
    // so both halves of the rule are exercised against real content.
    const scan = [];
    for (let i = 0; i < 12; i++) {
        const at = await state();
        scan.push({step: i, position: at.position, clipped: at.clipped, media: !!at.media});
        if (at.position.split('/')[0].trim() === at.position.split('/')[1].trim()) break;
        await key('down');
    }
    record('scan', {pid: globalThis.__pid, posts: scan});
    const long = scan.find(p => p.clipped && p.media) || scan.find(p => p.clipped);
    const short = scan.find(p => !p.clipped);
    check(!!long, 'no post in the live timeline overflows its pane, so reading mode cannot be checked');

    /** Back jumps to the first post in one press, so any post is two moves away. */
    async function goTo(step) {
        if ((await state()).position.split('/')[0].trim() !== '1') await key('back');
        for (let i = 0; i < step; i++) await key('down');
        return state();
    }
    let before = await goTo(long.step);
    check(before.clipped, 'the post picked as too long no longer overflows');
    record('timeline', {picked: long, scene: before});
    check(before.headerShown, 'the header was not showing before reading mode');
    check(before.direction === 'row', 'the ordinary timeline is not a row layout');
    if (before.media)
        check(before.media.x >= before.post.x + before.post.width - 1,
            'the media pane is not beside the post before reading mode');

    adb('logcat', '-c');
    await key('ok');
    const full = await until(async () => {
        const at = await state();
        return at.reading ? at : null;
    }, 'reading mode to open', 20);
    const centred = full.viewport.width - full.stage.x - full.stage.width;
    record('timeline-fullscreen', {
        scene: full,
        widthRatio: +(full.stage.width / full.viewport.width).toFixed(3),
        leftGap: full.stage.x, rightGap: centred
    });
    check(!full.headerShown, 'the header is still showing in reading mode');
    check(full.direction === 'column', 'reading mode did not stack the panes');
    check(Math.abs(full.stage.width / full.viewport.width - 0.75) <= 0.01,
        'the reading column is ' + full.stage.width + 'px of ' + full.viewport.width + 'px, not three quarters');
    check(Math.abs(full.stage.x - centred) <= 1,
        'the reading column is not centred: ' + full.stage.x + ' vs ' + centred);
    // With the header gone the focus ring must still clear the top of the panel.
    check(full.post.y >= 6, 'the reading column sits on the top edge at y=' + full.post.y);
    // Same bottom edge as the ordinary stage (to the rounded pixel), so the status line and
    // the footer keep the room they had.
    check(full.stage.y + full.stage.height <= before.stage.y + before.stage.height + 2,
        'reading mode reaches below the ordinary stage and into the status line');
    if (full.media) {
        check(full.media.y >= full.post.y + full.post.height - 1, 'the media is not below the post');
        check(full.post.height > full.media.height, 'the post is not the taller pane');
    }
    check(/退出全屏/.test(full.help), 'the footer does not say back leaves reading mode');
    check(/确认 帖子详情/.test(full.help), 'the footer does not say the next confirm opens the detail');

    await key('back');
    const restored = await until(async () => {
        const at = await state();
        return !at.reading ? at : null;
    }, 'reading mode to close', 20);
    record('timeline-restored', {scene: restored});
    check(restored.headerShown && restored.direction === 'row', 'the ordinary layout did not come back');
    check(same(restored.stage, before.stage) && same(restored.post, before.post),
        'the page did not come back to the same geometry');
    check(restored.position === before.position && restored.author === before.author,
        'the reader lost its place leaving reading mode');
    check(/确认 全屏阅读/.test(restored.help), 'the footer does not offer reading mode for a long post');

    // A post that already fits keeps confirm on its detail, with no extra press.
    if (short) {
        const fits = await goTo(short.step);
        check(!fits.clipped, 'the post picked as short now overflows');
        check(/确认 帖子详情/.test(fits.help), 'a post that fits still advertises reading mode');
        await key('ok');
        const opened = await until(async () => {
            const at = await state();
            return at.detail ? at : null;
        }, 'the short post detail to open on one press', 60);
        record('short-post', {picked: short, before: fits, scene: opened});
        check(!opened.reading, 'a post that fits went into reading mode instead of its detail');
        await key('back');
        await until(async () => !(await state()).detail, 'the timeline to come back', 30);
        before = await goTo(long.step);
    } else
        record('short-post', {skipped: 'every post in this timeline overflows its pane'});

    // The same journey in the detail, where the second pane is the comments.
    await key('ok');
    await key('ok');
    const detail = await until(async () => {
        const at = await state();
        return at.detail && at.comments && at.clipped ? at : null;
    }, 'the post detail with its comments', 60);
    record('detail', {scene: detail});
    check(/确认 全屏阅读/.test(detail.help), 'the detail does not offer reading mode for a long post');
    check(detail.comments.x >= detail.post.x + detail.post.width - 1,
        'the comments are not beside the post before reading mode');

    await key('ok');
    const detailFull = await until(async () => {
        const at = await state();
        return at.reading ? at : null;
    }, 'the detail to open in reading mode', 20);
    record('detail-fullscreen', {
        scene: detailFull,
        widthRatio: +(detailFull.stage.width / detailFull.viewport.width).toFixed(3)
    });
    check(!detailFull.headerShown, 'the detail header is still showing in reading mode');
    check(detailFull.comments.y >= detailFull.post.y + detailFull.post.height - 1,
        'the comments are not below the post');
    check(detailFull.post.height > detailFull.comments.height, 'the post is not the taller pane');
    check(Math.abs(detailFull.stage.width / detailFull.viewport.width - 0.75) <= 0.01,
        'the detail reading column is not three quarters wide');

    await key('back');
    const stillDetail = await until(async () => {
        const at = await state();
        return !at.reading ? at : null;
    }, 'the detail to leave reading mode', 20);
    record('detail-restored', {scene: stillDetail});
    check(stillDetail.detail, 'back left the detail instead of only leaving reading mode');
    check(same(stillDetail.stage, detail.stage), 'the detail did not come back to the same geometry');

    await key('back');
    const home = await until(async () => {
        const at = await state();
        return !at.detail ? at : null;
    }, 'the timeline to come back', 20);
    record('back-to-timeline', {scene: home});
    check(home.position === before.position && home.author === before.author,
        'the timeline lost its place');

    const writes = adb('logcat', '-d', '-s', 'TvXWritePerf').split('\n').filter(l => /TvXWritePerf/.test(l));
    record('no-writes', {writes});
    check(writes.length === 0, 'this run sent write traffic: ' + JSON.stringify(writes));
} catch (error) {
    failure = error.message;
    record('failed', {error: failure});
} finally {
    cdp.close();
    writeFileSync(OUT, JSON.stringify({serial: SERIAL, out: OUT, failure, evidence}, null, 2));
    console.log(failure ? 'FAIL — ' + failure : 'PASS — full-screen reading verified on device');
    console.log('evidence written to ' + OUT);
    process.exit(failure ? 1 : 0);
}
