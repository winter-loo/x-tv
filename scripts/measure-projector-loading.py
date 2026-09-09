"""Measure XTV cold-home or focused-post loading without collecting account content.

Example: python3 scripts/measure-projector-loading.py cold --output .scratch/loading-performance/home.json
A cold run restarts XTV, preserving app data. A detail run presses OK on the
currently focused timeline post. Reader runs distinguish complete content (including labeled full cache / API-body reuse)
from fresh network updates. Times are frame-callback observations, not optical measurements. The optional budget is an explicit test target.
"""
import argparse
import importlib.util
import json
from pathlib import Path
import time
import subprocess
import re
import threading


def measure_reader(args):
    """Observe native frame completion, including launch/input overhead in the budget."""
    if args.mode == 'cold':
        projector.adb('shell', 'am', 'force-stop', PACKAGE)
    events = []
    log = subprocess.Popen(['adb', '-s', args.serial, 'logcat', '-T', '1', '-v', 'threadtime',
                            'TvXReaderPerf:W', '*:S'], stdout=subprocess.PIPE, text=True)
    def collect():
        for line in log.stdout:
            match = re.search(r'\s(\d+)\s+\d+\s+W\s+TvXReaderPerf\s*:\s*(home|detail) (live|cached|reused) ms=(\d+)', line)
            if match:
                events.append((time.monotonic(), int(match[1]), match[2], match[3], int(match[4])))
    thread = threading.Thread(target=collect, daemon=True)
    thread.start()
    time.sleep(.2)  # Drain the pre-existing tail before the measured action.
    started = time.monotonic()
    try:
        if args.mode == 'cold':
            projector.adb('shell', 'am', 'start', '-W', '-n', PACKAGE + '/.BrowserActivity')
        else:
            projector.adb('shell', 'input', 'keyevent', '23')
        pid = int(projector.adb('shell', 'pidof', PACKAGE).strip())
        expected = 'home' if args.mode == 'cold' else 'detail'
        found = None
        live = None
        captured = False
        while time.monotonic() - started < 30:
            found = next((e for e in events if e[0] >= started and e[1] == pid and e[2] == expected), None)
            live = next((e for e in events if e[0] >= started and e[1] == pid and e[2] == expected and e[3] == 'live'), None)
            if found and args.screenshot and not captured:
                png = subprocess.check_output(['adb', '-s', args.serial, 'exec-out', 'screencap', '-p'], timeout=15)
                offset = png.find(b'\x89PNG\r\n\x1a\n')  # This ROM prints a wrapper banner first.
                if offset < 0:
                    raise RuntimeError('Device did not return a PNG screenshot')
                args.screenshot.parent.mkdir(parents=True, exist_ok=True)
                args.screenshot.write_bytes(png[offset:])
                captured = True
            if live or (found and (args.stop_at_readable or time.monotonic() - started > 12)):
                break
            time.sleep(.025)
        elapsed = round(found[0] - started, 3) if found else None
        fresh_elapsed = round(live[0] - started, 3) if live else None
        measured = fresh_elapsed if args.require_fresh else elapsed
        result = {'engine': 'reader', 'mode': args.mode, 'full_content_seconds': elapsed,
                  'live_content_seconds': fresh_elapsed,
                  'cache_used': bool(found and found[3] == 'cached'),
                  'content_source': found[3] if found else None,
                  'native_content_seconds': found[4] / 1000 if found else None,
                  'budget_seconds': args.budget,
                  'require_fresh': args.require_fresh,
                  'passed': measured is not None and (args.budget is None or measured < args.budget)}
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(result, indent=2) + '\n')
        print(json.dumps(result), flush=True)
        return 0 if result['passed'] else 1
    finally:
        log.terminate()
        log.wait(timeout=5)

spec = importlib.util.spec_from_file_location('projector_ux', Path(__file__).with_name('check-projector-ux.py'))
projector = importlib.util.module_from_spec(spec)
spec.loader.exec_module(projector)
PACKAGE = 'cn.deeloo.tvxbrowser'
STATE = '''JSON.stringify({origin:performance.timeOrigin,now:performance.now(),kind:location.pathname==='/home'?'home':location.pathname.includes('/status/')?'detail':'other',hidden:document.hidden,articles:document.querySelectorAll('article[data-testid="tweet"]').length,cards:document.querySelectorAll('.tv-reading-card').length,detailRoot:!!document.querySelector('article.tv-detail-post:not(.tv-instant-post)'),preview:!!document.querySelector('#tv-detail-instant-root'),focus:!!document.querySelector('.tv-focused'),boot:document.documentElement.classList.contains('tv-x-boot'),unavailable:!!document.querySelector('#tv-detail-error-card'),metrics:JSON.parse(document.documentElement.dataset.tvxLoad||'null'),load:performance.getEntriesByType('navigation')[0]?.loadEventEnd,navigation:(()=>{const n=performance.getEntriesByType('navigation')[0];return n?Object.fromEntries(['requestStart','responseStart','responseEnd','domInteractive','domContentLoadedEventEnd','loadEventEnd'].map(k=>[k,Math.round(n[k])])):null})()})'''

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=['cold', 'detail'])
    parser.add_argument('--serial', default=projector.DEVICE)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--engine', choices=['reader', 'browser'], default='reader')
    parser.add_argument('--require-fresh', action='store_true', help='Apply the budget to this launch\'s fresh response, excluding labeled cache and previously obtained complete API bodies')
    parser.add_argument('--stop-at-readable', action='store_true', help='Return at complete content readiness, allowing an immediate detail test during home refresh')
    parser.add_argument('--screenshot', type=Path, help='Save the first complete frame locally; may contain private timeline content')
    parser.add_argument('--budget', type=float, help='Maximum seconds until complete content is readable; excerpts never qualify, and --require-fresh excludes cache/reuse')
    args = parser.parse_args()
    if args.require_fresh and args.stop_at_readable:
        parser.error('--require-fresh and --stop-at-readable cannot be combined')
    projector.DEVICE = args.serial
    if args.engine == 'reader':
        return measure_reader(args)
    projector.DEBUGGER_PORT = int(projector.adb('forward', 'tcp:0', 'localabstract:' + PACKAGE + '/firefox-debugger-socket'))
    samples = []
    first = full = None
    try:
        if args.mode == 'cold':
            projector.adb('shell', 'am', 'force-stop', PACKAGE)
            started = time.monotonic()
            projector.adb('shell', 'am', 'start', '-W', '-n', PACKAGE + '/.BrowserActivity')
        else:
            before = projector.evaluate(STATE)
            if before['hidden'] or not before['focus'] or before['kind'] != 'home':
                raise RuntimeError('Open the timeline and focus a post before measuring detail')
            started = time.monotonic()
            projector.adb('shell', 'input', 'keyevent', '23')
        while time.monotonic() - started < 35:
            try:
                state = projector.evaluate(STATE)
            except (OSError, RuntimeError, StopIteration):
                time.sleep(.15)
                continue
            elapsed = round(time.monotonic() - started, 3)
            samples.append({'elapsed': elapsed, **state})
            active = not state['hidden'] and not state['boot']
            complete = active and ((args.mode == 'cold' and state['kind'] == 'home' and state['cards'] and state['focus']) or
                                   (args.mode == 'detail' and state['kind'] == 'detail' and state['detailRoot']))
            readable = complete or (args.mode == 'detail' and active and state['kind'] == 'detail' and state['preview'])
            if first is None and readable:
                first = elapsed
                print('Readable:', first, 'seconds', flush=True)
            if full is None and complete:
                full = elapsed
                print('Live content:', full, 'seconds', flush=True)
            if full is not None and elapsed >= full + 1:
                break
            time.sleep(.15)
        result = {'mode': args.mode, 'readable_seconds': first, 'live_content_seconds': full,
                  'budget_seconds': args.budget, 'passed': full is not None and (args.budget is None or full < args.budget),
                  'samples': samples}
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
        print(json.dumps({k: v for k, v in result.items() if k != 'samples'}), flush=True)
        return 0 if result['passed'] else 1
    finally:
        projector.adb('forward', '--remove', 'tcp:' + str(projector.DEBUGGER_PORT))

if __name__ == '__main__':
    raise SystemExit(main())
