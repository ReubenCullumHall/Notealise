"""Bug-scan fixes, the Windows-only half: real keys with Settings open, minimum window size, a folder renamed while typing,
a file held open by another program, quitting while a save keeps failing, a cut-off settings file, a video called Reuben's holiday.mp4."""
import sys, os, json, time, glob, shutil, subprocess, ctypes
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from h import *
from swlib import *
from playwright.sync_api import sync_playwright

J = os.path.join
R = Results()
REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

def vault(name, files):
    root = J(SP, name); shutil.rmtree(root, ignore_errors=True)
    for rel, txt in files.items(): w(J(root, *rel.split("/")), txt)
    os.makedirs(J(root, ".mdnotes"), exist_ok=True)
    json.dump({"spaces": [{"folder": "Work"}], "activeSpaceFolder": "Work"}, open(J(root, ".mdnotes", "settings.json"), "w"))
    return root

def keys_for(app):
    k = Keys.__new__(Keys); k.pid = app.proc.pid; k.h = find_hwnd(k.pid); return k

def hold_open(path):
    """Open a file the way a program that blocks renames/deletes does: read+write share, NOT delete."""
    k32 = ctypes.windll.kernel32
    k32.CreateFileW.restype = ctypes.c_void_p
    h = k32.CreateFileW(path, 0x80000000, 0x1 | 0x2, None, 3, 0x80, None)   # GENERIC_READ, share read|write only, OPEN_EXISTING
    return h

# ---------------------------------------------------------------- f, g : Settings open + minimum window size
root = vault("vault-bsb1", {"Work/One.md": "# One\n\nfirst\n", "Work/Two.md": "# Two\n\nsecond\n"})
app = App("bsb1", root, port=9481, extra=["--mute-audio"]); app.start()
with sync_playwright() as p:
    pg = app.connect(p); k = keys_for(app); time.sleep(1.5)
    try:
        pg.locator('aside .tree-row', has=pg.locator('.tree-title', has_text="One")).first.click(); time.sleep(0.6)
        pg.locator('aside .tree-row', has=pg.locator('.tree-title', has_text="Two")).first.click(); time.sleep(0.6)
        tabs = lambda: pg.evaluate("[...document.querySelectorAll('[role=tab]')].map(e=>e.innerText.trim())")
        before = tabs(); files_before = sorted(os.listdir(J(root, "Work")))
        pg.locator('button[data-tip="Settings"]').first.click(); time.sleep(1.2)
        k.focus()
        for mods, key in [(['ctrl'], 'w'), (['ctrl'], 'tab'), (['ctrl'], 'n')]:
            k.chord(mods, key); time.sleep(0.7)
        pg.keyboard.press('Control+1'); time.sleep(0.4)
        pg.keyboard.press('Escape'); time.sleep(0.8)
        after = tabs(); files_after = sorted(os.listdir(J(root, "Work")))
        R.add("f real Ctrl+W / Ctrl+Tab / Ctrl+1 with Settings open change no tab", before == after, f"{before} -> {after}")
        R.add("f real Ctrl+N with Settings open makes no note", files_before == files_after, f"{files_before} -> {files_after}")
        # g minimum size
        U = ctypes.windll.user32
        resize_window(k.h, 300, 200)
        time.sleep(0.8)
        import ctypes.wintypes as wt
        r = wt.RECT(); U.GetWindowRect(k.h, ctypes.byref(r)); wd, ht = r.right - r.left, r.bottom - r.top
        cw = pg.evaluate("[innerWidth, innerHeight]")
        R.add("g window stops at about 640 x 420", wd >= 620 and ht >= 400, f"outer {wd}x{ht}, inside {cw} (asked for 300x200)")
        R.add("f/g no console errors", not app.errors, str(app.errors[:2]))
    finally:
        k.release_all(); app.stop()

# ---------------------------------------------------------------- Windows paths
# W1 folder renamed outside the app while typing
root = vault("vault-bsb2", {"Work/Sub/Typed.md": "# Typed\n\nstart\n", "Work/Other.md": "# Other\n"})
app = App("bsb2", root, port=9482, extra=["--mute-audio"]); app.start()
with sync_playwright() as p:
    pg = app.connect(p); time.sleep(1.5)
    try:
        pg.locator('aside .tree-row', has=pg.locator('.tree-title', has_text="Sub")).first.click(); time.sleep(0.8)   # opens the folder
        pg.locator('aside .tree-row', has=pg.locator('.tree-title', has_text="Typed")).first.click(); time.sleep(1.0)
        pg.locator('.cm-line', has_text='start').first.click(); pg.keyboard.press('End')
        pg.keyboard.type(" TYPED-WHILE-RENAMED")
        t0 = time.time()
        rn = subprocess.run(["powershell", "-NoProfile", "-Command", f"Rename-Item -LiteralPath '{J(root,'Work','Sub')}' -NewName 'Sub2'"], capture_output=True, text=True)
        R.add("W1 the folder could be renamed in PowerShell while the app has it open", rn.returncode == 0, (rn.stderr or "")[:140])
        time.sleep(4.0)
        moved = J(root, "Work", "Sub2", "Typed.md")
        txt = open(moved, encoding="utf-8").read() if os.path.exists(moved) else None
        msg = pg.evaluate("document.body.innerText").count("Save failed")
        R.add("W1 typing while the folder is renamed lands in the note at its new place", bool(txt) and "TYPED-WHILE-RENAMED" in txt and not os.path.exists(J(root, "Work", "Sub")), repr(txt)[:80])
        R.add("W1 no 'Save failed' message", msg == 0, f"{msg}")
    finally:
        app.stop()

# W2 a note held open by another program: Move to bin
root = vault("vault-bsb3", {"Work/Held.md": "# Held\n\nheld text\n", "Work/Free.md": "# Free\n"})
app = App("bsb3", root, port=9483, extra=["--mute-audio"]); app.start()
with sync_playwright() as p:
    pg = app.connect(p); time.sleep(1.5)
    h = None
    try:
        pg.locator('aside .tree-row', has=pg.locator('.tree-title', has_text="Held")).first.click(); time.sleep(1.0)
        h = hold_open(J(root, "Work", "Held.md"))
        pg.locator('aside .tree-row', has=pg.locator('.tree-title', has_text="Held")).first.click(button='right'); time.sleep(0.5)
        pg.get_by_text("Move to bin", exact=False).last.click(); time.sleep(2.0)
        body = pg.evaluate("document.body.innerText")
        tabs = pg.evaluate("[...document.querySelectorAll('[role=tab]')].map(e=>e.innerText.trim())")
        R.add("W2 a held file: Move to bin says it could not", ("Couldn" in body and "bin" in body), [l for l in body.split(chr(10)) if "bin" in l.lower()][:2].__repr__())
        R.add("W2 ...the tab stays open and the file is still there", any("Held" in t for t in tabs) and os.path.exists(J(root, "Work", "Held.md")), str(tabs))

        # W3 type, the save keeps failing (file still held), quit -> Recovered note
        pg.locator('.cm-line', has_text='held text').first.click(); pg.keyboard.press('End'); pg.keyboard.type(" UNSAVED-TYPING")
        time.sleep(2.5)
        failed = "Save failed" in pg.evaluate("document.body.innerText")
        # quit through the window's own close button handler
        ctypes.windll.user32.PostMessageW(find_hwnd(app.proc.pid), 0x0010, 0, 0)   # WM_CLOSE: the window's x
        for _ in range(24):
            time.sleep(0.5)
            if app.proc.poll() is not None: break
        rec = glob.glob(J(root, "Recovered - *.md"))
        txt = open(rec[0], encoding="utf-8").read() if rec else ""
        R.add("W3 save keeps failing while held: the app says so", failed, "")
        R.add("W3 quitting keeps the typing in a 'Recovered - ...' note at the top of the vault", bool(rec) and "UNSAVED-TYPING" in txt, str([os.path.basename(r) for r in rec]))
    finally:
        if h: ctypes.windll.kernel32.CloseHandle(ctypes.c_void_p(h))
        app.stop()

# W4 settings.json cut in half before launch
root = vault("vault-bsb4", {"Work/N.md": "# N\n"})
sj = J(root, ".mdnotes", "settings.json")
full = json.dumps({"spaces": [{"folder": "Work", "emoji": "x"}], "activeSpaceFolder": "Work", "theme": "dark"})
open(sj, "w").write(full[: len(full) // 2])
app = App("bsb4", root, port=9484, extra=["--mute-audio"]); app.start()
with sync_playwright() as p:
    try:
        pg = app.connect(p); time.sleep(2.0)
        dam = glob.glob(J(root, ".mdnotes", "settings.damaged-*.json"))
        R.add("W4 a cut-off settings.json is kept as settings.damaged-*.json and the app opens", bool(dam) and pg.locator('.tree-title').count() >= 0 and not app.errors, str([os.path.basename(d) for d in dam]) + " " + str(app.errors[:1]))
    finally:
        app.stop()

# W5 a video called Reuben's holiday.mp4, written the way the app writes one
root = vault("vault-bsb5", {"Work/Vid.md": "x"})
shutil.copy(os.path.join(REPO, "site", "wordmark.mp4"), J(root, "Work", "Reuben's holiday.mp4"))
w(J(root, "Work", "Vid.md"), "# Vid\n\n<video controls src=\"Reuben's holiday.mp4\"></video>\n\nafter\n")
app = App("bsb5", root, port=9485, extra=["--mute-audio"]); app.start()
with sync_playwright() as p:
    try:
        pg = app.connect(p); time.sleep(1.5)
        pg.locator('aside .tree-row', has=pg.locator('.tree-title', has_text="Vid")).first.click(); time.sleep(3.0)
        st = pg.evaluate("[...document.querySelectorAll('video')].map(v=>[v.readyState, v.videoWidth, !!v.error])")
        R.add("W5 a video file named with an apostrophe is shown and loads", bool(st) and st[0][0] >= 1 and not st[0][2], str(st))
    finally:
        app.stop()
print()
