"""Can the media address be put in a FRAME (it must not)? Looks at what the frame really holds. usage: python3 run_media_frame.py <port> <build dir> [dev]"""
import json, os, subprocess, sys, time, shutil
from pathlib import Path
from playwright.sync_api import sync_playwright
PORT = int(sys.argv[1]); B = Path(sys.argv[2]); DEV = len(sys.argv) > 3
vault = B / 'work' / 'vault-probe'; ud = B / 'work' / 'ud-dev'
if ud.exists(): shutil.rmtree(ud)
ud.mkdir(parents=True); (ud / 'config.json').write_text(json.dumps({'vaultPath': str(vault), 'hasOnboarded': True}))
# an HTML file and an SVG with a script in the vault: the worst thing a frame could be pointed at
(vault / 'Media' / 'page.html').write_text('<html><body><h1 id="x">VAULT HTML RAN</h1><script>document.title="SCRIPT RAN"</script></body></html>')
(vault / 'Media' / 'Lure.md').write_text('# Lure\n\n![](page.html)\n\n![](drawing.svg)\n\nEnd.\n')
env = {k: v for k, v in os.environ.items() if k != 'ELECTRON_RUN_AS_NODE'}
if DEV: env['ELECTRON_RENDERER_URL'] = 'http://localhost:5199'
E = Path.home() / 'notes-app-mac/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'
proc = subprocess.Popen([str(E), str(B / 'out/main/index.js'), f'--user-data-dir={ud}', f'--remote-debugging-port={PORT}', '--mute-audio'], env=env, stdout=open(B / 'work' / 'frame.log', 'w'), stderr=subprocess.STDOUT)
try:
    with sync_playwright() as p:
        page = None
        for _ in range(80):
            try:
                b = p.chromium.connect_over_cdp(f'http://127.0.0.1:{PORT}')
                page = next(pg for c in b.contexts for pg in c.pages if pg.url.startswith('http://localhost:5199' if DEV else 'file:')); break
            except Exception: time.sleep(0.25)
        page.wait_for_selector('.tree-row', timeout=30000); time.sleep(2)
        page.locator('.tree-title', has_text='Lure').first.click(); page.wait_for_selector('.cm-image'); time.sleep(2)
        r = page.evaluate("""async () => { const html = [...document.querySelectorAll('.cm-image img')].map(i => i.src).find(s => s.includes('page.html'))
          const out = { html_address: !!html }
          const viol = []; document.addEventListener('securitypolicyviolation', e => viol.push(e.violatedDirective + ' ' + e.blockedURI.slice(0, 22)))
          const tryIn = (tag, attr) => new Promise(done => { const f = document.createElement(tag); let fired = 'no load event'
            f.onload = () => { fired = 'load event' }; f.onerror = () => { fired = 'error event' }
            f[attr] = html; document.body.appendChild(f)
            setTimeout(() => { let inside = 'unreadable'
              try { const d = f.contentDocument; inside = d ? JSON.stringify({ url: d.URL.slice(0, 30), title: d.title, text: (d.body ? d.body.innerText : '').slice(0, 30) }) : 'no document' } catch (e) { inside = 'cross-origin (' + e.name + ')' }
              f.remove(); done(fired + ' | holds: ' + inside) }, 1500) })
          out.iframe = await tryIn('iframe', 'src')
          out.object = await tryIn('object', 'data')
          out.embed = await tryIn('embed', 'src')
          out.script = await new Promise(done => { const s = document.createElement('script'); s.onload = () => done('RAN'); s.onerror = () => done('refused'); s.src = html; document.head.appendChild(s) })
          out.stylesheet = await new Promise(done => { const l = document.createElement('link'); l.rel = 'stylesheet'; l.onload = () => done('LOADED'); l.onerror = () => done('refused'); l.href = html; document.head.appendChild(l) })
          out.title_now = document.title
          out.violations = viol
          return out }""")
        for k, v in r.items(): print(' ', k + ':', v)
        print('  frames in the page afterwards:', [f.url[:40] for f in page.frames])
        b.close()
finally:
    proc.terminate()
    try: proc.wait(timeout=8)
    except Exception: proc.kill()
