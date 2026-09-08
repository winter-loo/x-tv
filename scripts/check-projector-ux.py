"""Read-only real-X projector journey. No likes, replies or account changes.

Start the installed debug app on /home, then run with --serial. Screenshots are
optional and may contain the signed-in timeline; keep them outside version control.
"""
import argparse
import os
from pathlib import Path
import socket,json,subprocess,time
DEVICE=os.environ.get('TVX_ADB_SERIAL','192.168.10.100:5555')
DEBUGGER_PORT=0
SCREENSHOTS=None
def adb(*args):return subprocess.check_output(['adb','-s',DEVICE,*args],text=True,timeout=30)
def evaluate(js):
 with socket.create_connection(('127.0.0.1',DEBUGGER_PORT),timeout=8) as s:
  def read():
   b=b''
   while not b.endswith(b':'):
    data=s.recv(1)
    if not data:raise ConnectionError('Debugger disconnected')
    b+=data
   n=int(b[:-1]);b=b''
   while len(b)<n:
    data=s.recv(n-len(b))
    if not data:raise ConnectionError('Debugger disconnected')
    b+=data
   return json.loads(b)
  def req(a,t,f,**kw):
   b=json.dumps(dict(to=a,type=t,**kw)).encode();s.sendall(str(len(b)).encode()+b':'+b)
   deadline=time.monotonic()+15
   while True:
    if time.monotonic()>deadline:raise TimeoutError('Debugger request timed out')
    r=read()
    if r.get('from')==a and f in r:return r[f]
    if r.get('error'):raise RuntimeError(r['error'])
  read(); tabs=req('root','listTabs','tabs');tab=next(t for t in reversed(tabs) if 'x.com' in t.get('url',''));frame=req(tab['actor'],'getTarget','frame')
  result=req(frame['consoleActor'],'evaluateJSAsync','result',text=js)
  return json.loads(result) if isinstance(result,str) else result
STATE='''JSON.stringify({path:location.pathname,origin:performance.timeOrigin,focus:document.querySelector('.tv-focused time')?.parentElement.getAttribute('href'),y:document.querySelector('.tv-focused')?.getBoundingClientRect().top,image:!!document.querySelector('.tv-focused [data-testid="tweetPhoto"] img'),video:!!document.querySelector('.tv-focused video'),selected:!!document.querySelector('[data-tv-media-selected]'),viewer:!!document.getElementById('tv-media-viewer'),controls:!!document.getElementById('tv-media-controls'),fullscreen:!!document.querySelector('video.tv-media-fullscreen'),paused:document.querySelector('.tv-focused video')?.paused,time:document.querySelector('.tv-focused video')?.currentTime,detail:!!document.getElementById('tv-detail-chrome')})'''
def state():return evaluate(STATE)
def key(k):adb('shell','input','keyevent',str(k));time.sleep(.35)
def until(check,seconds=35):
 end=time.monotonic()+seconds
 while time.monotonic()<end:
  v=state()
  if check(v):return v
  time.sleep(.25)
 raise AssertionError('State did not satisfy check (no private post content logged)')
def settled(check,seconds=20,stable_for=1.5):
 end=time.monotonic()+seconds; stable_since=None; last=None
 while time.monotonic()<end:
  last=state()
  if check(last):
   if stable_since is None:stable_since=time.monotonic()
   elif time.monotonic()-stable_since>=stable_for:return last
  else:stable_since=None
  time.sleep(.2)
 raise AssertionError('Return failed to settle; final y='+str(last.get('y')))
def screenshot(name):
 if SCREENSHOTS is None:return
 remote='/sdcard/tvx-ux-check.png'
 try:
  adb('shell','screencap','-p',remote);adb('pull',remote,str(SCREENSHOTS/(name+'.png')))
 finally:adb('shell','rm','-f',remote)
def run():
 initial=state();assert initial['path']=='/home'
 time.sleep(.8) # Let the native presentation cover finish its frame handoff.
 got_image=False;got_video=False;roundtrips=0
 for i in range(45):
  current=state()
  if not current.get('focus'):key(20);continue
  if i%3==0:
   key(23);opened=until(lambda s:s['path']==current['focus'] and s['detail'])
   assert opened['origin']!=current['origin'],'APK did not retain home in a separate session'
   key(4)
   # Native row measurements can follow the URL change. Require the original
   # post and alignment to remain stable, not just appear in one sample.
   returned=settled(lambda s:s['path']=='/home' and s.get('focus')==current['focus'] and abs(s.get('y',0)-99)<4)
   assert returned['origin']==current['origin'],'Back reloaded document'
   assert abs(returned['y']-99)<4,'Back lost reading alignment'
   roundtrips+=1;print('PASS: retained-home detail round trip',roundtrips,flush=True)
  if current['image'] and not current['video'] and not got_image:
   key(22);until(lambda s:s['selected']);key(23);until(lambda s:s['viewer']);screenshot('image-viewer');key(4)
   until(lambda s:not s['viewer'] and s['focus']==current['focus']);key(4);got_image=True;print('PASS: remote image viewer and return',flush=True)
  if current['video'] and not got_video:
   key(22);until(lambda s:s['selected']);key(23);until(lambda s:s['controls']);until(lambda s:not s['paused'] and s['time']>0,15)
   key(23);until(lambda s:s['paused']);key(22);key(23);until(lambda s:s['fullscreen']);screenshot('video-fullscreen')
   key(4);until(lambda s:s['controls'] and not s['fullscreen']);key(4);until(lambda s:not s['controls']);key(4)
   assert state()['focus']==current['focus'];got_video=True;print('PASS: real video play/pause/fullscreen/Back',flush=True)
  if got_image and got_video and roundtrips>=5:break
  key(20)
 print(json.dumps(dict(roundtrips=roundtrips,image=got_image,video=got_video)),flush=True)
 assert roundtrips>=5 and got_image and got_video,'Journey incomplete: required media or round trips not reached'

if __name__ == '__main__':
 parser=argparse.ArgumentParser(description=__doc__)
 parser.add_argument('--serial',default=DEVICE)
 parser.add_argument('--screenshots',type=Path)
 args=parser.parse_args()
 DEVICE=args.serial; SCREENSHOTS=args.screenshots
 if SCREENSHOTS:SCREENSHOTS.mkdir(parents=True,exist_ok=True)
 DEBUGGER_PORT=int(adb('forward','tcp:0','localabstract:cn.deeloo.tvxbrowser/firefox-debugger-socket').strip())
 try:run()
 finally:adb('forward','--remove',f'tcp:{DEBUGGER_PORT}')
