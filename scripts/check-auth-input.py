#!/usr/bin/env python3
"""Physical Android input acceptance for the native authentication owner.

Requires a signed-out debug build. Does not enter credentials, submit a form or
log anyone out. Retains the entry screen at the end. XML is removed from device.
"""
import argparse
import subprocess
import time
import xml.etree.ElementTree as ET

parser = argparse.ArgumentParser()
parser.add_argument('--serial', default='192.168.10.100:5555')
args = parser.parse_args()
package = 'cn.deeloo.tvxbrowser'
remote = '/sdcard/tvx-auth-input-check.xml'

def adb(*command):
    return subprocess.check_output(['adb', '-s', args.serial, *command], text=True, timeout=20)

def snapshot():
    adb('shell', 'uiautomator', 'dump', remote)
    xml = adb('exec-out', 'cat', remote)
    # Some vendor adb builds prefix command diagnostics before the XML.
    start = xml.find('<?xml')
    if start < 0:
        return '', ''
    tree = ET.fromstring(xml[start:])
    nodes = list(tree.iter('node'))
    state = next((n.get('content-desc') for n in nodes if n.get('content-desc', '').startswith('tvx-auth-')), '')
    focused = next((n.get('text') for n in nodes if n.get('focused') == 'true' and n.get('class') == 'android.widget.Button'), '')
    return state, focused

def until(expected, seconds=25):
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        state, focused = snapshot()
        if state == expected:
            return focused
        time.sleep(.3)
    raise AssertionError('Native auth owner did not become ' + expected)

def key(code):
    adb('shell', 'input', 'keyevent', str(code))
    time.sleep(.15)

try:
    adb('shell', 'am', 'force-stop', package)
    adb('shell', 'am', 'start', '-n', package + '/.BrowserActivity')
    assert until('tvx-auth-entry') == '使用 Google 账号登录'
    for _ in range(3):
        key(20)
        assert snapshot()[1] == '使用 X 账号登录', 'Android Down did not move native focus'
        key(19)
        assert snapshot()[1] == '使用 Google 账号登录', 'Android Up did not restore native focus'
    print('PASS: Android Down/Up moves native login focus on every press', flush=True)

    for run in range(3):
        key(20);key(23)
        until('tvx-auth-web')
        key(4)
        assert until('tvx-auth-entry') == '使用 Google 账号登录'
        time.sleep(2)
        assert snapshot()[0] == 'tvx-auth-entry', 'A retired page took back the screen'
        print('PASS: native confirm opens authentication; Back cancels attempt', run+1, flush=True)

    key(3)
    adb('shell', 'am', 'start', '-n', package + '/.BrowserActivity')
    assert until('tvx-auth-entry') == '使用 Google 账号登录'
    key(20)
    assert snapshot()[1] == '使用 X 账号登录'
    key(19)
    print('PASS: launcher return preserves the native input owner', flush=True)
finally:
    adb('shell', 'rm', '-f', remote)
