/**
 * Real-device acceptance for issue #16: publication times and complete, honest counts on the
 * timeline post, the detail post and every comment. Read-only: it navigates and reads.
 *
 * Usage: node scripts/check-time-stats.mjs [--out <file.json>] [--shots <dir>]
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
const OUT = option('--out') || 'docs/validation/issue-16-samples.json';
const SHOTS = option('--shots');
const PORT = 9339;
const KEYS = {menu: 82, up: 19, down: 20, ok: 23, back: 4};
const NONSENSE = /NaN|Invalid|undefined|null/;

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
    adb('shell', 'screencap', '-p', '/sdcard/tvx-time.png');
    adb('pull', '/sdcard/tvx-time.png', `${SHOTS}/${name}.png`);
    adb('shell', 'rm', '-f', '/sdcard/tvx-time.png');
}

const pid = await launch();
const cdp = await connect(PORT);
const key = async name => {
    adb('shell', 'input', 'keyevent', String(KEYS[name]));
    await wait(500);
};
const read = expression => cdp.evaluate(expression).then(JSON.parse);
const TEXT = `function(sel){var n=document.querySelector(sel);return n?n.textContent.replace(/\\s+/g,' ').trim():null;}`;
/** Font and icon sizes, so "readable on the projector" is a measurement, not an impression. */
const SIZES = `function(sel){var n=document.querySelector(sel);if(!n)return null;
    var s=getComputedStyle(n),icon=n.querySelector('svg');
    var box=icon?icon.getBoundingClientRect():null;
    return {fontPx: Math.round(parseFloat(s.fontSize)*10)/10,
        iconPx: box?Math.round(box.width*10)/10:null};}`;

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

    // Walk the timeline until a post with replies turns up, so the detail really has comments.
    let found = null;
    for (let step = 0; step < 12 && !found; step++) {
        const at = await read(`(function(){var t=${TEXT};
            var stats=t('.post .stats')||'';
            var replies=(stats.match(/评论 (\\d+)/)||[])[1];
            return JSON.stringify({time:t('.post .time'),stats:stats,
                position:document.getElementById('position').textContent,replies:replies?Number(replies):null});})()`);
        if (step === 0) {
            shot('01-timeline');
            record('timeline-post', at);
            if (!at.time) throw new Error('the timeline post shows no publication time');
            if (NONSENSE.test(at.time)) throw new Error('the timeline time is nonsense: ' + at.time);
            if (NONSENSE.test(at.stats)) throw new Error('the timeline counts are nonsense: ' + at.stats);
        }
        if (at.replies) found = at;
        else await key('down');
    }
    if (!found) throw new Error('no post with replies was reachable in the first dozen entries');
    record('post-with-replies', found);

    await key('ok');
    for (let i = 0; i < 80; i++) {
        if (await cdp.evaluate("document.querySelectorAll('.comment').length > 0")) break;
        await wait(500);
    }
    await wait(1500);
    const detail = await read(`(function(){var t=${TEXT}, sizes=${SIZES};
        var comments=Array.prototype.slice.call(document.querySelectorAll('.comment'));
        return JSON.stringify({
            detailTime: t('.detail-post .time'),
            detailStats: t('.detail-post .stats'),
            detailSizes: sizes('.detail-post .stats'),
            timeSizes: sizes('.detail-post .time'),
            commentSizes: sizes('.comment .stats'),
            comments: comments.length,
            withTime: comments.filter(function(c){return !!c.querySelector('.time');}).length,
            numbersWithoutIcon: comments.reduce(function(total, c){
                var stats = Array.prototype.slice.call(c.querySelectorAll('.stats .stat'));
                return total + stats.filter(function(s){ return !s.querySelector('svg'); }).length;
            }, 0),
            sample: comments.slice(0, 3).map(function(c){
                return {time: (c.querySelector('.time')||{}).textContent || null,
                    stats: (c.querySelector('.stats')||{}).textContent.replace(/\\s+/g,' ').trim()};
            })
        });})()`);
    shot('02-detail');
    record('detail', detail);
    if (!detail.detailTime) throw new Error('the detail post shows no publication time');
    if (!/\d{4} 年/.test(detail.detailTime))
        throw new Error('the detail time has no year: ' + detail.detailTime);
    if (!/\d{1,2}:\d{2}/.test(detail.detailTime))
        throw new Error('the detail time has no clock time: ' + detail.detailTime);
    if (NONSENSE.test(detail.detailTime + ' ' + detail.detailStats))
        throw new Error('the detail time or counts are nonsense');
    if (detail.comments === 0) throw new Error('no comments loaded, so nothing could be checked');
    if (detail.withTime !== detail.comments)
        throw new Error(`${detail.comments - detail.withTime} of ${detail.comments} comments show no time`);
    if (detail.numbersWithoutIcon)
        throw new Error(detail.numbersWithoutIcon + ' comment counts have no icon');
    detail.sample.forEach(s => {
        if (NONSENSE.test(s.time + ' ' + s.stats))
            throw new Error('a comment shows nonsense: ' + JSON.stringify(s));
    });

    writeFileSync(OUT, JSON.stringify(evidence, null, 1) + '\n');
    console.log('\nPASS — evidence written to ' + OUT);
} catch (error) {
    writeFileSync(OUT, JSON.stringify(evidence.concat([{failure: String(error)}]), null, 1) + '\n');
    console.error('\nFAIL —', error.message);
    process.exitCode = 1;
} finally {
    cdp.close();
}
