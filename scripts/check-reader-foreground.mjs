/**
 * Real-device acceptance for issue #22: cold start, external return and cancelled loads all
 * end on the same local reader, restoring the scene they came from. Read-only against X:
 * it fetches posts and drives the remote. No likes, replies or account changes.
 *
 * Usage: node scripts/check-reader-foreground.mjs [--post <id>] [--out <file.json>]
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
const POST = option('--post') || '2091922092543402349';
const OUT = option('--out') || 'docs/validation/issue-22-samples.json';
const PORT = 9334;
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
    const started = Date.now();
    adb('shell', 'am', 'start', '-n', 'cn.deeloo.tvxbrowser/.BrowserActivity');
    for (let i = 0; i < 60; i++) {
        await wait(500);
        const pid = adb('shell', 'pidof', 'cn.deeloo.tvxbrowser').trim().split(/\s+/)[0];
        if (!pid) continue;
        try {
            adb('forward', `tcp:${PORT}`, `localabstract:webview_devtools_remote_${pid}`);
            const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
            if (list.some(t => t.url.endsWith('/reader/index.html'))) return {pid, started};
        } catch (_) {}
    }
    throw new Error('the reader never came up; is the build installed and signed in?');
}
/** Which surface actually owns the screen, read from the live view hierarchy. */
function surfaces() {
    const dump = adb('shell', 'dumpsys', 'activity', 'top');
    const visibility = name => {
        const m = dump.match(new RegExp(name + '\\{[0-9a-f]+ ([VIG])'));
        return m ? m[1] : 'absent';
    };
    const overlay = dump.match(/\{[0-9a-f]+ ([VIG])[^}]*app:id\/loading_overlay\}/);
    return {reader: visibility('FastReader'), gecko: visibility('GeckoView'),
        loading: overlay ? overlay[1] : 'absent'};
}
/** The document the handoff last committed, read without consuming the log. */
function lastCommitted() {
    const lines = adb('logcat', '-d', '-s', 'BrowserActivity')
        .split('\n')
        .filter(line => /handoff loading url=/.test(line));
    return lines.length ? lines[lines.length - 1].replace(/^.*handoff loading url=/, '').trim() : '';
}
/** True once the browser is in front, showing the document asked for, and done loading it. */
const presenting = wanted =>
    surfaces().reader !== 'V' && surfaces().loading !== 'V' && lastCommitted().indexOf(wanted) === 0;
/** `dumpsys` occasionally returns a partial hierarchy, so agree with a second sample. */
function foreground() {
    const first = surfaces().reader === 'V' ? 'reader' : 'gecko';
    const second = surfaces().reader === 'V' ? 'reader' : 'gecko';
    return first === second ? first : foreground();
}
let sessionOpens = 0;
function stages() {
    const dump = adb('logcat', '-d', '-s', 'BrowserActivity');
    sessionOpens += (dump.match(/Opening session with runtime/g) || []).length;
    const lines = dump.split('\n')
        .filter(line => /handoff (open|loading|shown|failed|closed)/.test(line))
        .map(line => line.replace(/^.*BrowserActivity: ===> handoff /, '').trim());
    adb('logcat', '-c');
    return lines;
}
/** Reader timing marks since the last log clear; read before any stages() call consumes them. */
function perf() {
    return adb('logcat', '-d', '-s', 'TvXReaderPerf')
        .split('\n')
        .filter(l => /(home|detail) (live|cached|reused) ms=/.test(l))
        .map(l => l.replace(/^.*TvXReaderPerf: /, '').trim());
}
async function until(check, label, seconds = 30) {
    const end = Date.now() + seconds * 1000;
    while (Date.now() < end) {
        const value = await check();
        if (value) return value;
        await wait(300);
    }
    throw new Error('timed out waiting for ' + label);
}

const cdp = await (async () => {
    const {pid, started} = await launch();
    const client = await connect(PORT);
    client.pid = pid;
    client.started = started;
    return client;
})();
const scene = `JSON.stringify({
    title: document.getElementById('title').textContent,
    toolbar: document.querySelector('header').textContent.replace(/\\s+/g, ' ').trim()
        + ' | help: ' + document.getElementById('help').textContent.replace(/\\s+/g, ' ').trim(),
    freshness: document.getElementById('freshness').textContent,
    position: document.getElementById('position').textContent,
    detail: !!document.querySelector('.detail-post'),
    comment: (document.querySelector('.comment.selected') || {textContent: ''}).textContent.slice(0, 24),
    author: (document.querySelector('.post .name') || {textContent: ''}).textContent,
    bodyY: Math.round((document.querySelector('.body') || {scrollTop: 0}).scrollTop),
    external: !!document.querySelector('.external-status'),
    posts: document.querySelectorAll('.post').length
})`;
const state = () => cdp.evaluate(scene).then(JSON.parse);
const key = async name => {
    adb('shell', 'input', 'keyevent', String(KEYS[name]));
    await wait(400);
};
/** Replays a timeline into the reader at whatever request id it is currently waiting on. */
async function replay(data, author) {
    await cdp.evaluate(`TvXReader.receive('r0', {data: ${data}}, '')`);
    await until(async () => (await state()).author === author, 'the replayed timeline to render');
}
/** A post long enough that its reading pane really scrolls, carrying one external link. */
function longPost(url, display) {
    return `{probe: {tweet_results: {result: {
        rest_id: '901',
        core: {user_results: {result: {core: {name: 'Longread', screen_name: 'longread'}}}},
        legacy: {full_text: ${JSON.stringify('A long enough post to scroll.\n'.repeat(200))},
            conversation_id_str: '901', entities: {urls: [{
                url: 'https://t.co/long', expanded_url: ${JSON.stringify(url)},
                display_url: ${JSON.stringify(display)}}]}}}}}}`;
}
/** Scrolls the reading pane and refuses to continue if there is nothing to scroll. */
async function scrollBody(to) {
    const at = Number(await cdp.evaluate(
        `(function(){var b=document.querySelector('.body');b.scrollTop=${to};return b.scrollTop})()`));
    if (!(at > 0)) throw new Error('the reading pane did not scroll, so restoring it proves nothing');
    return at;
}
/** Opens the focused post's first external link through the remote menu. */
async function openLink() {
    await key('menu');
    const at = JSON.parse(await cdp.evaluate(
        `JSON.stringify(Array.from(document.querySelectorAll('.action-options button')).map(function(b){return b.className}))`))
        .findIndex(c => c.indexOf('external') >= 0);
    if (at < 0) throw new Error('the focused post offered no external target');
    for (let i = 0; i < at; i++) await key('down');
    await key('ok');
}

try {
    await until(() => cdp.evaluate("typeof TvXReader === 'object' && document.querySelectorAll('.post').length > 0")
                         .catch(() => false),
        'the reader to render its timeline');
    const cold = await state();
    record('cold-start', {foreground: foreground(), surfaces: surfaces(), scene: cold,
        msToTimeline: Date.now() - cdp.started, marks: perf(),
        cache: cold.freshness.indexOf('上次时间线') === 0 ? 'warm' : 'live'});
    await until(() => foreground() === 'reader', 'cold start to land on the reader', 10);

    // Replay the ticket's sample post so every journey below runs against it. The reader only
    // moves off request id r0 when it opens a detail, so every replay happens before that.
    await cdp.evaluate(`window.__probe = {};
        (function(){ var real = TvXReader.receive;
          TvXReader.receive = function(id, payload, error) {
            window.__probe[id] = {payload: payload, error: error};
            return real.apply(null, arguments);
          };
        })();
        ReaderHost.request('r99', 'detail', ${JSON.stringify(POST)}, '');`);
    const fetched = await until(
        () => cdp.evaluate('JSON.stringify(window.__probe.r99 ? {ok: !!window.__probe.r99.payload, error: window.__probe.r99.error} : null)')
                 .then(v => JSON.parse(v)),
        'the sample post to arrive');
    if (!fetched.ok) throw new Error('sample post fetch failed: ' + fetched.error);
    const root = JSON.parse(await cdp.evaluate(
        `JSON.stringify(TvXReadData.parse(window.__probe.r99.payload, 'detail', ${JSON.stringify(POST)}).root)`));
    record('sample', {post: POST, path: root.path, links: root.links});
    if (!root.links.length) throw new Error('sample post exposed no external link');
    const sampleData = `{probe: window.__probe.r99.payload.data}`;
    await replay(sampleData, root.author.name);
    adb('logcat', '-c');

    // 1. Timeline: open the sample's link, come back, and land on the scene cold start showed.
    const before = await state();
    await openLink();
    await until(() => foreground() === 'gecko', 'the external page to take the screen');
    await key('back');
    await until(() => foreground() === 'reader', 'the reader to come back');
    const after = await state();
    record('timeline-return', {foreground: foreground(), before, after, stages: stages()});
    if (after.title !== cold.title)
        throw new Error(`return shows a different reading UI: ${cold.title} vs ${after.title}`);
    if (after.toolbar.split('|').pop() !== cold.toolbar.split('|').pop())
        throw new Error('return shows a different toolbar than cold start');
    if (after.author !== before.author || after.position !== before.position || after.external)
        throw new Error('the timeline did not come back to the post the link was opened from');

    // 1b. The sample post is short, so prove scroll restoration on one that really scrolls.
    await replay(longPost(root.links[0].url, root.links[0].domain), 'Longread');
    const scrolledTo = await scrollBody(600);
    await openLink();
    await until(() => foreground() === 'gecko', 'the long post external page');
    await key('back');
    await until(() => foreground() === 'reader', 'the reader after the long post');
    const afterLong = await state();
    record('timeline-scroll-return', {scrolledTo, after: afterLong, stages: stages()});
    if (afterLong.bodyY !== scrolledTo)
        throw new Error(`reading position lost: ${scrolledTo} became ${afterLong.bodyY}`);
    await replay(sampleData, root.author.name);

    // 2. Cancelling a load, and opening again straight after, never hands the screen over.
    await replay(`{probe: {tweet_results: {result: {
        rest_id: '900',
        core: {user_results: {result: {core: {name: 'Probe', screen_name: 'probe'}}}},
        legacy: {full_text: 'probe', conversation_id_str: '900', entities: {urls: [{
            url: 'https://t.co/probe', expanded_url: 'https://10.255.255.1/hangs',
            display_url: 'slow.example/hangs'}]}}}}}}`, 'Probe');
    adb('logcat', '-c');
    const owners = [];
    for (let round = 0; round < 3; round++) {
        await openLink();
        if (!(await state()).external) throw new Error('no waiting surface on round ' + round);
        owners.push(foreground());
        await key('back');
        await until(() => foreground() === 'reader', 'the reader after cancelling round ' + round, 10);
        owners.push(foreground());
    }
    await wait(8000);
    const settled = await state();
    record('cancel-and-repeat', {owners, settled, foreground: foreground(), stages: stages()});
    if (owners.some(o => o !== 'reader'))
        throw new Error('a cancelled or repeated load took the screen: ' + owners.join(','));
    if (settled.external || foreground() !== 'reader')
        throw new Error('a late callback took the screen after the user came back');

    // 3. Detail: same journey from the sample post's detail, with a comment selected.
    await replay(sampleData, root.author.name);
    await key('ok');
    await until(async () => (await state()).detail, 'the detail to render');
    await until(() => cdp.evaluate("document.querySelectorAll('.comment').length > 1"), 'comments to load', 40);
    const detailMarks = perf();
    await key('right');
    await key('down');
    const beforeDetail = await state();
    if (!beforeDetail.comment) throw new Error('no comment was selected, so restoring focus proves nothing');
    await openLink();
    await until(() => foreground() === 'gecko', 'the external page from the detail');
    await key('back');
    await until(() => foreground() === 'reader', 'the reader to come back from the detail');
    const afterDetail = await state();
    record('detail-return', {foreground: foreground(), before: beforeDetail, after: afterDetail,
        stages: stages()});
    if (!afterDetail.detail || afterDetail.comment !== beforeDetail.comment)
        throw new Error('the detail scene was not restored');
    await key('back');
    await until(async () => !(await state()).detail, 'the timeline to come back');

    // 4. Explicitly choosing X still hands over, and returning lands back on the reader.
    adb('logcat', '-c');
    await cdp.evaluate(`ReaderHost.browser(${JSON.stringify(root.path)}, 'menu')`);
    const handedOver = await until(() => foreground() === 'gecko' ? true : null,
        'the explicit X handoff to take the screen', 40);
    await until(() => presenting('https://x.com' + root.path), 'the X post page to finish presenting', 60);
    record('explicit-x-handoff', {handedOver, surfaces: surfaces(), stages: stages()});
    // The menu action opens an overlay on X, so backing out can take more than one press.
    let presses = 0;
    while (foreground() !== 'reader' && presses < 4) {
        await key('back');
        presses++;
        await wait(1500);
    }
    await until(() => foreground() === 'reader', 'the reader to come back from X', 20);
    const afterX = await state();
    record('explicit-x-return', {foreground: foreground(), presses, scene: afterX, stages: stages()});
    if (afterX.title !== cold.title)
        throw new Error('returning from X did not land on the reader');

    // 5. Login hands over to X on purpose, and backing out still lands on the reader.
    adb('logcat', '-c');
    await cdp.evaluate(`ReaderHost.browser('/home', 'login')`);
    await until(() => foreground() === 'gecko' ? true : null, 'the login handoff to take the screen', 40);
    // The remote only reaches the X adapter once the page it loaded is really presented.
    await until(() => presenting('https://x.com/home'), 'the login page to finish presenting', 60);
    record('login-handoff', {surfaces: surfaces(), stages: stages()});
    let loginPresses = 0;
    while (foreground() !== 'reader' && loginPresses < 4) {
        await key('back');
        loginPresses++;
        await wait(1500);
    }
    await until(() => foreground() === 'reader', 'the reader to come back from login', 20);
    const afterLogin = await state();
    record('login-return', {foreground: foreground(), presses: loginPresses, scene: afterLogin,
        stages: stages()});
    if (afterLogin.title !== cold.title) throw new Error('returning from login did not land on the reader');

    // 6. One Gecko session for the whole run, and the reading budget re-measured on this build.
    stages();
    record('reading-budget', {
        msToTimeline: evidence[0].msToTimeline,
        cache: evidence[0].cache,
        coldMarks: evidence[0].marks,
        detailMarks,
        geckoSessionsOpened: sessionOpens
    });
    if (sessionOpens > 1)
        throw new Error('more than one Gecko session was created: ' + sessionOpens);

    writeFileSync(OUT, JSON.stringify(evidence, null, 1) + '\n');
    console.log('\nPASS — evidence written to ' + OUT);
} catch (error) {
    writeFileSync(OUT, JSON.stringify(evidence.concat([{failure: String(error)}]), null, 1) + '\n');
    console.error('\nFAIL —', error.message);
    process.exitCode = 1;
} finally {
    cdp.close();
}
