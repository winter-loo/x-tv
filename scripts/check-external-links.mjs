/**
 * Real-device acceptance for issue #20: opening external link cards and body links
 * from the local reader. Read-only against X: it fetches one post, replays it into
 * the reader and drives the remote. No likes, replies or account changes.
 *
 * Usage: node scripts/check-external-links.mjs [--post <id>] [--out <file.json>]
 * The debug APK must already be installed, launched and signed in.
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
const POST = option('--post') || '2097620728610963675';
const OUT = option('--out') || 'docs/validation/issue-20-samples.json';
const PORT = 9333;
const KEYS = {menu: 82, up: 19, down: 20, left: 21, right: 22, ok: 23, back: 4};

const adb = (...a) => execFileSync('adb', ['-s', SERIAL, ...a], {encoding: 'utf8', timeout: 30000});
const wait = ms => new Promise(ok => setTimeout(ok, ms));
const evidence = [];
function record(step, detail) {
    const entry = {at: new Date().toISOString(), step, ...detail};
    evidence.push(entry);
    console.log(step, JSON.stringify(detail));
}

/** Restarts the installed build so every run starts from the same cold reader. */
async function launch() {
    adb('shell', 'am', 'force-stop', 'cn.deeloo.tvxbrowser');
    adb('logcat', '-c');
    adb('shell', 'am', 'start', '-n', 'cn.deeloo.tvxbrowser/.BrowserActivity');
    for (let i = 0; i < 40; i++) {
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
async function key(cdp, name) {
    adb('shell', 'input', 'keyevent', String(KEYS[name]));
    await wait(400);
}
const readerState = `JSON.stringify({
    posts: document.querySelectorAll('.post').length,
    dialog: !!document.querySelector('.action-dialog'),
    options: Array.from(document.querySelectorAll('.action-options button')).map(b => ({
        external: b.classList.contains('external'),
        selected: b.classList.contains('selected'),
        label: (b.querySelector('.label') || b).textContent.trim(),
        domain: (b.querySelector('.domain') || {textContent: ''}).textContent
    })),
    external: document.querySelector('.external-status') ? {
        domain: document.querySelector('.external-status .domain').textContent.trim(),
        title: document.querySelector('.external-status .title').textContent,
        hint: document.querySelector('.external-status p').textContent
    } : null
})`;
const state = cdp => cdp.evaluate(readerState).then(JSON.parse);
/**
 * Fingerprint of what is actually on the projector, so scrolling can be observed.
 * Captured to a file first: this projector's `exec-out` stdout can carry vendor logging.
 */
function screen() {
    adb('shell', 'screencap', '-p', '/sdcard/tvx-external-check.png');
    return adb('shell', 'md5sum', '/sdcard/tvx-external-check.png').trim().split(/\s+/)[0];
}
/** The reader view is gone exactly while an external page owns the screen. */
function readerVisible() {
    const dump = adb('shell', 'dumpsys', 'activity', 'top');
    return /FastReader\{[^}]*\sV\./.test(dump);
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
/** The reader may only step aside for a paint of the page this open actually started. */
let started = false;
function assertRevealedOwnPage(lines) {
    lines.forEach(line => {
        if (line.startsWith('open ') || line.startsWith('closed ')) started = false;
        else if (line.startsWith('loading ')) started = true;
        else if (line.startsWith('shown ') && !started)
            throw new Error('reader stepped aside before its target began loading: ' + line);
    });
    return lines;
}
/** Everything the native side did since the last checkpoint: target URLs and stage transitions. */
function stages() {
    const lines = adb('logcat', '-d', '-s', 'BrowserActivity')
        .split('\n')
        .filter(line => /handoff (open|loading|shown|failed|closed)/.test(line))
        .map(line => line.replace(/^.*BrowserActivity: ===> handoff /, '').trim());
    adb('logcat', '-c');
    return lines;
}

/** Replays a post carrying one external link, then confirms it from the remote menu. */
async function openLink(cdp, url, display) {
    await cdp.evaluate(`TvXReader.receive('r0', {data: {probe: {tweet_results: {result: {
        rest_id: '900',
        core: {user_results: {result: {core: {name: 'Probe', screen_name: 'probe'}}}},
        legacy: {full_text: 'probe', conversation_id_str: '900', entities: {urls: [{
            url: ${JSON.stringify(url)},
            expanded_url: ${JSON.stringify(url)},
            display_url: ${JSON.stringify(display)}}]}}}}}}}, '')`);
    await until(async () => (await state(cdp)).posts === 1, 'the probe post to render');
    await key(cdp, 'menu');
    const menu = await state(cdp);
    const at = menu.options.findIndex(o => o.external);
    if (at < 0) throw new Error('probe post offered no external target for ' + url);
    for (let i = 0; i < at; i++) await key(cdp, 'down');
    await key(cdp, 'ok');
    return menu.options[at];
}

const pid = await launch();
const cdp = await connect(PORT);
try {
    await until(() => cdp.evaluate("typeof TvXReader === 'object' && document.querySelectorAll('.post').length > 0")
                         .catch(() => false),
        'the reader to render its timeline');
    // Wait for the live timeline to land: a cached one is still expecting an update that
    // would replace the replayed sample underneath the probe.
    await until(() => cdp.evaluate("document.getElementById('freshness').textContent === '刚刚更新'"),
        'the live timeline to settle', 60);
    record('attached', {pid, url: cdp.url});

    // 1. Real extraction: fetch the sample post through the app's own authenticated client.
    await cdp.evaluate(`window.__probe = {};
        (function(){ var real = TvXReader.receive;
          TvXReader.receive = function(id, payload, error) {
            window.__probe[id] = {payload: payload, error: error};
            return real.apply(null, arguments);
          }; })();
        ReaderHost.request('r99', 'detail', ${JSON.stringify(POST)}, '');`);
    const fetched = await until(
        () => cdp.evaluate('JSON.stringify(window.__probe.r99 ? {error: window.__probe.r99.error, ok: !!window.__probe.r99.payload} : null)')
                 .then(v => JSON.parse(v)),
        'the sample post to arrive');
    if (!fetched.ok) throw new Error('sample post fetch failed: ' + fetched.error);
    const parsed = JSON.parse(await cdp.evaluate(
        `JSON.stringify(TvXReadData.parse(window.__probe.r99.payload, 'detail', ${JSON.stringify(POST)}).root)`));
    const raw = JSON.parse(await cdp.evaluate(`(function(){
        var found = [];
        (function walk(v) {
            if (!v || typeof v !== 'object') return;
            if (v.rest_id === ${JSON.stringify(POST)} && v.legacy)
                found = ((v.legacy.entities || {}).urls || []).map(function(u) {
                    return {tco: u.url, expanded: u.expanded_url, display: u.display_url};
                });
            Object.keys(v).forEach(function(k) { walk(v[k]); });
        })(window.__probe.r99.payload.data);
        return JSON.stringify(found);
    })()`));
    record('extracted', {post: POST, complete: parsed.complete, entities: raw, links: parsed.links});
    if (!parsed.links.length) throw new Error('sample post exposed no external link');
    adb('logcat', '-c');

    // 2. Replay it as the timeline so the remote journey runs against the real post.
    await cdp.evaluate(`TvXReader.receive('r0', {data: {t: {tweet_results: {result: null}}, probe: window.__probe.r99.payload.data}}, '')`);
    await until(async () => (await state(cdp)).posts === 1, 'the sample post to render');

    // 3. The card in the post names the target, and a tap on it opens the same URL.
    const card = JSON.parse(await cdp.evaluate(`(function(){
        var node = document.querySelector('.post .link-card');
        if (!node) return 'null';
        var box = node.getBoundingClientRect(), ratio = window.devicePixelRatio || 1;
        return JSON.stringify({
            label: node.querySelector('.label').textContent,
            domain: node.querySelector('.domain').textContent,
            x: Math.round((box.left + box.width / 2) * ratio),
            y: Math.round((box.top + box.height / 2) * ratio)
        });
    })()`));
    if (!card) throw new Error('the post rendered no external link card');
    adb('shell', 'input', 'tap', String(card.x), String(card.y));
    await wait(600);
    const tapped = await state(cdp);
    record('card-tapped', {card, external: tapped.external, stages: assertRevealedOwnPage(stages())});
    if (!tapped.external) throw new Error('tapping the card did not open its target');
    await key(cdp, 'back');
    await until(() => readerVisible(), 'the reader after cancelling the tapped card');
    stages();

    // 4. Menu lists the external target by title and domain.
    await key(cdp, 'menu');
    const menu = await state(cdp);
    record('menu', {options: menu.options});
    const index = menu.options.findIndex(o => o.external);
    if (index < 0) throw new Error('menu offered no external target');
    for (let i = 0; i < index; i++) await key(cdp, 'down');

    // 5. Confirm: immediate feedback, then the external page takes the screen.
    const before = Date.now();
    await key(cdp, 'ok');
    const opening = await state(cdp);
    record('opening', {msFromKeypress: Date.now() - before, external: opening.external, dialog: opening.dialog});
    if (!opening.external) throw new Error('no loading feedback after confirm');
    await until(() => !readerVisible(), 'the external page to take the screen');
    record('readable', {stages: assertRevealedOwnPage(stages())});

    // 6. The remote scrolls the external page, then back returns to the originating post.
    const top = screen();
    await key(cdp, 'down');
    await key(cdp, 'down');
    await key(cdp, 'down');
    await wait(1200);
    const scrolled = screen();
    record('scrolled', {changed: scrolled !== top, top, after: scrolled});
    if (scrolled === top) throw new Error('the remote did not scroll the external page');
    await key(cdp, 'back');
    await until(() => readerVisible(), 'the reader to come back');
    const returned = await until(async () => {
        const s = await state(cdp);
        return s.external === null && s.posts === 1 ? s : null;
    }, 'the reader to show the originating post again');
    record('returned', {posts: returned.posts, external: returned.external, stages: assertRevealedOwnPage(stages())});

    // 7. Back cancels a target that is still loading, and no late callback overrides the reader.
    await openLink(cdp, 'https://10.255.255.1/hangs', 'slow.example');
    if (!(await state(cdp)).external) throw new Error('no loading feedback for the slow target');
    if (!readerVisible()) throw new Error('the slow target took the screen before it was readable');
    await key(cdp, 'back');
    const cancelled = await state(cdp);
    record('cancelled', {external: cancelled.external, posts: cancelled.posts, readerVisible: readerVisible(),
        stages: assertRevealedOwnPage(stages())});
    if (cancelled.external || !readerVisible()) throw new Error('cancel did not restore the reader');
    await wait(8000);
    const settled = await state(cdp);
    record('after-late-callbacks', {external: settled.external, posts: settled.posts, stages: assertRevealedOwnPage(stages())});
    if (settled.external) throw new Error('a late page callback overwrote the restored reader');

    // 8. The same target reached through its real t.co wrapper still lands on the publisher.
    const tco = raw.map(u => u.tco).filter(u => /^https:\/\/t\.co\//.test(u))[0];
    if (!tco) throw new Error('sample post carried no t.co wrapper to redirect through');
    const short = await openLink(cdp, tco, parsed.links[0].domain);
    await until(() => !readerVisible(), 'the shortened target to take the screen', 40);
    record('redirected', {from: tco, menu: short, stages: assertRevealedOwnPage(stages())});
    await key(cdp, 'back');
    await until(() => readerVisible(), 'the reader to come back from the shortened target');
    stages();

    // 9. A target that cannot load explains itself and offers a retry.
    await openLink(cdp, 'https://unreachable.invalid/page', 'unreachable.invalid/page');
    const failed = await until(async () => {
        const s = await state(cdp);
        return s.external && s.external.hint.includes('未能打开') ? s : null;
    }, 'the failure to be reported');
    record('failed', {external: failed.external, readerVisible: readerVisible(), stages: assertRevealedOwnPage(stages())});
    await key(cdp, 'ok');
    const retried = await state(cdp);
    record('retried', {external: retried.external});
    if (!retried.external || retried.external.hint.includes('未能打开'))
        throw new Error('confirm did not retry the failed target');
    await key(cdp, 'back');
    record('done', {external: (await state(cdp)).external, readerVisible: readerVisible()});
    writeFileSync(OUT, JSON.stringify(evidence, null, 1) + '\n');
    console.log('\nPASS — evidence written to ' + OUT);
} catch (error) {
    writeFileSync(OUT, JSON.stringify(evidence.concat([{failure: String(error)}]), null, 1) + '\n');
    console.error('\nFAIL —', error.message);
    process.exitCode = 1;
} finally {
    adb('shell', 'rm', '-f', '/sdcard/tvx-external-check.png');
    cdp.close();
}
