"""Typing while Transcribe runs — does the note still keep up? (docs/plans/transcribe.md, test 3)

In a scratch build (see run_check.py), types into the open note with REAL key presses and measures,
for each key, the time from the key going down to its letter being on the page. Done twice: with
nothing else happening, then while a long recording is transcribing. Reports the typical (median)
and the worst key, and the longest gap the page had between frames.

Usage: python3 typing_check.py <port> <long recording>
"""
import base64, statistics, sys, threading, time
from playwright.sync_api import sync_playwright

port, rec = sys.argv[1], sys.argv[2]
TEXT = 'the quick brown fox jumps over the lazy dog while the recording is being transcribed '

SETUP = r"""
() => {
  window.__lat = []; window.__gap = 0
  const ed = document.querySelector('.cm-content')
  let pressed = 0
  window.addEventListener('keydown', () => { pressed = performance.now() }, true)
  new MutationObserver(() => {
    if (!pressed) return
    const t0 = pressed; pressed = 0
    requestAnimationFrame(() => window.__lat.push(performance.now() - t0))
  }).observe(ed, { childList: true, subtree: true, characterData: true })
  let last = performance.now()
  const loop = () => { const n = performance.now(); window.__gap = Math.max(window.__gap, n - last); last = n; window.__raf = requestAnimationFrame(loop) }
  loop()
  return !!ed
}
"""

START = r"""
async (b64) => {
  const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0))
  const audio = await new OfflineAudioContext(1, 1, 16000).decodeAudioData(bytes.buffer)
  const f = audio.getChannelData(0), s = new Int16Array(f.length)
  for (let j = 0; j < f.length; j++) s[j] = Math.round(Math.max(-1, Math.min(1, f[j])) * 32767)
  const job = await window.api.transcribeBegin()
  await window.api.transcribeAppend(job, s)
  window.__done = false
  window.api.transcribeRun(job).then(r => { window.__done = true; window.__result = r.ok })
  return audio.duration
}
"""


def measure(page, label):
    page.evaluate('() => { window.__lat = []; window.__gap = 0 }')
    for ch in TEXT:
        page.keyboard.type(ch)
        time.sleep(0.09)  # ~110 words a minute
    lat = page.evaluate('() => window.__lat')
    gap = page.evaluate('() => window.__gap')
    print(f'{label}: {len(lat)} keys | typical {statistics.median(lat):.0f} ms | worst {max(lat):.0f} ms | longest frame gap {gap:.0f} ms')


with sync_playwright() as p:
    br = p.chromium.connect_over_cdp(f'http://127.0.0.1:{port}')
    page = br.contexts[0].pages[0]
    # open the scratch vault's note and put the cursor at its end
    page.get_by_text('Test', exact=True).first.click()
    page.wait_for_selector('.cm-content', timeout=10000)
    page.click('.cm-content')
    page.keyboard.press('Meta+ArrowDown')
    print('ready:', page.evaluate(SETUP))
    measure(page, 'nothing running   ')
    secs = page.evaluate(START, base64.b64encode(open(rec, 'rb').read()).decode())
    time.sleep(4)  # past the speech finder, into Whisper proper
    measure(page, f'transcribing {secs/60:.0f} min')
    print('still transcribing at the end of typing:', not page.evaluate('() => window.__done'))
    br.close()
