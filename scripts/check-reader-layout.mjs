/**
 * Real-device layout acceptance for issue #14: the timeline status belongs top left, and a
 * focused post's frame must be whole. Measures the live 1920x1080 projector layout and checks
 * the constraints the ticket names. Read-only: it navigates and measures, nothing else.
 *
 * Screenshots are optional (--shots <dir>) and stay out of version control: they contain the
 * signed-in timeline.
 *
 * Usage: node scripts/check-reader-layout.mjs [--out <file.json>] [--shots <dir>]
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
const OUT = option('--out') || 'docs/validation/issue-14-samples.json';
const SHOTS = option('--shots');
const PORT = 9338;
const KEYS = {menu: 82, up: 19, down: 20, ok: 23, back: 4};

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
    adb('shell', 'screencap', '-p', '/sdcard/tvx-layout.png');
    adb('pull', '/sdcard/tvx-layout.png', `${SHOTS}/${name}.png`);
    adb('shell', 'rm', '-f', '/sdcard/tvx-layout.png');
}

const pid = await launch();
const cdp = await connect(PORT);
const key = async name => {
    adb('shell', 'input', 'keyevent', String(KEYS[name]));
    await wait(500);
};
/** Boxes plus the outward reach of the focus decoration, in CSS pixels. */
const measure = focus => cdp.evaluate(`(function(){
    var box = function(sel) {
        var n = document.querySelector(sel);
        if (!n) return null;
        var b = n.getBoundingClientRect();
        return {left: Math.round(b.left), right: Math.round(b.right), top: Math.round(b.top),
            bottom: Math.round(b.bottom), width: Math.round(b.width), height: Math.round(b.height)};
    };
    var ring = function(sel) {
        var n = document.querySelector(sel);
        if (!n) return 0;
        var s = getComputedStyle(n);
        var lengths = (s.boxShadow.match(/-?[0-9.]+px/g) || []).map(parseFloat).map(Math.abs);
        return Math.round((parseFloat(s.outlineWidth) + parseFloat(s.outlineOffset) +
            (lengths.length ? Math.max.apply(null, lengths) : 0)) * 100) / 100;
    };
    return JSON.stringify({
        viewport: {width: innerWidth, height: innerHeight, dpr: devicePixelRatio},
        title: box('#title'), status: box('#status'), freshness: box('#freshness'),
        position: box('#position'), refresh: box('#refresh'),
        stage: box('#stage'), focused: box(${JSON.stringify(focus)}),
        media: box('#stage>.media'), comments: box('.comments'),
        ring: ring(${JSON.stringify(focus)}),
        freshnessText: document.getElementById('freshness').textContent
    });
})()`).then(JSON.parse);

/** Everything the ticket asks of a focused post's frame, on the real screen. */
function checkFrame(where, m) {
    const {focused: f, stage: s, ring} = m;
    if (!f) throw new Error(where + ': nothing is focused');
    if (ring <= 0) throw new Error(where + ': the focus frame has no outward reach to protect');
    const edges = {
        left: f.left - ring - s.left,
        right: s.right - (f.right + ring),
        top: f.top - ring - s.top,
        bottom: s.bottom - (f.bottom + ring)
    };
    Object.keys(edges).forEach(edge => {
        if (edges[edge] < 1) throw new Error(
            `${where}: the focus frame is clipped on the ${edge} (clearance ${edges[edge]}px)`);
    });
    if (f.left - ring < 0) throw new Error(where + ': the focus frame runs off the screen');
    return edges;
}

try {
    for (let i = 0; i < 120; i++) {
        const ready = await cdp
            .evaluate("typeof TvXReader === 'object' && !!document.querySelector('.post')")
            .catch(() => false);
        if (ready) break;
        await wait(500);
    }
    for (let i = 0; i < 120; i++) {
        if ((await cdp.evaluate("document.getElementById('freshness').textContent")) === '刚刚更新') break;
        await wait(500);
    }
    const top = await measure('.post');
    shot('01-timeline-top');
    record('timeline-top', {pid, ...top, clearance: checkFrame('timeline top', top)});
    const half = top.viewport.width / 2;
    ['freshness', 'position', 'refresh'].forEach(part => {
        if (!top[part] || !top[part].width) throw new Error(part + ' is not visible');
        if (top[part].left >= half) throw new Error(part + ' is not in the left half of the screen');
    });
    if (Math.abs(top.status.left - top.title.left) > 1)
        throw new Error('the status row is not aligned with the title');
    if (top.status.bottom > top.stage.top - top.ring)
        throw new Error('the status row reaches into the focus frame');

    // Scrolled: a post further down the timeline keeps the same margins.
    await key('down');
    await key('down');
    const scrolled = await measure('.post');
    shot('02-timeline-scrolled');
    record('timeline-scrolled', {...scrolled, clearance: checkFrame('timeline scrolled', scrolled)});
    if (scrolled.focused.left !== top.focused.left)
        throw new Error('the left margin moved while scrolling the timeline');

    // Detail: same left edge, frame still whole, comments column still to the right.
    await key('ok');
    for (let i = 0; i < 80; i++) {
        if (await cdp.evaluate("!!document.querySelector('.detail-post')")) break;
        await wait(500);
    }
    await wait(1500);
    const detail = await measure('.detail-post');
    shot('03-detail');
    record('detail', {...detail, clearance: checkFrame('detail', detail)});
    if (detail.focused.left !== top.focused.left)
        throw new Error('the detail does not share the timeline left margin');
    if (detail.comments && detail.comments.left < detail.focused.right)
        throw new Error('the comments column overlaps the post');

    // A long update line must not reach the posts or run off the screen.
    await key('back');
    await cdp.evaluate("TvXReader.notice('');" +
        "document.getElementById('freshness').textContent = " +
        "'上次时间线 2026/9/10 下午12:48:42 · 正在更新 · 网络较慢，正在重试';");
    const long = await measure('.post');
    shot('04-long-status');
    record('long-status', {status: long.status, refresh: long.refresh, stage: long.stage,
        text: long.freshnessText});
    if (long.status.bottom > long.stage.top - long.ring)
        throw new Error('a long update line reaches into the posts');
    if (long.refresh.right > long.viewport.width)
        throw new Error('a long update line pushes refresh off the screen');

    writeFileSync(OUT, JSON.stringify(evidence, null, 1) + '\n');
    console.log('\nPASS — evidence written to ' + OUT);
} catch (error) {
    writeFileSync(OUT, JSON.stringify(evidence.concat([{failure: String(error)}]), null, 1) + '\n');
    console.error('\nFAIL —', error.message);
    process.exitCode = 1;
} finally {
    cdp.close();
}
