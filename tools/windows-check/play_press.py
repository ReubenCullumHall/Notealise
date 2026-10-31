import sys, os, json, time, shutil
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import sharpness as C
from h import *
from playwright.sync_api import sync_playwright
STEP = r"""(sel) => { const b = document.querySelector(sel);
  const mine = (a) => { const t = a.effect && a.effect.target; return !!t && (t === b || b.contains(t) || t.contains(b)) };
  const anims = document.getAnimations().filter(mine);
  const info = anims.map(a => ({name: a.animationName || a.id || a.constructor.name, start: a.startTime, delay: a.effect.getTiming().delay, dur: a.effect.getTiming().duration, fill: a.effect.getTiming().fill, tgt: a.effect.target.className.toString().slice(0, 30)}));
  anims.forEach(a => a.pause()); const t0 = Math.min(...anims.map(a => a.startTime)); const rel = anims.map(a => a.startTime - t0);
  const out = []; let end = 0; anims.forEach((a, i) => { end = Math.max(end, rel[i] + a.effect.getComputedTiming().endTime) });
  for (let T = 0; T <= end + 1; T += 25) { anims.forEach((a, i) => { a.currentTime = T - rel[i] }); const r = b.getBoundingClientRect(); out.push([T, +(r.left + r.width/2).toFixed(1), +(r.top + r.height/2).toFixed(1), +r.width.toFixed(1)]) }
  anims.forEach(a => a.cancel()); return {n: anims.length, info, steps: out, after: getComputedStyle(b).transform} }"""
root = C.build("vault-press", "rounded", "light")
app = App("press", root, port=9561, extra=["--mute-audio"]); app.start()
with sync_playwright() as p:
    pg = app.connect(p); time.sleep(1.5)
    pg.locator('aside .tree-row', has=pg.locator('.tree-title', has_text="Sharp")).first.click(); time.sleep(1.5)
    pg.wait_for_selector('.cm-voice[data-state="ready"]')
    RAF = r"""(sel) => { const b = document.querySelector(sel); window.__b = b; window.__rows = []; const t0 = performance.now();
      const tick = () => { const r = b.getBoundingClientRect(); window.__rows.push([Math.round(performance.now() - t0), +(r.left + r.width / 2).toFixed(1), +(r.top + r.height / 2).toFixed(1), +r.width.toFixed(1)]); if (performance.now() - t0 < 650) requestAnimationFrame(tick) };
      requestAnimationFrame(tick) }"""
    for label, sel in [("voice play button", ".cm-voice-play"), ("sidebar archive button", 'aside button[data-tip^="Archive"]')]:
        box = pg.locator(sel).first.bounding_box(); cx, cy = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
        pg.mouse.move(cx, cy); time.sleep(0.3)
        pg.evaluate(RAF, sel); time.sleep(0.1)
        pg.mouse.down(); time.sleep(0.06); pg.mouse.up(); time.sleep(0.8)
        res = {'rows': pg.evaluate('window.__rows'), 'after': pg.evaluate('() => getComputedStyle(window.__b).transform'), 'anims': pg.evaluate('document.getAnimations().length')}
        rows = res["rows"]; ws = [r[3] for r in rows]; cxs = sorted(set(r[1] for r in rows)); cys = sorted(set(r[2] for r in rows))
        keyw = [(r[0], r[3]) for r in rows if r[0] % 1 == 0][::3]
        print(f"PRESS {label}: width min {min(ws)} max {max(ws)}; centre x {cxs[0]}..{cxs[-1]} y {cys[0]}..{cys[-1]}; final width {ws[-1]}; transform after '{res['after']}'; animations left {res['anims']}; series {keyw[:14]}", flush=True)
        time.sleep(0.6)
        if "Archive" in sel: pg.locator('aside button[data-tip="Back to your notes"]').first.click(); time.sleep(0.5)
app.stop()
