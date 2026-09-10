/**
 * Projector acceptance for #13 using the installed reader and real remote key events.
 * The test replaces ReaderHost with a synthetic bridge before any action: no mutations
 * reach X. DOM timing and two animation frames are recorded, not optical display latency.
 * Usage: node scripts/check-like-feedback.mjs [--out file.json]
 * Install the debug APK first. The script restores the app by restarting it afterward.
 */
import {execFileSync} from 'node:child_process';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {connect} from './reader-cdp.mjs';

const args = process.argv.slice(2);
const option = name => args.includes(name) ? args[args.indexOf(name) + 1] : null;
const SERIAL = process.env.TVX_ADB_SERIAL || '192.168.10.100:5555';
const OUT = option('--out') || 'docs/validation/issue-13-samples.json';
const PORT = 9336;
const PACKAGE = 'cn.deeloo.tvxbrowser';
const APK = 'app/build/outputs/apk/debug/app-debug.apk';
const KEYS = {menu: 82, up: 19, down: 20, ok: 23, back: 4};
const adb = (...a) => execFileSync('adb', ['-s', SERIAL, ...a], {encoding: 'utf8', timeout: 40000});
const wait = ms => new Promise(ok => setTimeout(ok, ms));
const evidence = [];
let cdp, started = false;
function record(step, detail) {
    evidence.push({at: new Date().toISOString(), step, ...detail});
    console.log(step, JSON.stringify(detail));
}
async function until(check, label, seconds = 45) {
    const end = Date.now() + seconds * 1000;
    while (Date.now() < end) {
        const result = await check();
        if (result) return result;
        await wait(250);
    }
    throw new Error('timed out waiting for ' + label);
}
function start() {
    adb('shell', 'am', 'force-stop', PACKAGE);
    adb('shell', 'am', 'start', '-n', PACKAGE + '/.BrowserActivity');
}
function assert(value, message) { if (!value) throw new Error(message); }
const scene = `JSON.stringify({
    stats: (document.querySelector('.stats .like') || {}).textContent,
    position: document.getElementById('position').textContent,
    notice: document.getElementById('notice').textContent,
    writes: window.__likeProbe.writes,
    checks: window.__likeProbe.checks,
    presses: window.__likeProbe.presses
})`;
const state = () => cdp.evaluate(scene).then(JSON.parse);
const key = async name => {
    adb('shell', 'input', 'keyevent', String(KEYS[name]));
    await wait(100);
};
async function toggle(expected) {
    await key('menu');
    await key('down');
    await key('ok');
    const at = await state();
    const confirm = at.presses[at.presses.length - 1];
    assert(confirm.key === 'ok' && confirm.stats === expected, 'confirmation did not update immediately');
    assert(confirm.domMs <= 100, 'DOM feedback exceeded 100 ms');
    await until(async () => {
        const last = (await state()).presses.slice(-1)[0];
        return last.frameMs != null;
    }, 'frame opportunity after confirmation');
    record('immediate-feedback', {confirm: (await state()).presses.slice(-1)[0]});
}
try {
    const sha256 = createHash('sha256').update(readFileSync(APK)).digest('hex');
    const installedPath = adb('shell', 'pm', 'path', PACKAGE).trim().split('\n')[0].replace('package:', '');
    const installedSha256 = adb('shell', 'sha256sum', installedPath).trim().split(/\s+/)[0];
    assert(sha256 === installedSha256, 'installed APK differs from the local build');
    record('installed-build', {sha256, installedSha256, serial: SERIAL,
        package: adb('shell', 'dumpsys', 'package', PACKAGE).split('\n')
            .filter(line => /versionCode=|versionName=|lastUpdateTime=/.test(line)).map(line => line.trim())});
    start();
    started = true;
    await until(async () => {
        try {
            const pid = adb('shell', 'pidof', PACKAGE).trim().split(/\s+/)[0];
            if (!pid) return false;
            adb('forward', `tcp:${PORT}`, `localabstract:webview_devtools_remote_${pid}`);
            cdp = await connect(PORT);
            return true;
        } catch (_) { return false; }
    }, 'reader debugger');
    await until(() => cdp.evaluate("typeof TvXReader === 'object' && document.querySelector('.post') && document.getElementById('freshness').textContent === '刚刚更新'"), 'fresh reader');
    await cdp.evaluate(`(function() {
        var probe = window.__likeProbe = {writes: [], checks: [], presses: []};
        var bridge = {
            write: function(id, postId, action, desired) {
                probe.writes.push({id: id, postId: postId, action: action, desired: desired});
            },
            verify: function(id, postId) { probe.checks.push({id: id, postId: postId}); },
            rendered: function() {}, request: function() {}, exit: function() {},
            browser: function() {}, openExternal: function() {}, cancelExternal: function() {}
        };
        window.ReaderHost = bridge;
        if (ReaderHost !== bridge) throw new Error('synthetic bridge unavailable');
        probe.payload = function(liked, likes) {
            function post(id, liked, likes) { return {tweet_results: {result: {
                rest_id: id,
                core: {user_results: {result: {core: {name: 'Synthetic probe', screen_name: 'probe'}}}},
                legacy: {full_text: 'Offline like feedback probe', conversation_id_str: id,
                    favorite_count: likes, favorited: liked, reply_count: 0}
            }}}; }
            return {data: {a: post('101', liked, likes), b: post('102', false, 3)}};
        };
        TvXReader.receive('r0', probe.payload(false, 3), '');
        var realKey = TvXReader.key;
        TvXReader.key = function(key) {
            var began = performance.now();
            realKey(key);
            var sample = {key: key, domMs: performance.now() - began,
                stats: document.querySelector('.stats .like').textContent.trim()};
            probe.presses.push(sample);
            requestAnimationFrame(function() { requestAnimationFrame(function() {
                sample.frameMs = performance.now() - began;
            }); });
        };
    })();`);
    await toggle('已喜欢 4');
    assert((await state()).writes.length === 1, 'synthetic bridge did not capture the write');
    mkdirSync('.scratch/issue-13', {recursive: true});
    const capture = execFileSync('adb', ['-s', SERIAL, 'exec-out', 'screencap', '-p']);
    // This projector prefixes screencap with a vendor initialization message.
    const pngStart = capture.indexOf(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    assert(pngStart >= 0, 'screencap did not return a PNG');
    writeFileSync('.scratch/issue-13/liked.png', capture.subarray(pngStart));
    await key('down');
    const moved = await state();
    assert(moved.position === '2 / 2' && moved.stats.trim() === '喜欢 3', 'pending write blocked navigation');
    record('navigation-pending', {scene: moved, callbackDelivered: false});
    await cdp.evaluate("TvXReader.writeResult('w1', '101', {status:'rate_limit'})");
    assert((await state()).notice === '', 'background failure interrupted another post');
    await key('up');
    assert((await state()).stats.trim() === '喜欢 3', 'rejection did not restore confirmed state');
    record('rejection', {scene: await state()});

    await toggle('已喜欢 4');
    await cdp.evaluate("TvXReader.writeResult('w2', '101', {status:'ok',liked:true,likes:4})");
    await toggle('喜欢 3');
    await cdp.evaluate("TvXReader.writeResult('w3', '101', {status:'unknown'})");
    const unknown = await state();
    assert(unknown.checks.length === 1 && unknown.notice.includes('核对'), 'unknown did not request verification');
    await cdp.evaluate("TvXReader.verifyResult('v1','101',__likeProbe.payload(false,3),'')");
    const settled = await state();
    assert(settled.writes.length === 3 && settled.stats.trim() === '喜欢 3', 'verification replayed or lost state');
    record('readonly-convergence', {scene: settled});
    writeFileSync(OUT, JSON.stringify(evidence, null, 2) + '\n');
    console.log('PASS — ' + OUT);
} catch (error) {
    writeFileSync(OUT, JSON.stringify(evidence.concat([{failure: String(error)}]), null, 2) + '\n');
    console.error(error);
    process.exitCode = 1;
} finally {
    if (cdp) cdp.close();
    if (started) {
        adb('forward', '--remove', `tcp:${PORT}`);
        start();
    }
}
