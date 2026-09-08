import os, sys, time, json, re, signal, pty, select, subprocess, threading
from pathlib import Path

DEVICE = os.environ.get('TVX_ADB_SERIAL', '192.168.10.100:5555')
BASE_DIR = Path(__file__).resolve().parent.parent
RECORDINGS_DIR = BASE_DIR / '.scratch' / 'recordings'
STOP_FLAG_FILE = RECORDINGS_DIR / 'stop_requested.flag'
CURRENT_SESSION_FILE = RECORDINGS_DIR / 'current_session.json'

KEY_MAP = {
    'KEY_UP': '↑ 上',
    'KEY_DOWN': '↓ 下',
    'KEY_LEFT': '← 左',
    'KEY_RIGHT': '→ 右',
    'KEY_ENTER': 'OK 确认',
    'KEY_OK': 'OK 确认',
    'KEY_SELECT': 'OK 确认',
    'KEY_CENTER': 'OK 确认',
    'KEY_BACK': '↩ 返回',
    'KEY_ESC': '↩ 返回',
    'KEY_MENU': '☰ 菜单',
    'KEY_HOMEPAGE': '⌂ 主页',
    'KEY_HOME': '⌂ 主页',
    'KEY_VOLUMEUP': '音量+',
    'KEY_VOLUMEDOWN': '音量-',
    'KEY_MUTE': '静音',
    'KEY_POWER': '电源',
    'KEY_PLAY': '播放',
    'KEY_PAUSE': '暂停',
    'KEY_PLAYPAUSE': '播放/暂停',
    'KEY_FASTFORWARD': '快进',
    'KEY_REWIND': '快退',
}

HEX_KEY_MAP = {
    '0067': 'KEY_UP',
    '006c': 'KEY_DOWN',
    '0069': 'KEY_LEFT',
    '006a': 'KEY_RIGHT',
    '001c': 'KEY_ENTER',
    '0160': 'KEY_OK',
    '009e': 'KEY_BACK',
    '008b': 'KEY_MENU',
    '00ac': 'KEY_HOMEPAGE',
    '0073': 'KEY_VOLUMEUP',
    '0072': 'KEY_VOLUMEDOWN',
    '0071': 'KEY_MUTE',
}

def run_adb(*args, check=True, timeout=30):
    cmd = ['adb', '-s', DEVICE] + list(args)
    res = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    if check and res.returncode != 0:
        raise RuntimeError(f'ADB failed: {cmd}\nStderr: {res.stderr}')
    return res.stdout.strip()

def get_device_uptime():
    try:
        out = run_adb('shell', 'cat', '/proc/uptime')
        return float(out.split()[0])
    except Exception:
        return time.time()

class SessionRecorder:
    def __init__(self, session_name=None):
        RECORDINGS_DIR.mkdir(parents=True, exist_ok=True)
        ts = time.strftime('%Y%m%d_%H%M%S')
        self.session_name = session_name or f'session_{ts}'
        self.session_dir = RECORDINGS_DIR / self.session_name
        self.session_dir.mkdir(parents=True, exist_ok=True)
        self.events_file = self.session_dir / 'events.raw'
        self.logcat_file = self.session_dir / 'logcat.log'
        self.stop_event = threading.Event()
        self.events_list = []
        self.start_uptime = 0.0
        self.end_uptime = 0.0
        self.segment_count = 0
        self.active = False

    def clean_remote(self):
        try:
            run_adb('shell', 'rm -f /sdcard/tvx_rec_*.mp4', check=False)
            run_adb('shell', 'killall -9 screenrecord getevent', check=False)
        except Exception:
            pass

    def start_recording(self):
        print(f'[*] Initializing recording for device: {DEVICE}')
        print(f'[*] Session directory: {self.session_dir}')
        if STOP_FLAG_FILE.exists():
            STOP_FLAG_FILE.unlink()
        self.clean_remote()
        self.start_uptime = get_device_uptime()
        print(f'[*] Base device uptime: {self.start_uptime:.3f}s')

        self.getevent_thread = threading.Thread(target=self._record_getevent, daemon=True)
        self.getevent_thread.start()

        self.logcat_thread = threading.Thread(target=self._record_logcat, daemon=True)
        self.logcat_thread.start()

        session_info = {
            'session_name': self.session_name,
            'session_dir': str(self.session_dir),
            'device': DEVICE,
            'start_uptime': self.start_uptime,
            'pid': os.getpid(),
            'start_wall_time': time.time()
        }
        with open(CURRENT_SESSION_FILE, 'w', encoding='utf-8') as f:
            json.dump(session_info, f, indent=2)

        self.active = True
        print('[+] Recording started successfully! Watching for remote actions...', flush=True)
        self._record_screen_loop()

    def _record_getevent(self):
        master, slave = pty.openpty()
        proc = subprocess.Popen(
            ['adb', '-s', DEVICE, 'shell', '-t', '-t', 'getevent', '-lt'],
            stdin=slave,
            stdout=slave,
            stderr=slave,
            close_fds=True
        )
        os.close(slave)
        raw_f = open(self.events_file, 'a', encoding='utf-8', buffering=1)
        buf = ''
        try:
            while not self.stop_event.is_set():
                r, _, _ = select.select([master], [], [], 0.2)
                if not r: continue
                try:
                    chunk = os.read(master, 4096)
                    if not chunk: break
                except OSError: break
                text = chunk.decode('utf-8', errors='replace')
                raw_f.write(text); raw_f.flush(); buf += text
                while chr(10) in buf:
                    line, buf = buf.split(chr(10), 1)
                    line = line.strip()
                    if not line: continue
                    m = re.search(r'\[\s*([\d\.]+)\]\s*(/dev/input/\w+):\s*EV_KEY\s+(\w+)\s+(DOWN|UP)', line)
                    if m:
                        ev = {'uptime': float(m.group(1)), 'device': m.group(2), 'key': m.group(3), 'action': m.group(4)}
                        self.events_list.append(ev)
                        friendly = KEY_MAP.get(ev['key'], ev['key'])
                        rel = ev['uptime'] - self.start_uptime
                        print(f'  [KEY EVENT] +{rel:6.2f}s | {friendly:<8} | {ev["action"]}', flush=True)
                    else:
                        m_hex = re.search(r'\[\s*([\d\.]+)\]\s*(/dev/input/\w+):\s*0001\s+([0-9a-fA-F]{4})\s+([0-9a-fA-F]{8})', line)
                        if m_hex:
                            k_code = m_hex.group(3).lower()
                            val = int(m_hex.group(4), 16)
                            act = 'DOWN' if val == 1 else ('UP' if val == 0 else 'REPEAT')
                            key_name = HEX_KEY_MAP.get(k_code, f'KEY_{k_code}')
                            ev = {'uptime': float(m_hex.group(1)), 'device': m_hex.group(2), 'key': key_name, 'action': act}
                            self.events_list.append(ev)
                            friendly = KEY_MAP.get(key_name, key_name)
                            rel = ev['uptime'] - self.start_uptime
                            print(f'  [KEY EVENT (hex)] +{rel:6.2f}s | {friendly:<8} | {ev["action"]}', flush=True)
        finally:
            try: proc.terminate(); proc.wait(timeout=2)
            except Exception: pass
            os.close(master); raw_f.close()

    def _record_logcat(self):
        with open(self.logcat_file, 'w', encoding='utf-8') as f:
            proc = subprocess.Popen(['adb', '-s', DEVICE, 'logcat', '-v', 'time'], stdout=f, stderr=subprocess.DEVNULL)
            while not self.stop_event.is_set(): time.sleep(0.2)
            try: proc.terminate(); proc.wait(timeout=2)
            except Exception: pass

    def _record_screen_loop(self):
        segment = 0
        while not self.stop_event.is_set() and not STOP_FLAG_FILE.exists():
            remote_mp4 = f'/sdcard/tvx_rec_{segment}.mp4'
            print(f'[*] Starting screenrecord segment {segment} -> {remote_mp4}', flush=True)
            cmd = ['adb', '-s', DEVICE, 'shell', f'screenrecord --verbose --size 1280x720 --bit-rate 8M {remote_mp4}']
            proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            while proc.poll() is None:
                if self.stop_event.is_set() or STOP_FLAG_FILE.exists():
                    print('[*] Stop requested, stopping screenrecord...', flush=True)
                    run_adb('shell', 'killall -2 screenrecord || pkill -2 screenrecord', check=False)
                    break
                time.sleep(0.2)
            try: proc.wait(timeout=5)
            except subprocess.TimeoutExpired: proc.kill()
            segment += 1
            self.segment_count = segment
            if self.stop_event.is_set() or STOP_FLAG_FILE.exists(): break
        print('[*] Screen recording loop ended.', flush=True)
        self.stop_and_synthesize()

    def stop_and_synthesize(self):
        if not self.active: return
        self.active = False
        self.stop_event.set()
        print('[*] Finalizing recording and pulling files...', flush=True)
        time.sleep(1.0)
        self.end_uptime = get_device_uptime()

        pulled_segments = []
        for i in range(self.segment_count + 1):
            remote_path = f'/sdcard/tvx_rec_{i}.mp4'
            local_path = self.session_dir / f'segment_{i}.mp4'
            res = subprocess.run(['adb', '-s', DEVICE, 'pull', remote_path, str(local_path)], capture_output=True, text=True)
            if res.returncode == 0 and local_path.exists() and local_path.stat().st_size > 0:
                pulled_segments.append(local_path)
                print(f'[+] Pulled {remote_path} ({local_path.stat().st_size / 1024:.1f} KB)', flush=True)
            run_adb('shell', f'rm -f {remote_path}', check=False)

        if not pulled_segments:
            print('[!] Warning: No video segments were pulled!', flush=True)
            return

        raw_video = self.session_dir / 'raw_video.mp4'
        if len(pulled_segments) == 1:
            pulled_segments[0].rename(raw_video)
        else:
            list_file = self.session_dir / 'segments.txt'
            with open(list_file, 'w', encoding='utf-8') as f:
                for p in pulled_segments: f.write(f"file '{p.name}'\n")
            cmd = ['ffmpeg', '-y', '-f', 'concat', '-safe', '0', '-i', str(list_file), '-c', 'copy', str(raw_video)]
            subprocess.run(cmd, check=True)

        print(f'[+] Merged raw video: {raw_video} ({raw_video.stat().st_size / 1024 / 1024:.2f} MB)', flush=True)

        events_json_path = self.session_dir / 'key_events.json'
        with open(events_json_path, 'w', encoding='utf-8') as f:
            json.dump({
                'start_uptime': self.start_uptime,
                'end_uptime': self.end_uptime,
                'duration': self.end_uptime - self.start_uptime,
                'events': self.events_list
            }, f, indent=2, ensure_ascii=False)

        ass_path = self.session_dir / 'remote_overlay.ass'
        self._generate_ass_overlay(ass_path)

        final_video = self.session_dir / 'demo_with_remote.mp4'
        print(f'[*] Rendering video with remote control HUD: {final_video}', flush=True)
        cmd = [
            'ffmpeg', '-y', '-i', str(raw_video),
            '-vf', f'ass={ass_path}',
            '-c:v', 'libx264', '-preset', 'fast', '-crf', '20',
            '-c:a', 'copy',
            str(final_video)
        ]
        res = subprocess.run(cmd, capture_output=True, text=True)
        if res.returncode == 0:
            print(f'[+] Synthesized demo video created: {final_video}', flush=True)
        else:
            print(f'[!] FFmpeg error rendering ASS overlay:\n{res.stderr}', flush=True)
            final_video = raw_video

        keyframes_dir = self.session_dir / 'keyframes'
        keyframes_dir.mkdir(exist_ok=True)
        print(f'[*] Extracting keyframes to: {keyframes_dir}', flush=True)
        subprocess.run([
            'ffmpeg', '-y', '-i', str(final_video),
            '-vf', 'fps=1/2',
            '-q:v', '2',
            str(keyframes_dir / 'frame_%03d.jpg')
        ], capture_output=True)

        down_events = [e for e in self.events_list if e['action'] == 'DOWN']
        summary = {
            'session_name': self.session_name,
            'session_dir': str(self.session_dir),
            'final_video': str(final_video),
            'duration_seconds': self.end_uptime - self.start_uptime,
            'total_key_events': len(self.events_list),
            'total_presses': len(down_events),
            'key_counts': {}
        }
        for e in down_events:
            k = KEY_MAP.get(e['key'], e['key'])
            summary['key_counts'][k] = summary['key_counts'].get(k, 0) + 1

        summary_path = self.session_dir / 'summary.json'
        with open(summary_path, 'w', encoding='utf-8') as f:
            json.dump(summary, f, indent=2, ensure_ascii=False)

        if CURRENT_SESSION_FILE.exists(): CURRENT_SESSION_FILE.unlink()
        if STOP_FLAG_FILE.exists(): STOP_FLAG_FILE.unlink()

        print('\n' + '=' * 60, flush=True)
        print('DEMO RECORDING & SYNTHESIS COMPLETE!', flush=True)
        print(f'Session Dir:   {self.session_dir}', flush=True)
        print(f'Final Video:   {final_video}', flush=True)
        print(f'Duration:      {summary["duration_seconds"]:.1f}s', flush=True)
        print(f'Key Presses:   {summary["total_presses"]}', flush=True)
        print(f'Key Breakdown: {summary["key_counts"]}', flush=True)
        print('=' * 60 + '\n', flush=True)

    def _generate_ass_overlay(self, ass_path):
        ass_header = "[Script Info]\nScriptType: v4.00+\nPlayResX: 1280\nPlayResY: 720\nWrapStyle: 0\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: RemoteHUD,Source Han Sans CN,22,&H00FFFFFF,&H000000FF,&H00000000,&HA0151515,-1,0,0,0,100,100,0,0,3,4,0,3,30,30,30,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n"
        dialogues = []
        def fmt_time(t):
            t = max(0.0, t)
            h = int(t // 3600)
            m = int((t % 3600) // 60)
            s = int(t % 60)
            cs = int((t - int(t)) * 100)
            return f'{h}:{m:02d}:{s:02d}.{cs:02d}'

        down_events = [e for e in self.events_list if e['action'] == 'DOWN']
        history = []
        for i, ev in enumerate(down_events):
            rel_start = max(0.0, ev['uptime'] - self.start_uptime)
            if i + 1 < len(down_events):
                next_rel = max(0.0, down_events[i + 1]['uptime'] - self.start_uptime)
                rel_end = min(rel_start + 1.5, max(rel_start + 0.4, next_rel))
            else:
                rel_end = rel_start + 1.5
            k_label = KEY_MAP.get(ev['key'], ev['key'])
            history.append(k_label)
            if len(history) > 4: history.pop(0)
            hist_str = ' → '.join(history[-4:])
            nl = '\\N'
            text_main = (
                r'{\b1\c&H00FFFF&}遥控按键:  {\b1\c&H00D7FF&}【 ' + k_label + r' 】' +
                nl + r'{\b0\fs18\c&HCCCCCC&}历史: ' + hist_str +
                r'   {\c&H888888&}[' + fmt_time(rel_start) + r']'
            )
            dialogues.append(f'Dialogue: 0,{fmt_time(rel_start)},{fmt_time(rel_end)},RemoteHUD,,0,0,0,,{text_main}')

        with open(ass_path, 'w', encoding='utf-8') as f:
            f.write(ass_header)
            for d in dialogues: f.write(d + '\n')

def stop_active_session():
    if not CURRENT_SESSION_FILE.exists():
        print('[!] No active session file found.')
        run_adb('shell', 'killall -2 screenrecord || pkill -2 screenrecord', check=False)
        return
    STOP_FLAG_FILE.touch()
    with open(CURRENT_SESSION_FILE, 'r', encoding='utf-8') as f: data = json.load(f)
    pid = data.get('pid')
    print(f'[*] Signaling active session PID {pid} to stop...')
    try: os.kill(pid, signal.SIGINT)
    except ProcessLookupError: pass

if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == 'stop':
        stop_active_session()
    elif len(sys.argv) > 1 and sys.argv[1] == 'status':
        if CURRENT_SESSION_FILE.exists():
            with open(CURRENT_SESSION_FILE, 'r', encoding='utf-8') as f: print('Active session:', f.read())
        else: print('No active recording session.')
    else:
        recorder = SessionRecorder()
        def sig_handler(signum, frame):
            print('\n[*] Received interrupt signal. Stopping recording...')
            STOP_FLAG_FILE.touch()
            recorder.stop_event.set()
        signal.signal(signal.SIGINT, sig_handler)
        signal.signal(signal.SIGTERM, sig_handler)
        recorder.start_recording()
