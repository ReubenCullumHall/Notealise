"""Does real media still show, play, seek and SOUND? Run against the before and the after build.
   usage: WORK=<build dir> python3 run_media_real.py <port>   (after make_media.sh)"""
import json, os, shutil, sys, time
from pathlib import Path
from playwright.sync_api import sync_playwright
import lab

PORT = int(sys.argv[1])
FIX = lab.WORK / 'fix'  # made by make_media.sh
WORK = lab.WORK / 'work'
vault = WORK / 'vault-probe'
if vault.exists():
    shutil.rmtree(vault)
m = vault / 'Media'
m.mkdir(parents=True)
(vault / '.mdnotes').mkdir()
(vault / '.mdnotes' / 'settings.json').write_text(json.dumps({'spaces': [{'folder': 'Media'}], 'activeSpaceFolder': 'Media', 'playStartupAnimation': False}))
shutil.copy(FIX / 'photo.png', m / 'photo.png')
shutil.copy(FIX / 'photo.jpg', m / "Café #1 (50%) Reuben's [draft] $5.jpg")
shutil.copy(FIX / 'photo.png', m / 'noext')
shutil.copy(FIX / 'photo.jpg', m / 'wrong.dat')
shutil.copy(FIX / 'drawing.svg', m / 'drawing.svg')
shutil.copy(FIX / 'film.mp4', m / 'film.mp4')
shutil.copy(FIX / 'film-fast.mp4', m / 'film fast #2.mp4')
shutil.copy(FIX / 'memo.m4a', m / 'memo.m4a')
shutil.copy(FIX / 'memo.webm', m / 'memo two.webm')
(m / 'Pictures.md').write_text('\n'.join([
    '# Pictures', '', '![](photo.png)', '', "![](Caf%C3%A9%20%231%20%2850%25%29%20Reuben's%20%5Bdraft%5D%20%245.jpg)", '',
    '![](noext)', '', '![](wrong.dat)', '', '![](drawing.svg)', '', '![](gone.png)', '', 'End.', '']))
(m / 'Film.md').write_text('\n'.join(['# Film', '', '<video controls src="film.mp4"></video>', '', 'Between.', '',
                                       '<video controls src="film%20fast%20%232.mp4"></video>', '', 'End.', '']))
(m / 'Voice.md').write_text('\n'.join(['# Voice', '', 'Above.', '', '<audio controls src="memo.m4a"></audio>', '', 'Between.', '',
                                        '<audio controls src="memo%20two.webm"></audio>', '', 'End.', '']))
(m / 'Plain.md').write_text('# Plain\n\nNothing here.\n')
ud = WORK / 'ud-probe'
lab.profile(ud, vault)
proc, _ = lab.launch(ud, PORT, WORK / 'probe.log')
out = {}
try:
    with sync_playwright() as p:
        b, page = lab.connect(p, PORT)
        errors = []
        page.on('console', lambda msg: errors.append(msg.text) if msg.type in ('error', 'warning') else None)
        page.on('pageerror', lambda e: errors.append('PAGEERROR ' + str(e)))
        page.wait_for_selector('.tree-row', timeout=30000)
        time.sleep(2)
        # tap every Web Audio source so the SOUND going through the mixer can be measured
        page.evaluate("""() => {
          window.__taps = []
          const orig = AudioContext.prototype.createMediaElementSource
          AudioContext.prototype.createMediaElementSource = function (el) {
            const src = orig.call(this, el)
            const an = this.createAnalyser(); an.fftSize = 2048
            src.connect(an)
            window.__taps.push({ an, el })
            return src
          }
        }""")

        # --- pictures
        t0 = time.time()
        page.locator('.tree-title', has_text='Pictures').first.click()
        page.wait_for_selector('.cm-image')
        time.sleep(2.5)
        out['pictures'] = page.evaluate("""() => [...document.querySelectorAll('.cm-image')].map(w => { const i = w.querySelector('img');
            return { scheme: (i.src || '').split(':')[0], w: i.naturalWidth, missing: w.classList.contains('cm-image-missing') } })""")

        # --- film
        page.locator('.tree-title', has_text='Film').first.click()
        page.wait_for_selector('.cm-video video')
        t0 = time.time()
        page.wait_for_function("() => [...document.querySelectorAll('.cm-video video')].every(v => v.readyState >= 1 || v.error)", timeout=30000)
        out['film_meta_s'] = round(time.time() - t0, 2)
        out['film'] = page.evaluate("""async () => { const res = []
          for (const v of document.querySelectorAll('.cm-video video')) {
            const r = { scheme: (v.src || '').split(':')[0], ready: v.readyState, dur: +v.duration.toFixed(1), w: v.videoWidth, err: v.error && v.error.message }
            if (!v.error) {
              v.muted = true
              const t0 = performance.now()
              await new Promise(done => { v.addEventListener('seeked', done, { once: true }); v.currentTime = 70 })
              r.seek_ms = Math.round(performance.now() - t0)
              await v.play(); await new Promise(d => setTimeout(d, 1500)); v.pause()
              r.after_play = +v.currentTime.toFixed(2)
              const t1 = performance.now()
              await new Promise(done => { v.addEventListener('seeked', done, { once: true }); v.currentTime = 5 })
              r.seek_back_ms = Math.round(performance.now() - t1)
              r.buffered = [...Array(v.buffered.length).keys()].map(i => [+v.buffered.start(i).toFixed(1), +v.buffered.end(i).toFixed(1)])
            }
            res.push(r)
          } return res }""")

        # --- voice
        page.locator('.tree-title', has_text='Voice').first.click()
        page.wait_for_selector('.cm-voice')
        try:
            page.wait_for_function("() => [...document.querySelectorAll('.cm-voice')].every(v => v.dataset.state === 'ready')", timeout=20000)
        except Exception:
            pass
        out['voice_states'] = page.evaluate("() => [...document.querySelectorAll('.cm-voice')].map(v => v.dataset.state)")
        voices = []
        n = page.locator('.cm-voice-play').count()
        for i in range(n):
            page.locator('.cm-voice-play').nth(i).click()
            time.sleep(1.6)
            r = page.evaluate("""(i) => { const t = window.__taps[i]; if (!t) return { tap: false }
               const d = new Float32Array(2048); t.an.getFloatTimeDomainData(d)
               let peak = 0; for (const x of d) peak = Math.max(peak, Math.abs(x))
               return { tap: true, peak: +peak.toFixed(4), time: +t.el.currentTime.toFixed(2), paused: t.el.paused, dur: +t.el.duration.toFixed(1),
                        scheme: (t.el.src || '').split(':')[0], cross: t.el.crossOrigin } }""", i)
            # seek through the page's own element, then check it still sounds
            r2 = page.evaluate("""async (i) => { const t = window.__taps[i]; if (!t) return null
               await new Promise(done => { t.el.addEventListener('seeked', done, { once: true }); t.el.currentTime = 25 })
               await new Promise(d => setTimeout(d, 900))
               const d = new Float32Array(2048); t.an.getFloatTimeDomainData(d)
               let peak = 0; for (const x of d) peak = Math.max(peak, Math.abs(x))
               return { peak_after_seek: +peak.toFixed(4), time: +t.el.currentTime.toFixed(2) } }""", i)
            voices.append({**r, **(r2 or {})})
            page.locator('.cm-voice-play').nth(i).click()
            time.sleep(0.4)
        out['voice'] = voices
        # the bar heights, not just "is there a bar row" (always true, flat bars too): flat stubs are all 22%
        out['wave_drawn'] = page.evaluate("() => [...document.querySelectorAll('.cm-voice')].map(v => [...new Set([...v.querySelectorAll('.cm-voice-wave > *')].map(b => b.style.height))].join(' '))")
        out['console'] = errors[:12]
        b.close()
finally:
    lab.stop(proc)
print(json.dumps(out, indent=1))
log = open(WORK / 'probe.log').read()
print('--- main log tail:', log[-700:])
