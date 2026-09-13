// Real Android input from the native signed-out entry. Never enters credentials.
// --keep-open leaves the Google window ready for the user's account confirmation.
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';

const device = process.env.TVX_ADB_SERIAL || '192.168.10.100:5555';
const adb = (...args) => execFileSync('adb', ['-s', device, ...args], { encoding: 'utf8', timeout:20000 });
const remote='/sdcard/tvx-google-check.xml';
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function state(){
    adb('shell','uiautomator','dump',remote);
    const xml=adb('exec-out','cat',remote);
    if(xml.includes('请在 Google 账号确认框中继续'))return 'google-inline';
    const owner=xml.match(/content-desc="(tvx-auth-[a-z]+)"/)?.[1]||'';
    if(owner==='tvx-auth-popup' && !xml.includes('完成 Google 账号确认后'))return 'tvx-auth-popup-loading';
    return owner;
}
async function until(wanted){
    wanted=Array.isArray(wanted)?wanted:[wanted];
    const end=Date.now()+60000;
    while(Date.now()<end){const current=state();if(wanted.includes(current))return current;await delay(500);}
    assert.fail('Native authentication owner did not become '+wanted);
}
try {
    assert.equal(state(),'tvx-auth-entry','Start from the native login entry with Google focused');
    adb('shell','input','keyevent','23');
    const google=await until(['tvx-auth-popup','google-inline']);
    console.log('PASS: native Google button reached real account confirmation ('+google+')');
    if(!process.argv.includes('--keep-open')){
        if(google==='tvx-auth-popup'){
            adb('shell','input','keyevent','4');await until(['tvx-auth-web','google-inline']);
        }
        adb('shell','input','keyevent','4');await until('tvx-auth-entry');
        console.log('PASS: Back cancels to native entry');
    }
    console.log('Account authentication remains a separate acceptance step.');
} finally {
    adb('shell','rm','-f',remote);
}
