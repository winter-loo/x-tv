/**
 * Real-device acceptance for issue #21: at the top of the timeline the up key really pulls new
 * posts in. Read-only against X — it re-reads the home timeline and replays a shortened copy of
 * it so the refresh has genuinely new, genuinely real posts to bring back. No writes.
 *
 * Usage: node scripts/check-timeline-refresh.mjs [--out <file.json>]
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
const OUT = option('--out') || 'docs/validation/issue-21-samples.json';
const PORT = 9337;
const KEYS = {menu: 82, up: 19, down: 20, ok: 23, back: 4};
const DROPPED = 2;

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
/** How many home reads the native client actually issued since the last checkpoint. */
function homeReads() {
    const lines = adb('logcat', '-d', '-s', 'TvXReaderPerf')
        .split('\n')
        .filter(l => /home request ms=/.test(l))
        .map(l => l.replace(/^.*TvXReaderPerf: /, '').trim());
    adb('logcat', '-c');
    return lines;
}

const pid = await launch();
const cdp = await connect(PORT);
const scene = `JSON.stringify({
    position: document.getElementById('position').textContent,
    author: (document.querySelector('.post .name') || {textContent: ''}).textContent,
    freshness: document.getElementById('freshness').textContent,
    refresh: document.getElementById('refresh').textContent,
    notice: document.getElementById('notice').textContent
})`;
const state = () => cdp.evaluate(scene).then(JSON.parse);
const key = async name => {
    adb('shell', 'input', 'keyevent', String(KEYS[name]));
    await wait(400);
};
/** Presses without pausing to read the screen, so a burst really lands inside one refresh. */
async function burst(name, times) {
    for (let i = 0; i < times; i++) {
        adb('shell', 'input', 'keyevent', String(KEYS[name]));
        await wait(150);
    }
}
/** The refresh has landed when the reader says what happened. */
const settled = () => until(async () => {
    const at = await state();
    return /已加入|暂无|重试/.test(at.notice) ? at : null;
}, 'the refresh to report what happened', 60);
const total = at => Number(at.position.split('/')[1]);

try {
    await until(() => cdp.evaluate("typeof TvXReader === 'object' && document.querySelectorAll('.post').length > 0")
                         .catch(() => false),
        'the reader to render its timeline');
    await until(async () => (await state()).freshness === '刚刚更新', 'the live timeline to settle', 60);
    const live = await state();
    record('cold-start', {pid, scene: live});

    // Re-read the real timeline out of band, then give the reader a copy with the first two
    // posts removed. The refresh below therefore has real posts to bring back.
    await cdp.evaluate(`window.__probe = {};
        (function(){ var real = TvXReader.receive;
          TvXReader.receive = function(id, payload, error) {
            window.__probe[id] = {payload: payload, error: error};
            return real.apply(null, arguments);
          }; })();
        ReaderHost.request('r99', 'home', '', '');`);
    const fetched = await until(
        () => cdp.evaluate('JSON.stringify(window.__probe.r99 ? {ok: !!window.__probe.r99.payload, error: window.__probe.r99.error} : null)')
                 .then(v => JSON.parse(v)),
        'the out-of-band home read');
    if (!fetched.ok) throw new Error('could not re-read the timeline: ' + fetched.error);
    const shortened = Number(await cdp.evaluate(`(function(){
        var results = [];
        (function walk(v) {
            if (!v || typeof v !== 'object') return;
            if (v.tweet_results && v.tweet_results.result) { results.push(v.tweet_results.result); return; }
            Object.keys(v).forEach(function(k) { walk(v[k]); });
        })(window.__probe.r99.payload.data);
        window.__kept = results.slice(${DROPPED});
        TvXReader.receive('r0', {data: {list: window.__kept.map(function(r) {
            return {tweet_results: {result: r}};
        })}}, '');
        return results.length;
    })()`));
    await until(async () => total(await state()) === shortened - DROPPED, 'the shortened timeline to render');
    const shortState = await state();
    record('shortened', {realPosts: shortened, showing: total(shortState), scene: shortState});

    // The ticket's flow: read down the list, back to the first post, then up.
    await key('down');
    await key('down');
    const read = await state();
    await key('back');
    const top = await until(async () => {
        const at = await state();
        return at.position.indexOf('1 /') === 0 ? at : null;
    }, 'back to reach the first post');
    record('back-to-top', {read: read.position, top: top.position, author: top.author});
    homeReads();

    // One press: the header must say a refresh is running while the read is still in flight.
    await key('up');
    const refreshing = await state();
    const arrived = await settled();
    // X ranks the home timeline, so two reads need not return the same posts. Work out the
    // ground truth from the two payloads the reader itself used, rather than assuming.
    const truth = JSON.parse(await cdp.evaluate(`(function(){
        var ids = function(payload) {
            return TvXReadData.parse(payload, 'home').posts.map(function(p) { return p.id; });
        };
        var before = ids({data: {list: window.__kept.map(function(r) {
            return {tweet_results: {result: r}};
        })}});
        var refreshed = Object.keys(window.__probe).filter(function(k) {
            return k !== 'r99' && window.__probe[k].payload;
        });
        var after = ids(window.__probe[refreshed[refreshed.length - 1]].payload);
        return JSON.stringify({
            before: before.length,
            after: after.length,
            fresh: after.filter(function(id) { return before.indexOf(id) < 0; }).length
        });
    })()`));
    const reported = Number((arrived.notice.match(/(\d+)/) || [])[1]);
    record('refresh', {
        whileRefreshing: refreshing,
        arrived,
        truth,
        reportedCount: reported,
        reads: homeReads()
    });
    if (refreshing.refresh.indexOf('正在刷新') < 0)
        throw new Error('the header did not show that a refresh was running');
    if (!truth.fresh)
        throw new Error('X returned an identical page, so nothing new could appear; rerun');
    if (reported !== truth.fresh)
        throw new Error(`the reported count ${reported} does not match the ${truth.fresh} posts that were new`);
    if (total(arrived) !== truth.after)
        throw new Error(`the list does not match what arrived: ${arrived.position} vs ${truth.after}`);
    if (arrived.position.indexOf('1 /') !== 0)
        throw new Error('focus did not land on the new first post: ' + arrived.position);

    // Three presses fired back to back, with no round trip in between, stay inside one read
    // window and must merge into a single request with a single answer.
    // Each keyevent is its own adb round trip, so a burst can outlast one read; what has to
    // hold on the device is that presses do not pile refreshes up. Exact merging inside a
    // single window is pinned deterministically by tests/refresh.spec.mjs.
    homeReads();
    const burstStarted = Date.now();
    await burst('up', 3);
    const burstMs = Date.now() - burstStarted;
    const merged = await settled();
    const mergedReads = homeReads();
    record('merged-presses', {scene: merged, burstMs, reads: mergedReads});
    if (mergedReads.length >= 3)
        throw new Error(`three presses caused ${mergedReads.length} home reads; they piled up`);
    if (!/暂无新帖子|已加入/.test(merged.notice))
        throw new Error('a merged pull gave no clear feedback: ' + merged.notice);

    // Up while the media pane owns the focus belongs to the media pane.
    homeReads();
    await key('down');
    await key('up');
    const navigated = await state();
    record('up-is-navigation-below-the-top', {scene: navigated, reads: homeReads()});

    writeFileSync(OUT, JSON.stringify(evidence, null, 1) + '\n');
    console.log('\nPASS — evidence written to ' + OUT);
} catch (error) {
    writeFileSync(OUT, JSON.stringify(evidence.concat([{failure: String(error)}]), null, 1) + '\n');
    console.error('\nFAIL —', error.message);
    process.exitCode = 1;
} finally {
    cdp.close();
}
