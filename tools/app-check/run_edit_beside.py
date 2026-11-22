"""The window-moving script behind "Edit in Excel", run on a private test window: an off-screen scratch
app stands in for "the other app", so nothing the person is using moves and nothing takes focus.
Needs this terminal to hold the Accessibility permission.
usage: WORK=<build dir> python3 run_edit_beside.py <port>"""
import json, os, re, subprocess, sys, time
from pathlib import Path
from playwright.sync_api import sync_playwright
import lab

PORT = int(sys.argv[1])
OUT = lab.WORK / 'edit-beside'
vault = lab.WORK / 'vault-beside'
ud = lab.WORK / 'ud-beside'
SRC = Path(__file__).resolve().parents[2] / 'src/main/sideBySideScripts.ts'
source = SRC.read_text()
PLACE = re.search(r'MAC_PLACE = String\.raw`(.*?)`', source, re.S).group(1)
results = []


def check(name, ok, detail=''):
    results.append((name, bool(ok)))
    print(('PASS ' if ok else 'FAIL ') + name + (f' — {detail}' if detail else ''))


def place(pid, stem, x, y, w, h):
    env = {**os.environ, 'BESIDE_APP': f'pid:{pid}', 'BESIDE_STEM': stem, 'BESIDE_X': str(x), 'BESIDE_Y': str(y),
           'BESIDE_W': str(w), 'BESIDE_H': str(h)}
    r = subprocess.run(['/usr/bin/osascript', '-l', 'JavaScript', '-e', PLACE], env=env, capture_output=True, text=True, timeout=25)
    if r.returncode:
        raise SystemExit('script failed: ' + r.stderr[:400])
    return json.loads(r.stdout) if r.stdout.strip() else None


lab.seed_vault(vault, spaces=('Biology',), folders=1, notes=1, lines=10)
lab.profile(ud, vault)
proc, _ = lab.launch(ud, PORT, OUT / 'app.log')
try:
    with sync_playwright() as p:
        b, page = lab.connect(p, PORT)
        page.wait_for_selector('.tree-row', timeout=30000)
        time.sleep(1)
        page.evaluate("document.title = 'Budget (2) — odd’s name.xlsx'")
        time.sleep(0.5)
        # macOS keeps 40 points of a window on the screen, so these boxes end exactly there: the
        # test window never shows more than a sliver at the left edge, and never takes focus.
        got = place(proc.pid, 'budget (2) — odd’s name', -680, 60, 720, 700)
        check('finds the window by its file name and moves it', got and got['x'] == -680 and got['y'] == 60, str(got))
        check('sets the width and height it was asked for', got and got['width'] == 720 and got['height'] == 700, str(got))
        size = page.evaluate('[innerWidth, innerHeight]')
        check('the window really changed size', size[0] == 720, str(size))
        got = place(proc.pid, 'budget (2)', -160, 80, 200, 500)
        check('an app that refuses a small size stays right-aligned', got and got['x'] + got['width'] == 40 and got['width'] >= 640, str(got))
        got = place(proc.pid, 'no such file', -760, 60, 800, 700)
        check('with one window and no name match, it still moves that window', got and got['width'] == 800, str(got))
        b.close()
finally:
    lab.stop(proc)
bad = [n for n, ok in results if not ok]
print(f'{len(results) - len(bad)} of {len(results)} passed')
sys.exit(1 if bad else 0)
