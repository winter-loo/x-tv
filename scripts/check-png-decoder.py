#!/usr/bin/env python3
"""Physical GeckoView regression: ordinary RGB PNG decoding must not crash.

Uses the app's existing URL intent and Firefox remote-debugging boundary. No X
account, network data, or adapter is involved. Requires an installed debug APK.
"""
import argparse
import json
import socket
import struct
import subprocess
import threading
import time
import zlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PACKAGE = 'cn.deeloo.tvxbrowser'


def png(width, height=80):
    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data))
    rows = b''.join(b'\0' + bytes((x * 7 + y * 11) % 256 for x in range(width * 3)) for y in range(height))
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(rows)) + chunk(b'IEND', b''))


class Probe(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith('/image/'):
            data = png(int(self.path.split('/')[-1]))
            mime = 'image/png'
        else:
            # 69px alone reproduced SIGBUS. Neighboring widths cover SIMD tails.
            data = ('''<!doctype html><title>PNG loading</title><style>img{width:20px;height:24px}</style>
              <script>window.probe={passed:false};addEventListener('load',async()=>{
                const images=[...document.images];
                try { await Promise.all(images.map(image=>image.decode())); }
                catch { window.probe={passed:false}; return; }
                window.probe={passed:images.every(i=>i.complete&&i.naturalWidth>0),count:images.length};
                document.title=window.probe.passed?'PNG decoded':'PNG failed';
              });</script>''' + ''.join(f'<img src="/image/{w}">' for w in [69, 1, 2, 3, 4, 5, 7, 8, 15, 16, 17, 63, 64, 65, 127])).encode()
            mime = 'text/html'
        self.send_response(200)
        self.send_header('Content-Type', mime)
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *_):
        pass


def probe_state(port, url):
    # Firefox RDP: https://firefox-source-docs.mozilla.org/devtools/backend/protocol.html
    with socket.create_connection(('127.0.0.1', port), timeout=3) as sock:
        def read():
            length = b''
            while not length.endswith(b':'):
                data = sock.recv(1)
                if not data:
                    raise ConnectionError('Debugger disconnected')
                length += data
            result = b''
            size = int(length[:-1])
            while len(result) < size:
                data = sock.recv(size - len(result))
                if not data:
                    raise ConnectionError('Debugger disconnected')
                result += data
            return json.loads(result)

        def request(actor, kind, field, **values):
            data = json.dumps(dict(to=actor, type=kind, **values)).encode()
            sock.sendall(str(len(data)).encode() + b':' + data)
            while True:
                result = read()
                if result.get('from') != actor:
                    continue
                if 'error' in result:
                    raise RuntimeError('Gecko debugger target unavailable')
                if field in result:
                    return result[field]

        read()
        tabs = request('root', 'listTabs', 'tabs')
        tab = next((tab for tab in tabs if tab.get('url') == url), None)
        if not tab:
            return None
        target = request(tab['actor'], 'getTarget', 'frame')
        result = request(target['consoleActor'], 'evaluateJSAsync', 'result',
                         text='JSON.stringify(window.probe||{})')
        return json.loads(result) if isinstance(result, str) else None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--serial', required=True)
    args = parser.parse_args()

    def adb(*command):
        return subprocess.check_output(['adb', '-s', args.serial, *command], text=True, timeout=30)

    server = ThreadingHTTPServer(('127.0.0.1', 0), Probe)
    port = server.server_port
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    debugger_port = None
    before = set(adb('logcat', '-d', '-b', 'crash', '-t', '300').splitlines())
    try:
        adb('reverse', f'tcp:{port}', f'tcp:{port}')
        debugger_port = int(adb('forward', 'tcp:0', f'localabstract:{PACKAGE}/firefox-debugger-socket').strip())
        adb('shell', 'am', 'force-stop', PACKAGE)
        url = f'http://127.0.0.1:{port}/'
        adb('shell', 'am', 'start', '-W', '-n', f'{PACKAGE}/.BrowserActivity', '--es', 'url', url)
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            added = '\n'.join(line for line in adb('logcat', '-d', '-b', 'crash', '-t', '300').splitlines() if line not in before)
            if PACKAGE in added and ('SIGBUS' in added or 'signal 7' in added):
                raise AssertionError('Gecko content process crashed with SIGBUS while decoding ordinary RGB PNGs')
            try:
                state = probe_state(debugger_port, url)
                if state and state.get('passed') and state.get('count') == 15:
                    print('PASS: 15 RGB PNG widths decoded on device, including the 69px SIGBUS reproducer.')
                    return
            except (OSError, RuntimeError, ValueError):
                pass  # Target creation is asynchronous; startup is bounded by the deadline.
            time.sleep(.5)
        raise AssertionError('PNG decoding did not complete within 30 seconds')
    finally:
        if debugger_port:
            adb('forward', '--remove', f'tcp:{debugger_port}')
        adb('reverse', '--remove', f'tcp:{port}')
        server.shutdown()
        server.server_close()


if __name__ == '__main__':
    main()
