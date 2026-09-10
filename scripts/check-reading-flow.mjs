/**
 * Real-device acceptance for issues #19 and #23: a cut-off preview says so, and reading a long
 * body turns by a page that keeps three lines. Read-only: it navigates and measures.
 *
 * Usage: node scripts/check-reading-flow.mjs [--out <file.json>] [--shots <dir>]
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
const OUT = option('--out') || 'docs/validation/issue-19-23-samples.json';
const SHOTS = option('--shots');
const PORT = 9341;
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
    adb('shell', 'screencap', '-p', '/sdcard/tvx-read.png');
    adb('pull', '/sdcard/tvx-read.png', `${SHOTS}/${name}.png`);
    adb('shell', 'rm', '-f', '/sdcard/tvx-read.png');
}

const pid = await launch();
const cdp = await connect(PORT);
const key = async name => {
    adb('shell', 'input', 'keyevent', String(KEYS[name]));
    await wait(500);
};
const BODY = `(function(){var n=document.querySelector('.body');
    if(!n)return JSON.stringify(null);
    var s=getComputedStyle(n);
    return JSON.stringify({top:Math.round(n.scrollTop*10)/10,view:n.clientHeight,full:n.scrollHeight,
        line:Math.round(parseFloat(s.lineHeight)*10)/10,
        marker:!!document.querySelector('.show-more'),
        fetching:!!document.querySelector('.fetching')});})()`;
const body = () => cdp.evaluate(BODY).then(JSON.parse);
/** Waits for the reader's own animation to come to rest. */
async function settle() {
    let last = -1;
    for (let i = 0; i < 40; i++) {
        const at = (await body()).top;
        if (at === last) return at;
        last = at;
        await wait(80);
    }
    return last;
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

    // Walk the timeline for a post whose preview is really cut off.
    let cut = null;
    for (let step = 0; step < 15 && !cut; step++) {
        const at = await body();
        if (at && at.marker && at.full - at.view > at.line) cut = {...at, step};
        else await key('down');
    }
    if (!cut) throw new Error('no post with a cut-off preview was reachable');
    shot('01-preview-cut');
    record('preview-cut-off', cut);

    // A preview that fits must not carry the marker.
    const whole = await cdp.evaluate(`(function(){
        var n=document.querySelector('.body');
        return JSON.stringify({clipped:n.scrollHeight-n.clientHeight>1,
            marker:!!document.querySelector('.show-more')});})()`).then(JSON.parse);
    if (whole.clipped !== whole.marker)
        throw new Error('the marker does not match whether the preview is actually cut off');

    // Confirm opens the full reading, and the body pages by a measured step.
    await key('ok');
    for (let i = 0; i < 80; i++) {
        if (await cdp.evaluate("!!document.querySelector('.detail-post')")) break;
        await wait(500);
    }
    await wait(2000);
    const opened = await body();
    shot('02-full-reading');
    record('full-reading', {...opened,
        long: opened.full - opened.view > opened.line * 3});
    if (opened.marker) throw new Error('the full reading still shows a cut-off marker');
    if (opened.full - opened.view <= opened.line)
        throw new Error('the full text is no longer than the pane, so paging proves nothing');

    await key('down');
    const afterOne = await settle();
    const overlap = opened.view - afterOne;
    record('page-down', {from: opened.top, to: afterOne, view: opened.view, line: opened.line,
        overlapPx: Math.round(overlap * 10) / 10,
        overlapLines: Math.round((overlap / opened.line) * 100) / 100});
    if (overlap <= 0) throw new Error('the page turn left no overlap');
    if (overlap / opened.line < 2.5 || overlap / opened.line > 4)
        throw new Error(`the overlap is ${overlap / opened.line} lines, not about three`);

    await key('up');
    const back = await settle();
    record('page-up', {to: back});
    if (back !== 0) throw new Error('paging back did not return to the start, got ' + back);

    // Three presses in a row must chain, not pile up.
    for (let i = 0; i < 3; i++) {
        adb('shell', 'input', 'keyevent', String(KEYS.down));
        await wait(120);
    }
    const chained = await settle();
    const step = opened.view - overlap;
    // Three presses travel three steps, or as far as the article goes — whichever comes first.
    const reach = opened.full - opened.view;
    const expected = Math.min(step * 3, reach);
    record('chained-presses', {to: chained, oneStep: Math.round(step * 10) / 10,
        reachable: Math.round(reach * 10) / 10, expected: Math.round(expected * 10) / 10,
        stepsTravelled: Math.round((chained / step) * 100) / 100});
    if (Math.abs(chained - expected) > 3)
        throw new Error(`three presses reached ${chained}, expected ${expected}`);

    // The bottom clamps rather than overshooting.
    for (let i = 0; i < 30; i++) await key('down');
    await settle();
    const bottom = await body();
    record('bottom', bottom);
    if (bottom.top > bottom.full - bottom.view + 1)
        throw new Error('reading scrolled past the bottom');

    writeFileSync(OUT, JSON.stringify(evidence, null, 1) + '\n');
    console.log('\nPASS — evidence written to ' + OUT);
} catch (error) {
    writeFileSync(OUT, JSON.stringify(evidence.concat([{failure: String(error)}]), null, 1) + '\n');
    console.error('\nFAIL —', error.message);
    process.exitCode = 1;
} finally {
    cdp.close();
}
