"""What the window SAYS when a folder can't be read (the 2026-11-14 lines; wording approved 2026-11-13).

usage: WORK=<dir> python3 run_unreadable_lines.py <debug port> <inspect port> <picture folder>
  (build first: WORK=<dir> ./build.sh). Mac only: chmod 000 locks a folder. Cases, each in a fresh window:
  inside — a locked folder and an empty one side by side in a space, both opened, then the line hovered
  space  — the open space's own folder is locked
  root   — the notes folder itself is locked, then "Choose folder…" is answered with another locked folder,
           then with a good one (the line must go), then a control: a folder that has gone (plain screen)
  switch — Settings → "Choose a different folder…" answered with a locked folder
Prints what each window says and saves a picture of each step."""
from __future__ import annotations
import subprocess, sys, time
from pathlib import Path
from playwright.sync_api import sync_playwright
import lab

PORT, INSPECT, PICS = int(sys.argv[1]), int(sys.argv[2]), Path(sys.argv[3])
PICS.mkdir(parents=True, exist_ok=True)
HERE = Path(__file__).resolve().parent
NODE = str(Path.home() / '.local/opt/node/bin/node')
W = lab.WORK / 'unreadable'
LINE = "Couldn't open this folder"
TIP = "Its notes are still on your computer — the app isn't allowed to read them."
VAULT_LINE = "Couldn't open your notes folder — this computer isn't letting the app read it. Choose it again, or pick another."
locked: list[Path] = []
fails: list[str] = []


def lock(p: Path) -> None:
    p.chmod(0o000)
    locked.append(p)


def unlock_all() -> None:
    for p in locked:
        subprocess.run(['chmod', '-R', 'u+rwx', str(p)])
    locked.clear()


def check(what: str, ok: bool) -> None:
    print(('  PASS ' if ok else '  FAIL ') + what)
    if not ok:
        fails.append(what)


def launch(vault: Path, name: str):
    ud = W / f'ud-{name}'
    lab.profile(ud, vault)
    env = {k: v for k, v in __import__('os').environ.items() if k != 'ELECTRON_RUN_AS_NODE'}
    log = open(W / f'{name}.log', 'w')
    proc = subprocess.Popen([str(lab.ELECTRON), f'--inspect={INSPECT}', str(lab.MAIN), f'--user-data-dir={ud}',
                             f'--remote-debugging-port={PORT}', '--mute-audio'], env=env, stdout=log, stderr=subprocess.STDOUT)
    return proc


def answer_picker(*paths: Path) -> None:
    out = subprocess.run([NODE, str(HERE / 'patch_dialog.mjs'), str(INSPECT), *map(str, paths)], capture_output=True, text=True)
    print('  file box:', out.stdout.strip() or out.stderr.strip()[:200])


def body(page) -> str:
    return page.evaluate("() => document.body.innerText.replace(/\\s+/g, ' ')")


def shot(page, name: str, sel: str | None = None) -> None:
    (page.locator(sel).first if sel else page).screenshot(path=str(PICS / f'{name}.png'))


def open_folder(page, title: str) -> None:
    page.evaluate("""(t) => {
      const row = [...document.querySelectorAll('.tree-row')].find(r => r.querySelector('.tree-title')?.textContent.trim() === t)
      row.querySelector('[data-tip="Expand"]')?.click()
    }""", title)
    time.sleep(0.6)


def tooltip_text(page) -> str:
    return page.evaluate("""() => [...document.querySelectorAll('body *')].filter(e => e.children.length === 0 &&
        getComputedStyle(e).position !== 'static' || e.getAttribute?.('role') === 'tooltip').map(e => e.textContent.trim())
        .filter(t => t.startsWith('Its notes')).join(' | ')""")


def seed(name: str, **kw) -> Path:
    vault = W / name
    if vault.exists():
        subprocess.run(['chmod', '-R', 'u+rwx', str(vault)])
    lab.seed_vault(vault, folders=2, notes=3, **kw)
    return vault


def run(name: str, vault: Path, steps) -> None:
    print(f'=== {name} ===')
    proc = launch(vault, name)
    try:
        with sync_playwright() as p:
            b, page = lab.connect(p, PORT)
            page.emulate_media(color_scheme='light', reduced_motion='reduce')
            page.set_viewport_size({'width': 1100, 'height': 720})
            errs: list[str] = []
            page.on('pageerror', lambda e: errs.append(str(e)[:200]))
            time.sleep(5)
            steps(page)
            check('no window errors ' + str(errs[:3]), not errs)
            b.close()
    finally:
        lab.stop(proc)
        unlock_all()


W.mkdir(parents=True, exist_ok=True)
ONLY = __import__('os').environ.get('ONLY')
_run = run
run = lambda name, vault, steps: (None if ONLY and ONLY != name else _run(name, vault, steps))

# --- inside: a locked folder beside an empty one -------------------------------------------
v = seed('vault-inside')
(v / 'Biology' / 'Private stuff').mkdir()
(v / 'Biology' / 'Private stuff' / 'secret.md').write_text('# secret\n')
(v / 'Biology' / 'Empty folder').mkdir()
lock(v / 'Biology' / 'Private stuff')


def inside(page):
    open_folder(page, 'Private stuff')
    open_folder(page, 'Empty folder')
    t = body(page)
    check('the locked folder says "' + LINE + '"', LINE in t)
    check('the empty folder still says "This folder is currently empty"', 'This folder is currently empty' in t)
    shot(page, '1-inside-sidebar', 'aside')
    el = page.locator('p[data-tip]', has_text=LINE).first
    el.hover()
    time.sleep(1.2)
    check('hover shows the approved label', TIP in body(page))
    check('the line has no title attribute', el.get_attribute('title') is None)
    shot(page, '2-inside-hover', 'aside')
    sizes = page.evaluate("""(line) => {
      const p = [...document.querySelectorAll('p')].find(e => e.textContent.trim() === line)
      const sub = document.querySelector('.tree-row .tree-sub')
      const c = (e) => { const s = getComputedStyle(e); return [s.fontSize, s.color, s.fontStyle].join(' ') }
      return { line: c(p), noteSecondLine: c(sub) }
    }""", LINE)
    print('  size/colour/style — the new line:', sizes['line'], '| a note row\'s grey line:', sizes['noteSecondLine'])
    check('same size and colour as a note row\'s grey second line', sizes['line'] == sizes['noteSecondLine'])


run('inside', v, inside)

# --- space: the open space's own folder is locked ------------------------------------------
v = seed('vault-space', extra={'spaces': [{'folder': s} for s in ('Biology', 'Maths', 'Physics', 'Journal')],
                               'activeSpaceFolder': 'Maths'})
lock(v / 'Maths')


def space(page):
    t = body(page)
    check('the space says "' + LINE + '" instead of "No notes yet."', LINE in t and 'No notes yet.' not in t)
    shot(page, '3-space-sidebar', 'aside')


run('space', v, space)

# --- root: the notes folder itself, then a pick of another locked folder, then a good one ----
v = seed('vault-root')
other = seed('vault-other')
good = seed('vault-good')
lock(v)
lock(other)


def root(page):
    t = body(page)
    check('"Choose folder…" says the approved line', VAULT_LINE in t and 'Choose folder' in t)
    shot(page, '4-root-choose-folder')
    answer_picker(other, good)
    page.get_by_text('Choose folder…').click()
    time.sleep(3)
    t = body(page)
    check('after picking another locked folder: back on "Choose folder…", with the line', VAULT_LINE in t)
    shot(page, '5-root-after-locked-pick')
    page.get_by_text('Choose folder…').click()
    time.sleep(4)
    t = body(page)
    check('after picking a good folder: the app opens and the line is gone',
          VAULT_LINE not in t and page.locator('.tree-row').count() > 0)


run('root', v, root)

# --- control: a notes folder that has GONE keeps the plain screen ---------------------------
def gone(page):
    t = body(page)
    check('a folder that has gone: plain "Choose folder…", no line', 'Choose folder' in t and VAULT_LINE not in t)
    shot(page, '6-gone-control')


run('gone', W / 'no-such-folder', gone)

# --- switch: Settings → "Choose a different folder…" answered with a locked folder ----------
v = seed('vault-switch')
other = seed('vault-switch-other')
lock(other)


def switch(page):
    answer_picker(other)
    # the gear: the footer's first button (it carries no words of its own)
    page.evaluate("""() => { const a = document.querySelector('aside'); const bs = [...a.querySelectorAll('button')]
      .filter(b => b.getBoundingClientRect().bottom > a.getBoundingClientRect().bottom - 60)
      .sort((x, y) => x.getBoundingClientRect().left - y.getBoundingClientRect().left); bs[0]?.click() }""")
    time.sleep(1.5)
    for label in ('Data', 'Source folder'):
        page.evaluate("""(l) => [...document.querySelectorAll('button, a, [role=tab]')].find(b => b.textContent.trim() === l)?.click()""", label)
        time.sleep(1)
    btn = page.get_by_text('Choose a different folder…')
    if btn.count() == 0:
        check('found Settings → "Choose a different folder…"', False)
        shot(page, '7-switch-not-found')
        return
    btn.first.click()
    time.sleep(3)
    t = body(page)
    check('after switching to a locked folder: "Choose folder…" with the line', VAULT_LINE in t)
    shot(page, '7-switch-after')


run('switch', v, switch)

print('\nRESULT:', 'all passed' if not fails else f'{len(fails)} failed: {fails}')
print('pictures in', PICS)
