// Run with X's login page already loaded on the projector. Does not enter credentials.
import { spawn, execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';

const device = process.env.TVX_ADB_SERIAL || '192.168.10.100:5555';
const adb = (...args) => execFileSync('adb', ['-s', device, ...args], { encoding: 'utf8' });
const pid = adb('shell', 'pidof', 'cn.deeloo.tvxbrowser').trim();
assert.match(pid, /^\d+$/, 'TV X must be running');
let logs = '';
const reader = spawn('adb', ['-s', device, 'logcat', '--pid=' + pid, '-T', '1']);
reader.stdout.on('data', chunk => { logs += chunk; });
try {
    await new Promise(resolve => setTimeout(resolve, 500));
    adb('shell', 'am', 'start', '-n', 'cn.deeloo.tvxbrowser/.BrowserActivity', '--es', 'action', 'google_auth');
    await new Promise(resolve => setTimeout(resolve, 12000));
    // Never print raw OAuth URLs or diagnostic page content.
    assert.ok(logs.includes('onNewSession requested'), 'FAIL: Google did not request an authorization popup');
    assert.ok(!/Must use an unopened|FATAL EXCEPTION|AssertionError/.test(logs), 'FAIL: browser rejected/crashed opening the popup');
    assert.ok(logs.includes('OAuth popup loaded: true'), 'FAIL: popup did not finish loading');
    console.log('PASS: Google authorization popup opened and loaded without a session error. Account login remains a separate acceptance step.');
} finally {
    reader.kill();
}
