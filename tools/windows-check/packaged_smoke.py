import sys, os, json, time, glob, shutil, subprocess, socket
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import h
from h import *
from swlib import *
from playwright.sync_api import sync_playwright
J = os.path.join
M = J(SP, "media")
EXE = J(SP, "pkg", "win-unpacked", "Notealise.exe")
root = J(SP, "vault-pkg"); shutil.rmtree(root, ignore_errors=True)
w(J(root, "Work", "Pkg.md"), "# Pkg\n\n<audio controls src=\"memo.m4a\"></audio>\n\nhello <video controls src=\"v.mp4\"></video>\n")
shutil.copy(J(M, "memo.m4a"), J(root, "Work", "memo.m4a")); shutil.copy(os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "site", "wordmark.mp4"), J(root, "Work", "v.mp4"))
os.makedirs(J(root, ".mdnotes"), exist_ok=True)
json.dump({"spaces": [{"folder": "Work"}], "activeSpaceFolder": "Work"}, open(J(root, ".mdnotes", "settings.json"), "w"))
ud = J(SP, "ud-pkg"); shutil.rmtree(ud, ignore_errors=True); os.makedirs(ud)
json.dump({"vaultPath": root, "hasOnboarded": True}, open(J(ud, "config.json"), "w"))
env = dict(os.environ); env.pop("ELECTRON_RUN_AS_NODE", None)
proc = subprocess.Popen([EXE, f"--user-data-dir={ud}", "--remote-debugging-port=9531", "--mute-audio", "--use-fake-device-for-media-stream", "--use-file-for-fake-audio-capture=" + J(M, "speech.wav")], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
for _ in range(60):
    try: socket.create_connection(("127.0.0.1", 9531), 0.3).close(); break
    except OSError: time.sleep(0.5)
time.sleep(3)
errs = []
try:
    with sync_playwright() as p:
        b = p.chromium.connect_over_cdp("http://127.0.0.1:9531"); pg = b.contexts[0].pages[0]
        pg.on("pageerror", lambda e: errs.append(str(e))); pg.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
        time.sleep(1.5)
        print("PKG packaged:", pg.evaluate("location.protocol + ' ' + document.title"), "| sidebar rows:", pg.locator('.tree-title').count())
        pg.locator('aside .tree-row', has=pg.locator('.tree-title', has_text="Pkg")).first.click(); time.sleep(3.0)
        print("PKG voice block:", pg.evaluate("[...document.querySelectorAll('.cm-voice')].map(v=>[v.getAttribute('data-state'), (v.querySelector('.cm-voice-seek')||{}).max])"),
              "| video:", pg.evaluate("[...document.querySelectorAll('video')].map(v=>[v.readyState, v.videoWidth, !!v.error])"))
        pg.locator('.cm-content').first.click(); pg.keyboard.press('Control+End'); pg.keyboard.press('Enter'); pg.keyboard.type('/voice'); time.sleep(0.8); pg.keyboard.press('Enter'); time.sleep(1.0)
        pg.locator("button:visible", has_text="Start recording").first.click(); time.sleep(3.5)
        live = pg.evaluate("!!document.querySelector('.cm-voice-rec.is-live')")
        status = pg.evaluate("(document.querySelector('.cm-voice-rec-status')||{}).innerText")
        print("PKG recording live (the microphone rule allowed the app's own page):", live, "| status:", status)
        pg.locator("button:visible", has_text="Stop").first.click(); time.sleep(3.0)
        print("PKG recorded files:", [os.path.basename(x) for x in glob.glob(J(root, "Work", "Voice note *"))])
        # CSP: a script from outside must not run
        print("PKG csp blocks an inline script:", pg.evaluate("(() => { try { const s = document.createElement('script'); s.textContent = 'window.__x = 1'; document.head.appendChild(s); return window.__x !== 1 } catch (e) { return true } })()"))
        print("PKG fuses: node integration off:", pg.evaluate("typeof require === 'undefined' && typeof process === 'undefined'"))
        print("PKG errors:", errs[:4])
        b.close()
finally:
    subprocess.run(["taskkill", "/PID", str(proc.pid), "/T", "/F"], capture_output=True)
