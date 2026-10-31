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



def quit_test(label, how):
    root = vault("vault-q" + label, {"Work/Plain.md": "# Plain\n\nbase\n"})
    app = App("q" + label, root, port=9490, extra=["--mute-audio", "--inspect=9491"]); app.start()
    with sync_playwright() as p:
        pg = app.connect(p); time.sleep(1.5)
        pg.locator('aside .tree-row', has=pg.locator('.tree-title', has_text="Plain")).first.click(); time.sleep(1.0)
        pg.locator('.cm-line', has_text='base').first.click(); pg.keyboard.press('End'); pg.keyboard.type(" TYPED-JUST-BEFORE-" + label)
        time.sleep(0.05)
        if how == "x":
            ctypes.windll.user32.PostMessageW(find_hwnd(app.proc.pid), 0x0010, 0, 0)
        else:
            r = subprocess.run(["node", os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "tools", "archive-check", "menu.mjs"), "9491", "File", how], capture_output=True, text=True)
            print("  menu click:", r.stdout.strip()[:100], r.stderr.strip()[:100])
        for i in range(20):
            time.sleep(0.4)
            if app.proc.poll() is not None: break
        txt = open(J(root, "Work", "Plain.md"), encoding="utf-8").read()
        print(label, "-> exited:", app.proc.poll() is not None, "| file has the typing:", ("TYPED-JUST-BEFORE-" + label) in txt, "|", repr(txt[-40:]))
        app.stop()
quit_test("X", "x")
quit_test("Exit", "Exit")
