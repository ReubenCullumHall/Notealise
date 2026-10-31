"""Voice notes on Windows: pasting sound files of many kinds, recording with a fake microphone, closing mid-recording."""
import sys, os, json, time, glob, shutil, ctypes
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from h import *
from swlib import *
from playwright.sync_api import sync_playwright

J = os.path.join
M = J(SP, "media")
part = sys.argv[1]

def vault(name, files):
    root = os.environ.get("VROOT") or J(SP, name); shutil.rmtree(root, ignore_errors=True)
    for rel, txt in files.items(): w(J(root, *rel.split("/")), txt)
    os.makedirs(J(root, ".mdnotes"), exist_ok=True)
    json.dump({"spaces": [{"folder": "Work"}], "activeSpaceFolder": "Work"}, open(J(root, ".mdnotes", "settings.json"), "w"))
    return root

def keys_for(app):
    k = Keys.__new__(Keys); k.pid = app.proc.pid; k.h = find_hwnd(k.pid); return k

def open_note(pg, name):
    pg.locator('aside .tree-row', has=pg.locator('.tree-title', has_text=name)).first.click(); time.sleep(1.0)

FAKE = ["--mute-audio", "--use-fake-device-for-media-stream", "--use-file-for-fake-audio-capture=" + J(M, "speech.wav")]

if part == "paste":
    root = vault("vault-vp", {"Work/Paste.md": "# Paste\n\n"})
    app = App("vp", root, port=9501, extra=["--mute-audio"]); app.start()
    shutil.copy(J(M, "memo.m4a"), J(M, "Réunion 14.32 (2).m4a"))
    with sync_playwright() as p:
        pg = app.connect(p); k = keys_for(app); time.sleep(1.5)
        try:
            open_note(pg, "Paste")
            before = set(os.listdir(J(root, "Work")))
            for name in ["memo.m4a", "Réunion 14.32 (2).m4a", "speech.mp3", "speech.flac", "speech.wav", "speech.wma", "phone-ulaw.wav"]:
                n0 = pg.locator('.cm-voice').count()
                pg.locator('.cm-content').first.click(); pg.keyboard.press('Control+End'); pg.keyboard.press('Enter'); pg.keyboard.press('Enter')
                set_clip_files([J(M, name)]); time.sleep(0.4)
                k.focus(); t0 = time.time()
                k.chord(['ctrl'], 'v')
                state = None
                for i in range(80):
                    time.sleep(0.25)
                    c = pg.locator('.cm-voice').count()
                    if c > n0:
                        st = pg.evaluate("(n) => { const v = document.querySelectorAll('.cm-voice')[n]; const s = v.querySelector('.cm-voice-seek'); return [v.getAttribute('data-state'), s ? +(+s.max).toFixed(2) : null, v.innerText.slice(0,60).split(String.fromCharCode(10)).join(' / ')] }", n0)
                        if st[0] in ("ready", "error", "missing", "unplayable") or i > 70: state = st; break
                took = time.time() - t0
                files = sorted(set(os.listdir(J(root, "Work"))) - before)
                print(f"PASTE {name!r}: block={state} after {took:.1f}s; new files={files}", flush=True)
                before |= set(files)
            tmp = [d for d in os.listdir(os.environ["TEMP"]) if d.startswith("notealise-voice-")]
            print("PASTE leftover converter folders in %TEMP%:", tmp)
            print("PASTE note text:", repr(open(J(root, "Work", "Paste.md"), encoding="utf-8").read()[:600]))
            print("PASTE errors:", app.errors[:3])
        finally:
            k.release_all(); app.stop()

if part == "record":
    root = vault("vault-vr", {"Work/Rec.md": "# Rec\n\nstart\n\n"})
    app = App("vr", root, port=9502, extra=FAKE); app.start()
    with sync_playwright() as p:
        pg = app.connect(p); k = keys_for(app); time.sleep(1.5)
        try:
            open_note(pg, "Rec")
            def slash_voice():
                pg.locator('.cm-content').first.click(); pg.keyboard.press('Control+End'); pg.keyboard.press('Enter')
                pg.keyboard.type('/voice'); time.sleep(0.8)
                items = pg.evaluate("[...document.querySelectorAll('.cm-tooltip-autocomplete li')].map(e=>e.innerText.trim())")
                pg.keyboard.press('Enter'); time.sleep(1.0)
                return items
            before_text = open(J(root, "Work", "Rec.md"), encoding="utf-8").read()
            items = slash_voice()
            print("REC slash menu:", items)
            panel = pg.evaluate("[...document.querySelectorAll('button')].map(b=>b.innerText.trim()).filter(t=>/record|cancel|stop|pause|resume/i.test(t))")
            print("REC panel buttons:", panel)
            print("REC panel html:", pg.evaluate("(() => { const b = [...document.querySelectorAll('button')].find(b => /start recording/i.test(b.innerText)); const p = b && b.closest('[class*=voice]'); return p ? p.outerHTML.slice(0, 900) : 'no panel' })()"))
            # Cancel
            pg.locator('button:visible', has_text="Cancel").first.click(); time.sleep(0.8)
            after_text = open(J(root, "Work", "Rec.md"), encoding="utf-8").read()
            print("REC after Cancel: note text same:", pg.evaluate("document.querySelector('.cm-content').innerText.includes('/voice')") is False, "| file:", repr(after_text[-30:]))
            # record
            slash_voice()
            pg.locator("button:visible", has_text="Start recording").first.click(); time.sleep(3.2)
            cls = pg.evaluate("[...document.querySelectorAll('[class*=rec]')].map(e=>e.className.toString().slice(0,50)).slice(0,12)")
            bars = pg.evaluate("document.querySelectorAll('[class*=rec] [class*=bar]').length")
            print("REC at 3s: elements", cls, "bars", bars)
            print("REC panel buttons now:", pg.evaluate("[...document.querySelectorAll('button')].map(b=>b.innerText.trim()).filter(t=>/record|cancel|stop|pause|resume/i.test(t))"))
            pg.locator("button:visible", has_text="Pause").first.click(); time.sleep(0.6)
            pg.locator("button:visible", has_text="Resume").first.click(); time.sleep(1.2)
            pg.locator("button:visible", has_text="Stop").first.click(); time.sleep(3.0)
            m4a = glob.glob(J(root, "Work", "Voice note *.*"))
            print("REC after Stop: files", [os.path.basename(x) for x in m4a], [os.path.getsize(x) for x in m4a])
            print("REC block:", pg.evaluate("[...document.querySelectorAll('.cm-voice')].map(v=>[v.getAttribute('data-state'), (v.querySelector('.cm-voice-seek')||{}).max])"))
            print("REC note line:", [l for l in open(J(root, "Work", "Rec.md"), encoding="utf-8").read().split(chr(10)) if "audio" in l])
            print("REC errors:", app.errors[:3])
        finally:
            k.release_all(); app.stop()

if part == "closemid":
    root = vault("vault-vc", {"Work/Close.md": "# Close\n\nstart\n\n"})
    app = App("vc", root, port=9503, extra=FAKE); app.start()
    with sync_playwright() as p:
        pg = app.connect(p); k = keys_for(app); time.sleep(1.5)
        try:
            open_note(pg, "Close")
            pg.locator('.cm-content').first.click(); pg.keyboard.press('Control+End'); pg.keyboard.press('Enter'); pg.keyboard.type('/voice'); time.sleep(0.8); pg.keyboard.press('Enter'); time.sleep(1.0)
            pg.locator("button:visible", has_text="Start recording").first.click(); time.sleep(3.0)
            t0 = time.time()
            ctypes.windll.user32.PostMessageW(k.h, 0x0010, 0, 0)       # the window's x
            for i in range(60):
                time.sleep(0.25)
                if app.proc.poll() is not None: break
            print("CLOSE-MID app exited:", app.proc.poll() is not None, "after %.1fs" % (time.time() - t0))
        finally:
            k.release_all(); app.stop()
    m4a = glob.glob(J(root, "Work", "Voice note *.*"))
    print("CLOSE-MID files:", [(os.path.basename(x), os.path.getsize(x)) for x in m4a])
    print("CLOSE-MID note:", repr(open(J(root, "Work", "Close.md"), encoding="utf-8").read()[-120:]))
    # relaunch on the same profile
    app = App("vc", root, port=9503, extra=["--mute-audio"]); app.start(fresh=False)
    with sync_playwright() as p:
        pg = app.connect(p); time.sleep(1.5)
        try:
            open_note(pg, "Close"); time.sleep(2.0)
            print("CLOSE-MID after reopening:", pg.evaluate("[...document.querySelectorAll('.cm-voice')].map(v=>[v.getAttribute('data-state'), (v.querySelector('.cm-voice-seek')||{}).max])"))
        finally:
            app.stop()

if part == "damaged":
    import random
    random.seed(7); open(J(M, "broken.wma"), "wb").write(bytes(random.getrandbits(8) for _ in range(6000)))
    long_dir = J(SP, "vault-vlong-" + "d" * 150)
    os.environ["VROOT"] = long_dir
    root = vault("x", {"Work/Dmg.md": "# Dmg" + chr(10) + chr(10)})
    print("DMG vault path length:", len(root))
    app = App("vd", root, port=9503, extra=["--mute-audio"]); app.start()
    tmpdirs = lambda: [d for d in os.listdir(os.environ["TEMP"]) if d.startswith("notealise-voice-")]
    with sync_playwright() as p:
        pg = app.connect(p); k = keys_for(app); time.sleep(1.5)
        try:
            open_note(pg, "Dmg")
            for name in ["broken.wma", "speech.wma"]:
                n0 = pg.locator('.cm-voice').count()
                pg.locator('.cm-content').first.click(); pg.keyboard.press('Control+End'); pg.keyboard.press('Enter')
                set_clip_files([J(M, name)]); time.sleep(0.4); k.focus(); k.chord(['ctrl'], 'v')
                msgs = set(); t0 = time.time()
                while time.time() - t0 < 40:
                    time.sleep(0.3)
                    body = pg.evaluate("document.body.innerText")
                    for l in body.split(chr(10)):
                        if "onvert" in l or "amaged" in l or "Couldn" in l: msgs.add(l.strip()[:90])
                    if pg.locator('.cm-voice').count() > n0 and pg.locator('.cm-voice[data-state=ready]').count() > n0: break
                    if any("Couldn" in m for m in msgs): time.sleep(1.0); break
                time.sleep(1.5)
                print(f"DMG {name}: blocks {pg.locator('.cm-voice').count()} (was {n0}); messages {sorted(msgs)}; took {time.time()-t0:.1f}s; files {sorted(os.listdir(J(root, 'Work')))}; leftover temp {tmpdirs()}", flush=True)
            print("DMG note text:", repr(open(J(root, "Work", "Dmg.md"), encoding="utf-8").read()[-160:]))
        finally:
            k.release_all(); app.stop()
            shutil.rmtree(long_dir, ignore_errors=True)
