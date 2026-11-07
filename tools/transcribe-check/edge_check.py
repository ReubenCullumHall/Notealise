"""Transcribe on awkward recordings, through the REAL app (scratch build over CDP — see run_check.py).

Each file goes the app's whole way: decoded in the window at 16 kHz, sent in pieces, cut at its
pauses, each stretch's language asked, transcribed. Prints what comes back, so invented text
("Thank you.", a sentence in the wrong language) is visible.

Usage: python3 edge_check.py <port> <recording>…
"""
import base64, json, os, sys
from playwright.sync_api import sync_playwright

JS = r"""
async (b64) => {
  const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0))
  let audio
  try { audio = await new OfflineAudioContext(1, 1, 16000).decodeAudioData(bytes.buffer) }
  catch (e) { return { decode: 'failed: ' + e } }
  const f = audio.getChannelData(0), s = new Int16Array(f.length)
  for (let j = 0; j < f.length; j++) s[j] = Math.round(Math.max(-1, Math.min(1, f[j])) * 32767)
  const job = await window.api.transcribeBegin()
  await window.api.transcribeAppend(job, s)
  const t = performance.now()
  const r = await window.api.transcribeRun(job)
  return { seconds: +audio.duration.toFixed(1), ms: Math.round(performance.now() - t), ok: r.ok, reason: r.reason,
           language: r.language, words: r.words ? r.words.length : 0, paragraphs: r.paragraphs }
}
"""

with sync_playwright() as p:
    br = p.chromium.connect_over_cdp(f'http://127.0.0.1:{sys.argv[1]}')
    page = br.contexts[0].pages[0]
    for path in sys.argv[2:]:
        r = page.evaluate(JS, base64.b64encode(open(path, 'rb').read()).decode())
        paras = r.pop('paragraphs', None) or []
        print(os.path.basename(path), json.dumps(r, ensure_ascii=False))
        for para in paras[:4]:
            print('   >', para[:150])
    br.close()
