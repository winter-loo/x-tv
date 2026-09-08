"""Read-only nested-comment acceptance on the projector's signed-in home.

Select a home post with a populated comment thread before running. The script
looks for a comment with child replies; missing live data fails the journey.
"""
import argparse
import importlib.util
from pathlib import Path
import time
import sys
sys.dont_write_bytecode = True

spec=importlib.util.spec_from_file_location('projector_ux',Path(__file__).with_name('check-projector-ux.py'))
helper=importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)
key,evaluate,adb,screenshot=helper.key,helper.evaluate,helper.adb,helper.screenshot
JS=r"""JSON.stringify((()=>{
 const path=n=>{const link=[...n.querySelectorAll('a[href*="/status/"]')].find(a=>a.querySelector('time')&&!a.parentElement.closest('[role="link"],[data-testid="quoteTweet"]'));return link?.getAttribute('href')?.match(/\/[^/]+\/status\/\d+/)?.[0]||null};
 const root=document.querySelector('.tv-detail-post');const selected=document.querySelector('[data-tv-reply-selected]');
 return {path:location.pathname,origin:performance.timeOrigin,home:document.querySelector('.tv-focused')?path(document.querySelector('.tv-focused')):null,root:root?path(root):null,selected:selected?path(selected):null,selectedCount:parseFloat(selected?.querySelector('[data-testid=reply]')?.textContent)||0,y:scrollY,postY:root?.scrollTop,column:document.body.getAttribute('data-tv-detail-column'),replies:[...document.querySelectorAll('.tv-detail-reply')].map(path).filter(Boolean),composer:!!document.getElementById('tv-detail-composer-overlay')};
})())"""
def state():return evaluate(JS)
def wait(check,seconds=40):
 end=time.monotonic()+seconds
 while time.monotonic()<end:
  try:
   s=state()
   if check(s):return s
  except (ConnectionError,OSError,StopIteration,RuntimeError):pass
  time.sleep(.3)
 raise AssertionError('Required comment state not reached')
def run():
 home=wait(lambda s:s['home'])
 time.sleep(1.5) # Native loading cover hands off after content announces ready.
 key(23)
 wait(lambda s:s['root'] and len(s['replies'])>1)
 key(22);wait(lambda s:s['selected'])
 for _ in range(50):
  parent=state()
  if parent['selectedCount']>0:break
  key(20)
 else:raise AssertionError('No comment with child replies encountered')
 screenshot('comment-selected')
 key(23);child=wait(lambda s:s['path']==parent['selected'] and s['root']==parent['selected'])
 assert child['origin']!=parent['origin'];print('PASS: selected real comment opens as its own post',flush=True)
 # Wait for actual descendants before moving into the comment column.
 wait(lambda s:len(s['replies'])>0)
 key(22);wait(lambda s:s['selected'])
 for _ in range(20):
  child=state()
  if child['selected'] not in (home['home'],parent['root']):break
  key(20)
 else:raise AssertionError('No descendant reply encountered')
 screenshot('comment-child-selected');key(23)
 leaf=wait(lambda s:s['path']==child['selected'] and s['root']==child['selected'])
 assert leaf['origin']!=child['origin'];print('PASS: nested comment opens a third retained detail',flush=True)
 key(4);restored=wait(lambda s:s['origin']==child['origin'] and s['selected']==child['selected'])
 assert abs(restored['y']-child['y'])<3 and restored['column']==child['column']
 print('PASS: Back restores child comment focus and scroll',flush=True)
 key(4);restored=wait(lambda s:s['origin']==parent['origin'] and s['selected']==parent['selected'])
 assert abs(restored['y']-parent['y'])<3 and restored['postY']==parent['postY']
 print('PASS: Back restores original detail focus and scroll',flush=True)
 key(22);key(23);wait(lambda s:s['composer'])
 time.sleep(1) # Let Android finish showing its input method before Back.
 ime_shown='mInputShown=true' in adb('shell','dumpsys','input_method')
 key(4)
 if state()['composer']:
  assert ime_shown, 'Back did not close the composer and no input method was shown'
  assert 'mInputShown=false' in adb('shell','dumpsys','input_method'), 'Back did not hide the input method'
  print('PASS: first Back hides Android input method',flush=True)
  key(4)
 wait(lambda s:not s['composer'])
 assert state()['origin']==parent['origin'];print('PASS: write-comment entry still opens/cancels locally',flush=True)
 key(4);restored=wait(lambda s:s['origin']==home['origin'] and s['home']==home['home'])
 print('PASS: final Back restores the retained home post',flush=True)

if __name__=='__main__':
 parser=argparse.ArgumentParser(description=__doc__)
 parser.add_argument('--serial',default=helper.DEVICE)
 parser.add_argument('--screenshots',type=Path)
 args=parser.parse_args()
 helper.DEVICE=args.serial;helper.SCREENSHOTS=args.screenshots
 if args.screenshots:args.screenshots.mkdir(parents=True,exist_ok=True)
 helper.DEBUGGER_PORT=int(adb('forward','tcp:0','localabstract:cn.deeloo.tvxbrowser/firefox-debugger-socket').strip())
 try:run()
 finally:adb('forward','--remove',f'tcp:{helper.DEBUGGER_PORT}')
