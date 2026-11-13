"""The same real-media check, with the window's page served by the live server (http://localhost), as `npm run dev` does.
Also: can a page READ what it is shown? (it must not).  usage: python3 run_media_guard.py <port> <build dir> [dev]   (APP_BIN=<binary> for a packaged app; run run_media_real.py first — it makes the vault)"""
import json, os, subprocess, sys, time
from pathlib import Path
from playwright.sync_api import sync_playwright
PORT = int(sys.argv[1]); B = Path(sys.argv[2]); DEV = len(sys.argv) > 3
vault = B / 'work' / 'vault-probe'           # made by probe_media.py
ud = B / 'work' / 'ud-dev'
import shutil
if ud.exists(): shutil.rmtree(ud)
ud.mkdir(parents=True); (ud / 'config.json').write_text(json.dumps({'vaultPath': str(vault), 'hasOnboarded': True}))
env = {k: v for k, v in os.environ.items() if k != 'ELECTRON_RUN_AS_NODE'}
if DEV: env['ELECTRON_RENDERER_URL'] = 'http://localhost:5199'
E = Path.home() / 'notes-app-mac/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'
log = open(B / 'work' / 'dev.log', 'w')
APP_BIN = os.environ.get('APP_BIN')
proc = subprocess.Popen(([APP_BIN] if APP_BIN else [str(E), str(B / 'out/main/index.js')]) + [f'--user-data-dir={ud}', f'--remote-debugging-port={PORT}', '--mute-audio'], env=env, stdout=log, stderr=subprocess.STDOUT)
out = {}
try:
    with sync_playwright() as p:
        page = None
        for _ in range(80):
            try:
                b = p.chromium.connect_over_cdp(f'http://127.0.0.1:{PORT}')
                page = next(pg for c in b.contexts for pg in c.pages if pg.url.startswith('http://localhost:5199' if DEV else 'file:'))
                break
            except Exception: time.sleep(0.25)
        out['page'] = page.url.split('?')[0][:40]
        errors = []
        page.on('console', lambda m: errors.append(m.text[:160]) if m.type == 'error' else None)
        page.wait_for_selector('.tree-row', timeout=30000); time.sleep(2)
        page.locator('.tree-title', has_text='Pictures').first.click(); page.wait_for_selector('.cm-image'); time.sleep(2.5)
        out['pictures'] = page.evaluate("() => [...document.querySelectorAll('.cm-image')].map(w => { const i = w.querySelector('img'); return [(i.src || '').split(':')[0], i.naturalWidth, w.classList.contains('cm-image-missing') ? 'MISSING' : 'ok'] })")
        # --- a page may SHOW a vault picture, never READ it
        out['read'] = page.evaluate("""async () => { const img = document.querySelector('.cm-image img'); const url = img.src; const r = {}
          try { const res = await fetch(url); r.fetch = 'READ ' + res.status } catch (e) { r.fetch = 'refused' }
          try { const res = await fetch(url, { mode: 'no-cors' }); r.fetch_nocors = res.type === 'opaque' ? 'opaque (unreadable)' : 'READ ' + res.type } catch (e) { r.fetch_nocors = 'refused' }
          try { const c = document.createElement('canvas'); c.width = 10; c.height = 10; const g = c.getContext('2d'); g.drawImage(img, 0, 0, 10, 10); g.getImageData(0, 0, 1, 1); r.canvas = 'READ pixels' } catch (e) { r.canvas = 'refused (' + e.name + ')' }
          // a guessed address, without this launch's token
          const guess = url.replace(/\\/\\/[0-9a-f]+\\//, '//' + '0'.repeat(32) + '/')
          r.guess = await new Promise(done => { const i = new Image(); i.onload = () => done('LOADED'); i.onerror = () => done('refused'); i.src = guess })
          // straight to a file outside the vault, with the real token
          const out = new URL(url); out.searchParams.set('p', '../../../../../../etc/hosts')
          r.outside = await new Promise(done => { const x = new XMLHttpRequest(); x.onload = () => done('READ ' + x.status); x.onerror = () => done('refused'); try { x.open('GET', out.toString()); x.send() } catch (e) { done('refused') } })
          r.frame = await new Promise(done => { const f = document.createElement('iframe'); f.onload = () => { try { done(f.contentDocument ? 'FRAMED' : 'blocked') } catch { done('blocked') } }; f.onerror = () => done('blocked'); f.src = url; document.body.appendChild(f); setTimeout(() => { f.remove(); done('blocked (never loaded)') }, 1500) })
          return r }""")
        page.locator('.tree-title', has_text='Film').first.click(); page.wait_for_selector('.cm-video video')
        page.wait_for_function("() => [...document.querySelectorAll('.cm-video video')].every(v => v.readyState >= 1 || v.error)", timeout=30000)
        out['film'] = page.evaluate("""async () => { const res = []
          for (const v of document.querySelectorAll('.cm-video video')) { v.muted = true
            await new Promise(done => { v.addEventListener('seeked', done, { once: true }); v.currentTime = 60 }); await v.play(); await new Promise(d => setTimeout(d, 1000)); v.pause()
            res.push([(v.src || '').split(':')[0], v.readyState, +v.currentTime.toFixed(1), v.error && v.error.code]) } return res }""")
        page.locator('.tree-title', has_text='Voice').first.click(); page.wait_for_selector('.cm-voice')
        try: page.wait_for_function("() => [...document.querySelectorAll('.cm-voice')].every(v => v.dataset.state === 'ready')", timeout=20000)
        except Exception: pass
        out['voice'] = page.evaluate("() => [...document.querySelectorAll('.cm-voice')].map(v => v.dataset.state)")
        out['console_errors'] = errors[:8]
        b.close()
finally:
    proc.terminate()
    try: proc.wait(timeout=8)
    except Exception: proc.kill()
for k, v in out.items(): print(' ', k + ':', v)
t = open(B / 'work' / 'dev.log').read()
print('  uncaught in the app log:', sum(t.count(w) for w in ('Uncaught', 'Unhandled')))
