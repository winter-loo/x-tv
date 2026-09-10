/**
 * Real-device acceptance for the likes list: at the top of the timeline the left key really
 * opens the signed-in reader's own likes, and the list behaves like the timeline it sits beside.
 *
 * Read-only against X. It issues the Likes query the feature itself issues and nothing else; no
 * like, unlike, reply or any other mutation is sent, and the run is checked for write traffic.
 *
 * Usage: node scripts/check-likes.mjs [--out <file.json>]
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
const OUT = option('--out') || 'docs/validation/likes-samples.json';
const PORT = 9340;
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
const reads = pattern => adb('logcat', '-d', '-s', 'TvXReaderPerf', 'TvXApiPerf', 'TvXWritePerf')
                             .split('\n')
                             .map(l => l.replace(/^.*[VDIWE] (TvX\w+Perf): /, '$1 ').trim())
                             .filter(l => pattern.test(l));

const pid = await launch();
const cdp = await connect(PORT);
const scene = `JSON.stringify({
    tabNow: (document.querySelector('#title .tab-now') || {textContent: ''}).textContent,
    tabAlt: (document.querySelector('#title .tab-alt') || {textContent: ''}).textContent,
    title: document.getElementById('title').textContent,
    position: document.getElementById('position').textContent,
    freshness: document.getElementById('freshness').textContent,
    author: (document.querySelector('.post .name') || {textContent: ''}).textContent,
    body: ((document.querySelector('.post .text') || {textContent: ''}).textContent || '').slice(0, 40),
    liked: !!document.querySelector('.stats .liked'),
    loading: (document.querySelector('.loading') || {textContent: ''}).textContent,
    detail: !!document.querySelector('.detail-post'),
    help: document.getElementById('help').textContent,
    notice: document.getElementById('notice').textContent
})`;
const state = () => cdp.evaluate(scene).then(JSON.parse);
const key = async name => {
    adb('shell', 'input', 'keyevent', String(KEYS[name]));
    await wait(600);
};
const total = at => Number((at.position.split('/')[1] || '0').trim());
let failure = null;
function check(condition, message) {
    if (!condition) throw new Error(message);
}

try {
    await until(() => cdp.evaluate("typeof TvXReader === 'object' && document.querySelectorAll('.post').length > 0")
                         .catch(() => false),
        'the reader to render its timeline');
    await until(async () => (await state()).tabNow === 'X · 时间线', 'the timeline header to settle', 60);
    await until(async () => (await state()).freshness === '刚刚更新', 'the live timeline to settle', 60);
    const timeline = await state();
    record('timeline', {pid, scene: timeline});
    check(timeline.tabAlt === '← 我的喜欢', 'the timeline never advertised the likes list');

    // Watch what the native client actually hands back, so "liked" is X's answer, not the UI's.
    await cdp.evaluate(`window.__probe = {};
        (function(){ var real = TvXReader.receive;
          TvXReader.receive = function(id, payload, error) {
            window.__probe[id] = {ok: !!payload, error: error, liked: 0, posts: 0};
            if (payload) (function walk(v) {
                if (!v || typeof v !== 'object') return;
                var r = v.tweet_results && v.tweet_results.result;
                if (r) {
                    var t = r.tweet || r;
                    if (t.legacy) { window.__probe[id].posts++; if (t.legacy.favorited === true) window.__probe[id].liked++; }
                    return;
                }
                Object.keys(v).forEach(function(k) { walk(v[k]); });
            })(payload.data);
            return real.apply(null, arguments);
          }; })();`);
    adb('logcat', '-c');

    await key('left');
    const settled = await until(async () => {
        const at = await state();
        return at.tabNow === '我的喜欢' && (total(at) > 0 || /还没有喜欢的帖子|加载未完成/.test(at.loading)) ? at : null;
    }, 'the likes list to answer', 90);
    // Two lines: the whole wait, and the HTTP call inside it. The gap is metadata preparation.
    const request = reads(/likes request ms=|Likes status=/);
    const probe = JSON.parse(await cdp.evaluate(
        'JSON.stringify(Object.keys(window.__probe).map(function(k){var p=window.__probe[k];p.id=k;return p;}))'));
    record('likes-opened', {scene: settled, request, probe});
    const completed = request.filter(l => /likes request ms=/.test(l));
    check(completed.length === 1, 'expected exactly one Likes read, got ' + completed.length);
    check(/result=ok/.test(completed[0]), 'the Likes read did not succeed: ' + completed[0]);
    check(settled.tabAlt === '← X · 时间线', 'the likes list never advertised the way back');
    check(!/加载未完成/.test(settled.loading), 'the likes list failed to load');

    const answered = probe.find(p => p.posts > 0 || p.ok);
    const empty = total(settled) === 0;
    if (empty) {
        record('likes-empty', {loading: settled.loading, help: settled.help});
        check(settled.loading === '还没有喜欢的帖子', 'an empty likes list did not say so');
    } else {
        check(answered.liked === answered.posts,
            'X returned ' + answered.posts + ' posts but only ' + answered.liked + ' marked as liked');
        check(settled.liked, 'the first liked post is not shown as liked');
        check(Number(settled.position.split('/')[0]) === 1, 'the likes list did not start at its first post');

        await key('down');
        const second = await state();
        record('likes-paged', {scene: second});
        check(total(second) === total(settled) && second.position.startsWith('2'),
            'down did not move through the likes list');
        check(second.author !== settled.author || second.body !== settled.body,
            'down showed the same post again');

        await key('up');
        await key('ok');
        const detail = await until(async () => {
            const at = await state();
            return at.detail ? at : null;
        }, 'the liked post to open', 60);
        record('likes-detail', {scene: detail});
        check(detail.author === settled.author, 'the detail opened a different post');

        await key('back');
        const returned = await until(async () => {
            const at = await state();
            return at.tabNow === '我的喜欢' && total(at) > 0 ? at : null;
        }, 'the likes list to come back', 60);
        record('likes-restored', {scene: returned});
        check(returned.position === settled.position, 'the likes list lost its place');

        // The first open pays for waking the metadata page; a warm re-read shows the real cost.
        adb('logcat', '-c');
        await key('up');
        const refreshed = await until(async () => {
            const at = await state();
            return total(at) > 0 && !at.notice ? at : null;
        }, 'the likes list to refresh', 90);
        record('likes-refreshed', {scene: refreshed, reads: reads(/likes request ms=|Likes status=/)});
        check(total(refreshed) > 0, 'the refreshed likes list came back empty');
    }

    adb('logcat', '-c');
    await key('left');
    const back = await until(async () => {
        const at = await state();
        return at.tabNow === 'X · 时间线' ? at : null;
    }, 'the timeline to come back', 60);
    const again = reads(/likes request ms=|home request ms=/);
    record('timeline-restored', {scene: back, reads: again});
    check(again.length === 0, 'coming back re-read the network: ' + JSON.stringify(again));
    check(back.author === timeline.author, 'the timeline lost its place');

    const writes = reads(/TvXWritePerf/);
    record('no-writes', {writes});
    check(writes.length === 0, 'this run sent write traffic: ' + JSON.stringify(writes));
} catch (error) {
    failure = error.message;
    record('failed', {error: failure});
} finally {
    cdp.close();
    writeFileSync(OUT, JSON.stringify({serial: SERIAL, out: OUT, failure, evidence}, null, 2));
    console.log(failure ? 'FAIL — ' + failure : 'PASS — likes list verified on device');
    console.log('evidence written to ' + OUT);
    process.exit(failure ? 1 : 0);
}
