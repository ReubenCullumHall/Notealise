"""Transcribe UI specimens, photographed from the REAL app (a scratch build over CDP — run_check.py).

Each picture is the real voice note block / the real Settings window with the proposed piece put
into its page using the app's own classes and colour variables, so it is drawn by the app's CSS,
never by hand. Nothing here changes the app's code. Output: PNGs in <out dir> for the plan page.

Needs a note "Biology revision" with one voice note in the scratch vault.
Usage: python3 specimens.py <port> <out dir>
"""
import os, sys
from playwright.sync_api import sync_playwright

port, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)

LINES_ICON = ('<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" '
              'stroke-linecap="round" aria-hidden="true"><path d="M5 7h14M5 12h14M5 17h9"/></svg>')
OUT_ICON = ('<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" '
            'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 5h14v9"/><path d="M12 19l-4-4 4-4"/><path d="M8 15h11"/></svg>')

PARAS = [
    "Okay, so for the biology test on Friday, the main thing to remember is how photosynthesis works. Plants take in carbon dioxide through small holes in their leaves called stomata, and they take in water through their roots.",
    "Using energy from sunlight, the chloroplasts turn those into glucose and oxygen. The oxygen is released into the air, and the glucose is used for energy or stored as starch.",
    "The rate of photosynthesis depends on three limiting factors: light intensity, carbon dioxide concentration and temperature. If you increase one of them, the rate goes up until another factor becomes the limit.",
    "For the maths homework, question four asks us to solve two x squared minus eight x plus six equals zero. Divide everything by two first, then factorise it into x minus one times x minus three.",
    "So x equals one or x equals three. Check both by putting them back in.",
]

SETUP = r"""
() => {
  const b = document.querySelector('.cm-voice')
  window.__row = window.__row || b.querySelector('.cm-voice-controls').innerHTML
  window.__reset = () => {
    const blk = document.querySelector('.cm-voice')
    blk.querySelector('.cm-voice-controls').innerHTML = window.__row
    blk.querySelectorAll('.spec').forEach(e => e.remove())
  }
  window.__reset()
  return true
}
"""

def js_variant(kind):
    return r"""
([kind, LINES, OUT, PARAS]) => {
  window.__reset()
  const b = document.querySelector('.cm-voice')
  const ctr = b.querySelector('.cm-voice-controls')
  const edit = ctr.querySelector('.cm-voice-editbtn'), mix = ctr.querySelector('.cm-voice-mixbtn')
  const under = (html) => { const d = document.createElement('div'); d.className = 'spec'; d.innerHTML = html;
    d.style.cssText = 'margin:6px 0 2px 44px;font-family:var(--font-ui, inherit);'; b.appendChild(d); return d }
  const quiet = 'color:rgb(var(--ink-500));font-size:12px;'
  if (kind === 'A') {
    const t = edit.cloneNode(true); t.classList.remove('cm-voice-editbtn'); t.classList.add('spec')
    t.innerHTML = LINES; t.setAttribute('data-tip', 'Transcribe'); t.setAttribute('aria-label', 'Transcribe')
    ctr.insertBefore(t, edit)
  }
  if (kind === 'B') {
    const t = document.createElement('button'); t.className = 'spec'; t.textContent = 'Transcribe'
    t.style.cssText = 'margin-left:4px;height:26px;padding:0 10px;border-radius:var(--r-control);border:1px solid rgb(var(--ink-300) / .5);background:rgb(var(--surface) / .7);font-size:12px;color:rgb(var(--ink-700));flex:none'
    mix.after(t)
  }
  if (kind === 'C') {
    under(`<button style="display:inline-flex;align-items:center;gap:6px;border:none;background:none;padding:2px 0;${quiet}cursor:pointer">${LINES}<span>Transcribe</span></button>`)
  }
  if (kind === 'P1' || kind === 'P2') {
    const msg = kind === 'P1' ? 'Transcribing · 40%' : 'This will take a long time on this computer — about 6 min · 12%'
    const pct = kind === 'P1' ? 40 : 12
    under(`<div style="display:flex;align-items:center;gap:10px;${quiet}">
      <span style="position:relative;flex:1;height:3px;border-radius:9999px;background:rgb(var(--ink-300) / .35);overflow:hidden">
        <span style="position:absolute;inset:0 auto 0 0;width:${pct}%;background:rgb(var(--accent-500))"></span></span>
      <span style="white-space:nowrap">${msg}</span>
      <button style="border:none;background:none;padding:0;${quiet}text-decoration:underline;cursor:pointer">Cancel</button></div>`)
  }
  if (kind === 'T1' || kind === 'T2' || kind === 'T3') {
    const paras = kind === 'T2' ? PARAS : PARAS.slice(0, 2)
    const stale = kind === 'T3'
      ? `<div style="${quiet}margin:0 0 6px">Transcribed before the clip was edited · <button style="border:none;background:none;padding:0;${quiet}text-decoration:underline">Transcribe again</button></div>` : ''
    const d = under(`${stale}<div class="spec-tx" style="position:relative;border-top:1px solid rgb(var(--ink-300) / .35);padding:8px 2px 30px 0;">
      <div style="max-height:calc(10 * 1.6em);overflow-y:auto;line-height:1.6;font-size:14px;color:rgb(var(--ink-700));font-family:var(--font-note, inherit);padding-right:6px">
        ${paras.map(p => `<p style="margin:0 0 .7em">${p}</p>`).join('')}</div>
      <button data-tip="Separate transcript from audio block" aria-label="Separate transcript from audio block"
        style="position:absolute;left:0;bottom:2px;width:26px;height:26px;display:grid;place-items:center;border:none;border-radius:var(--r-control);background:none;color:rgb(var(--ink-500))">${OUT}</button></div>`)
    d.style.marginRight = '0'
  }
  // the block AND what was put under it (the editor keeps the block's own box at its old height)
  const rs = [b, ...b.querySelectorAll('.spec')].map(e => e.getBoundingClientRect()).filter(r => r.width > 0)
  const x = Math.min(...rs.map(r => r.x)), y = Math.min(...rs.map(r => r.y))
  const w = Math.max(...rs.map(r => r.right)) - x, h = Math.max(...rs.map(r => r.bottom)) - y
  return { x, y, w, h }
}
"""


def shoot(pg, name, box, pad=28):
    clip = {'x': max(0, box['x'] - pad - 24), 'y': max(0, box['y'] - pad), 'width': box['w'] + 2 * pad + 24, 'height': box['h'] + 2 * pad}
    pg.screenshot(path=os.path.join(out, name), clip=clip)


with sync_playwright() as p:
    br = p.chromium.connect_over_cdp(f'http://127.0.0.1:{port}')
    pg = br.contexts[0].pages[0]
    # room for a full transcript, at the Mac's own sharpness (still pictures only — nothing here moves)
    cdp = pg.context.new_cdp_session(pg)
    cdp.send('Emulation.setDeviceMetricsOverride', {'width': 1300, 'height': 1000, 'deviceScaleFactor': 2, 'mobile': False})
    pg.keyboard.press('Escape')
    pg.get_by_text('Biology revision', exact=True).first.click()
    pg.wait_for_timeout(1200)
    pg.evaluate("() => document.querySelector('.cm-voice').scrollIntoView({ block: 'start' })")
    pg.wait_for_timeout(300)
    for theme in ('light', 'dark'):
        pg.emulate_media(color_scheme=theme, reduced_motion='reduce')
        pg.wait_for_timeout(800)
        pg.evaluate(SETUP)
        kinds = ['T1', 'T2'] if theme == 'dark' else ['now', 'A', 'B', 'C', 'P1', 'P2', 'T1', 'T2', 'T3']
        for k in kinds:
            box = pg.evaluate(js_variant(k), [k, LINES_ICON, OUT_ICON, PARAS])
            pg.mouse.move(5, 5)
            pg.wait_for_timeout(250)
            shoot(pg, f'voice-{k}-{theme}.png', box)
        pg.evaluate('window.__reset()')

    # --- Settings: the new "Extra features" entry -------------------------------------------
    pg.emulate_media(color_scheme='light', reduced_motion='reduce')
    pg.locator('aside button[aria-label="Settings"]').first.click()
    pg.wait_for_timeout(1500)
    g = pg.locator('.genie')
    g.get_by_text('General', exact=True).first.click()
    pg.wait_for_timeout(500)
    pg.evaluate(r"""() => {
      const g = document.querySelector('.genie')
      const navs = [...g.querySelectorAll('button')].filter(b => ['General','Look','Spaces','Archive','Data','Help','Updates'].includes(b.innerText.trim()))
      const general = navs.find(b => b.innerText.trim() === 'General'), data = navs.find(b => b.innerText.trim() === 'Data')
      const active = general.className, idle = data.className
      const extra = data.cloneNode(true)
      // the label is the last text node / span inside the nav button
      const label = [...extra.querySelectorAll('span')].reverse().find(s => s.innerText.trim() === 'Data') || extra
      label.textContent = 'Extra features'
      const svg = extra.querySelector('svg')
      if (svg) svg.outerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6"/></svg>'
      data.after(extra)
      general.className = idle; extra.className = active
      // the page: General's own section markup, re-worded
      const h = [...g.querySelectorAll('h3')].find(x => x.innerText === 'Startup'); const page = h.parentElement
      const row = page.querySelector('button.press-row').outerHTML
      const off = row.replace('bg-brand-500/15 ring-1 ring-brand-300/60', 'hover:bg-ink-100/60').replace('bg-accent-500', 'bg-ink-300').replace('left-[18px]', 'left-0.5').replace('text-brand-600', 'text-ink-800').replace('aria-pressed="true"', 'aria-pressed="false"')
      const setRow = (html, title, hint) => html.replace(/(<span class="block text-\[13px\] font-medium [^"]*">)[^<]*/, `$1${title}`).replace(/(<span class="mt-0.5 block text-\[11.5px\] leading-relaxed text-ink-400">)[^<]*/, `$1${hint}`)
      const btn = (t, strong) => `<button class="flex items-center gap-1.5 rounded-lg border border-ink-300/30 font-medium px-3 py-2 text-[13px] btn-edge ${strong ? 'bg-accent-500 text-white' : 'bg-surface/70 text-ink-700'}">${t}</button>`
      page.innerHTML = `
        <h3 class="accent-heading font-display text-[15px] font-semibold">Extra features</h3>
        <p class="mt-0.5 text-[12px] text-ink-500">Things you can add to the app. Some are a one-time download.</p>
        <div class="mt-4">${setRow(row, 'Markdown pro', 'A button in each note’s corner that switches between the formatted page and the plain Markdown underneath.')}</div>
        <div class="mt-2 ml-3 flex items-center gap-2 text-[12.5px] text-ink-600">How the marks look ${btn('Faded')} </div>
        <h3 class="mt-7 accent-heading font-display text-[15px] font-semibold">More accurate transcription</h3>
        <p class="mt-0.5 text-[12px] text-ink-500">Transcribes voice notes with fewer wrong words, especially outside English. It runs on this computer — recordings are never sent anywhere.</p>
        <div class="mt-3 flex items-center gap-3">${btn('Download · 550 MB', true)}<span class="text-[12px] text-ink-400">Takes about a minute on a fast connection.</span></div>
        <div class="mt-5 rounded-xl px-3 py-3 ring-1 ring-ink-300/30"><div class="text-[11.5px] text-ink-400 mb-2">While it downloads:</div>
          <div class="flex items-center gap-3 text-[12.5px] text-ink-600"><span style="position:relative;flex:1;height:3px;border-radius:9999px;background:rgb(var(--ink-300) / .35);overflow:hidden"><span style="position:absolute;inset:0 auto 0 0;width:38%;background:rgb(var(--accent-500))"></span></span>212 of 550 MB ${btn('Cancel')}</div>
          <div class="text-[11.5px] text-ink-400 mt-4 mb-2">Once it’s in:</div>
          <div class="flex items-center gap-3 text-[12.5px] text-ink-600">On — Transcribe uses it for every voice note. ${btn('Remove')}</div></div>`
    }""")
    pg.mouse.move(5, 5)
    pg.wait_for_timeout(400)
    pg.locator('.genie').screenshot(path=os.path.join(out, 'settings-extra-light.png'))
    br.close()
print('done', sorted(os.listdir(out)))
