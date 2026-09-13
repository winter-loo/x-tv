#!/usr/bin/env python3
"""Verify physical Android keys reach the dedicated X authentication document.

Run on an open, signed-out X form. Focuses an existing empty username control,
but never types, submits, reads values or changes the account. Cleans up its probe.
"""
import importlib.util
import json
import time

spec=importlib.util.spec_from_file_location('projector_probe',__file__.replace('check-auth-web-input.py','check-projector-ux.py'))
probe=importlib.util.module_from_spec(spec);spec.loader.exec_module(probe)
probe.DEBUGGER_PORT=int(probe.adb('forward','tcp:0','localabstract:cn.deeloo.tvxbrowser/firefox-debugger-socket').strip())
try:
    ready=probe.evaluate('''JSON.stringify((()=>{
        if(!sessionStorage.getItem('tvx-auth-attempt'))return false;
        const input=Array.from(document.querySelectorAll('input')).find(n=>
            n.type!=='password' && n.type!=='hidden' && !n.value && n.getBoundingClientRect().width>0);
        if(!input)return false;
        window.__tvxAuthKeyProbe=[];
        window.__tvxAuthKeyListener=e=>window.__tvxAuthKeyProbe.push({key:e.key,trusted:e.isTrusted,shift:e.shiftKey});
        window.addEventListener('keydown',window.__tvxAuthKeyListener,true);
        input.focus();return document.activeElement===input;
    })())''')
    assert ready is True,'Open the empty, real X login form first'
    for code in (20,19,20,19,20,19):
        probe.adb('shell','input','keyevent',str(code));time.sleep(.25)
    events=probe.evaluate('JSON.stringify(window.__tvxAuthKeyProbe)')
    expected=[{'key':'Tab','trusted':True,'shift':i%2==1} for i in range(6)]
    assert events==expected,'Physical keys did not reach the current authentication session: '+json.dumps(events)
    print('PASS: all six Android Down/Up events reached the real X document as trusted Tab/Shift+Tab')
finally:
    try:probe.evaluate("window.removeEventListener('keydown',window.__tvxAuthKeyListener,true);delete window.__tvxAuthKeyListener;delete window.__tvxAuthKeyProbe;true")
    finally:probe.adb('forward','--remove','tcp:'+str(probe.DEBUGGER_PORT))
