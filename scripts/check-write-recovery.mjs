/** Read-only #13 regression: real native metadata preparation after an external return.
 * Requires the installed debug APK and a signed-in reader. Never submits a mutation.
 * The debug intent runs the same WritePreparation used by XWriteClient, logging only readiness.
 */
import {execFileSync} from 'node:child_process';
import {readFileSync, writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {connect} from './reader-cdp.mjs';
const SERIAL=process.env.TVX_ADB_SERIAL || '192.168.10.100:5555';
const PORT=9337, PACKAGE='cn.deeloo.tvxbrowser';
const OUT='docs/validation/issue-13-write-recovery-samples.json';
const adb=(...args)=>execFileSync('adb',['-s',SERIAL,...args],{encoding:'utf8',timeout:30000});
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const evidence=[];
const record=(step,data)=>{const row={at:new Date().toISOString(),step,...data};evidence.push(row);console.log(JSON.stringify(row));};
const assert=(value,message)=>{if(!value)throw Error(message);};
let cdp, forwarded=false;
async function until(check,label,ms=30000) {
    const end=Date.now()+ms;
    while(Date.now()<end){const result=await check();if(result)return result;await wait(300);}
    throw Error('timed out: '+label);
}
function surfaces() {
    const dump=adb('shell','dumpsys','activity','top');
    const reader=dump.match(/FastReader\{[0-9a-f]+ ([VIG])/);
    const overlay=dump.match(/\{[0-9a-f]+ ([VIG])[^}]*app:id\/loading_overlay\}/);
    return {reader:reader?.[1] || 'absent',loading:overlay?.[1] || 'absent'};
}
function readyLines() {
    return adb('logcat','-d','-v','brief','-s','TvXWriteReady:I','*:S').split('\n').filter(line=>/ready=(true|false)/.test(line));
}
function probe() {
    const count=readyLines().length;
    adb('shell','am','start','-n',PACKAGE+'/.BrowserActivity','--es','action','check_write_preparation');
    return count;
}
async function ready(count,label) {
    const line=await until(()=>{
        const surface=surfaces();
        assert(surface.reader==='V' && surface.loading!=='V','background preparation obscured the reader: '+JSON.stringify(surface));
        return readyLines()[count];
    },label);
    assert(line.includes('ready=true'),label+' failed: '+line);
    record(label,{result:line.replace(/^.*ready=/,'ready='),surface:surfaces()});
}
const scene=()=>cdp.evaluate(`JSON.stringify({title:document.getElementById('title').textContent,
    position:document.getElementById('position').textContent,
    stats:document.querySelector('.stats').textContent,
    scroll:document.querySelector('.body').scrollTop})`);
try {
    const sha256=createHash('sha256').update(readFileSync('app/build/outputs/apk/debug/app-debug.apk')).digest('hex');
    const path=adb('shell','pm','path',PACKAGE).trim().split('\n')[0].replace('package:','');
    assert(adb('shell','sha256sum',path).trim().split(/\s+/)[0]===sha256,'installed APK mismatch');
    record('build',{sha256,package:adb('shell','dumpsys','package',PACKAGE).split('\n')
        .filter(line=>/lastUpdateTime=|versionName=/.test(line)).map(line=>line.trim())});
    adb('shell','am','start','-n',PACKAGE+'/.BrowserActivity');
    await until(async()=>{
        try {
            const pid=adb('shell','pidof',PACKAGE).trim().split(/\s+/)[0];
            adb('forward',`tcp:${PORT}`,`localabstract:webview_devtools_remote_${pid}`);
            forwarded=true;
            const targets=await(await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
            return targets.some(t=>t.url.endsWith('/reader/index.html'));
        } catch {return false;}
    },'reader debugger');
    cdp=await connect(PORT);
    await until(()=>cdp.evaluate("!!document.querySelector('.stats')"),'reader content');
    await until(()=>{const s=surfaces();return s.reader==='V' && s.loading!=='V';},'initial reader foreground');
    await ready(probe(),'initial-real-metadata');
    // Opening the menu records that the user is reading, so a new home response is retained.
    await cdp.evaluate("TvXReader.key('menu');TvXReader.key('back')");
    const before=await scene();
    await cdp.evaluate("ReaderHost.openExternal('https://example.org/')");
    await until(()=>surfaces().reader==='G','external handoff');
    const count=probe();
    await wait(1000);
    assert(readyLines().length===count,'preparation should wait while external owns the session');
    assert(surfaces().reader==='G','preparation took over the external page');
    record('external-preserved',{surface:surfaces(),preparationPending:true});
    await cdp.evaluate('ReaderHost.cancelExternal()');
    await until(()=>surfaces().reader==='V','reader return');
    await ready(count,'metadata-after-external-return');
    assert(await scene()===before,'reader scene changed during background recovery');
    await ready(probe(),'subsequent-real-metadata');
    record('pass',{scenePreserved:true,mutationsSubmitted:0});
} catch(error) {
    record('failure',{message:String(error)});process.exitCode=1;
} finally {
    writeFileSync(OUT,JSON.stringify(evidence,null,2)+'\n');
    if(cdp)cdp.close();
    if(forwarded)adb('forward','--remove',`tcp:${PORT}`);
}
