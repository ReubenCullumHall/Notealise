"""One throwaway vault + one visible test window per case. Never touches real notes or the real app."""
import ctypes, json, os, shutil, socket, subprocess, sys, tempfile, time
from ctypes import wintypes
from pathlib import Path
from playwright.sync_api import sync_playwright

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO / 'tools' / 'app-check'))
from file_tabs_fixtures import make_docx

WORK = Path(os.environ['WORK'])
ELECTRON = REPO / 'node_modules' / 'electron' / 'dist' / 'electron.exe'
sys.stdout.reconfigure(encoding='utf-8', errors='replace')


def docx_bytes():
    with tempfile.TemporaryDirectory() as t:
        p = Path(t) / 'x.docx'
        make_docx(p)
        return p.read_bytes()


def size_window(pid):
    user32 = ctypes.WinDLL('user32', use_last_error=True)
    found = []
    PROC = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    def each(hwnd, _):
        got = wintypes.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(got))
        if got.value == pid and user32.IsWindowVisible(hwnd):
            found.append(hwnd)
        return True
    user32.EnumWindows(PROC(each), 0)
    for hwnd in found:
        user32.SetWindowPos(hwnd, 0, 40, 20, 1300, 980, 0x0010 | 0x0004)


class App:
    def __init__(self, name, files, port, root=None, theme='light', inspect=None):
        self.inspect = inspect
        self.base = Path(root or WORK) / f'case-{name}'
        self.vault, self.ud, self.port = self.base / 'vault', self.base / 'ud', port
        self.bio = self.vault / 'Biology'
        self.files, self.theme = files, theme
        self.errors = []

    def __enter__(self):
        with socket.socket() as s:
            if s.connect_ex(('127.0.0.1', self.port)) == 0:
                raise SystemExit(f'port {self.port} is taken')
        if self.base.exists():
            shutil.rmtree(self.base)
        self.bio.mkdir(parents=True)
        (self.vault / '.mdnotes').mkdir()
        (self.vault / '.mdnotes' / 'settings.json').write_text(json.dumps({
            'spaces': [{'folder': 'Biology', 'theme': self.theme}], 'activeSpaceFolder': 'Biology', 'playStartupAnimation': False}), encoding='utf-8')
        (self.bio / 'Note.md').write_bytes(b'# Note\n')
        for n, data in self.files.items():
            (self.bio / n).parent.mkdir(parents=True, exist_ok=True)
            (self.bio / n).write_bytes(data)
        self.ud.mkdir()
        (self.ud / 'config.json').write_text(json.dumps({'vaultPath': str(self.vault), 'hasOnboarded': True}), encoding='utf-8')
        env = {k: v for k, v in os.environ.items() if k != 'ELECTRON_RUN_AS_NODE'}
        self.log = open(self.base / 'app.log', 'w')
        exe = os.environ.get('APP_EXE')
        head = [exe] if exe else [str(ELECTRON)] + ([f'--inspect={self.inspect}'] if self.inspect else []) + [str(WORK / 'out' / 'main' / 'index.js')]
        scale = [f"--force-device-scale-factor={os.environ['EXTRA_SCALE']}"] if os.environ.get('EXTRA_SCALE') else []
        self.proc = subprocess.Popen(head + scale + [f'--user-data-dir={self.ud}', f'--remote-debugging-port={self.port}', '--mute-audio'],
                                     env=env, stdout=self.log, stderr=subprocess.STDOUT)
        self.pw = sync_playwright().start()
        for _ in range(120):
            try:
                self.b = self.pw.chromium.connect_over_cdp(f'http://127.0.0.1:{self.port}')
                self.page = next(pg for c in self.b.contexts for pg in c.pages if pg.url.startswith('file:'))
                break
            except Exception:
                time.sleep(0.25)
        else:
            raise SystemExit('the test app never opened')
        self.page.set_default_timeout(20000)
        self.page.on('pageerror', lambda e: self.errors.append(str(e)[:160]))
        size_window(self.proc.pid)
        self.page.emulate_media(color_scheme='dark' if self.theme == 'dark' else 'light', reduced_motion='null')
        self.page.wait_for_selector('.tree-row', timeout=30000)
        time.sleep(1.5)
        return self

    def __exit__(self, *a):
        try:
            self.b.close()
        except Exception:
            pass
        self.pw.stop()
        subprocess.run(['taskkill', '/F', '/T', '/PID', str(self.proc.pid)], capture_output=True)
        try:
            self.proc.wait(timeout=8)
        except Exception:
            pass
        self.log.close()
        time.sleep(0.4)

    def titles(self):
        return self.page.eval_on_selector_all('.tree-title', 'els => els.map(e => e.textContent)')

    def open(self, title, settle=1.2):
        self.page.locator('.tree-title', has_text=title).first.click()
        time.sleep(settle)
