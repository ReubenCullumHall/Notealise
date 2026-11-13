"""A long recording playing while its folder is renamed (outside the app), and while the note is binned.
usage: WORK=.. python3 run_voice_rename.py <port>"""
import json, os, shutil, sys, time
from pathlib import Path
from playwright.sync_api import sync_playwright
import lab
PORT = int(sys.argv[1]); FIX = lab.WORK / 'fix'  # made by make_media.sh
WORK = lab.WORK / 'work'; vault = WORK / 'vault-rename'
if vault.exists(): shutil.rmtree(vault)
(vault / 'Media' / 'Talks').mkdir(parents=True); (vault / '.mdnotes').mkdir()
(vault / '.mdnotes' / 'settings.json').write_text(json.dumps({'spaces': [{'folder': 'Media'}], 'activeSpaceFolder': 'Media', 'playStartupAnimation': False}))
shutil.copy(FIX / 'long.m4a', vault / 'Media' / 'Talks' / 'long.m4a')
(vault / 'Media' / 'Talks' / 'Lecture.md').write_text('# Lecture\n\nAbove.\n\n<audio controls src="long.m4a"></audio>\n\nEnd.\n')
(vault / 'Media' / 'Plain.md').write_text('# Plain\n\nNothing.\n')
ud = WORK / 'ud-rename'; lab.profile(ud, vault)
proc, _ = lab.launch(ud, PORT, WORK / 'rename.log')
STATE = """() => { const t = window.__taps[0]; const d = new Float32Array(2048); t.an.getFloatTimeDomainData(d)
  let peak = 0; for (const x of d) peak = Math.max(peak, Math.abs(x))
  const b = t.el.buffered; return { t: +t.el.currentTime.toFixed(1), paused: t.el.paused, peak: +peak.toFixed(3), err: t.el.error && t.el.error.code,
    buffered: [...Array(b.length).keys()].map(i => [Math.round(b.start(i)), Math.round(b.end(i))]),
    blocks: [...document.querySelectorAll('.cm-voice')].map(v => v.dataset.state), deck: !!document.querySelector('.deck') } }"""
try:
    with sync_playwright() as p:
        b, page = lab.connect(p, PORT)
        page.wait_for_selector('.tree-row', timeout=30000); time.sleep(2)
        page.evaluate("""() => { window.__taps = []; const orig = AudioContext.prototype.createMediaElementSource
          AudioContext.prototype.createMediaElementSource = function (el) { const src = orig.call(this, el); const an = this.createAnalyser(); an.fftSize = 2048; src.connect(an); window.__taps.push({ an, el }); return src } }""")
        page.locator('.tree-title', has_text='Talks').first.click(); time.sleep(0.5)
        page.locator('.tree-title', has_text='Lecture').first.click()
        page.wait_for_function("() => document.querySelector('.cm-voice')?.dataset.state === 'ready'", timeout=30000)
        page.locator('.cm-voice-play').first.click(); time.sleep(3)
        print(' playing:', page.evaluate(STATE))
        # rename the folder from outside the app, as Finder or OneDrive would
        os.rename(vault / 'Media' / 'Talks', vault / 'Media' / 'Talks renamed')
        time.sleep(5)
        print(' 5 s after the folder was renamed outside:', page.evaluate(STATE))
        # jump far ahead — past anything already buffered
        page.evaluate("() => { window.__taps[0].el.currentTime = 3000 }"); time.sleep(4)
        print(' after jumping to 50:00:', page.evaluate(STATE))
        time.sleep(8)
        print(' 8 s later:', page.evaluate(STATE))
        print(' taps:', page.evaluate("() => window.__taps.length"), ' block text:', page.evaluate("() => [...document.querySelectorAll('.cm-voice')].map(v => v.innerText.replace(/\\s+/g,' ').slice(0,90))"))
        b.close()
finally:
    lab.stop(proc)
print('main log tail:', open(WORK / 'rename.log').read()[-300:])
