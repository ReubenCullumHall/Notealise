"""Transcribe, end to end through the REAL main process (docs/plans/transcribe.md).

Drives a scratch build of the app over CDP (its own profile and port — never Reuben's test copy)
and, inside the real window: decodes a recording the way the renderer will (OfflineAudioContext at
16 kHz), sends it in 5-minute pieces through window.api.transcribe*, and reports the text, the
progress events, how long it took, and how smooth the window stayed while Whisper ran (the longest
gap between 16 ms timer ticks — a frozen window shows as a long gap).

Also: Cancel mid-run, two at once (the second waits in line), and a junk argument refused.

Usage: python3 run_check.py <port> <recording> [<recording 2>]
Start the scratch app first (README in this folder).
"""
import base64, json, sys, time
from playwright.sync_api import sync_playwright

port, rec = sys.argv[1], sys.argv[2]
rec2 = sys.argv[3] if len(sys.argv) > 3 else rec

JS = r"""
async ([b64, mode]) => {
  const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0))
  const t0 = performance.now()
  const ctx = new OfflineAudioContext(1, 1, 16000)
  const audio = await ctx.decodeAudioData(bytes.buffer)
  const ch = audio.getChannelData(0)
  const decodeMs = performance.now() - t0
  const api = window.api
  const progress = []
  const off = api.onTranscribeProgress(p => progress.push(p))
  // smoothness: longest gap between 16 ms ticks while it runs
  let last = performance.now(), worst = 0
  const tick = setInterval(() => { const n = performance.now(); worst = Math.max(worst, n - last); last = n }, 16)
  const job = await api.transcribeBegin()
  const PIECE = 5 * 60 * 16000
  for (let i = 0; i < ch.length; i += PIECE) {
    const f = ch.subarray(i, i + PIECE), s = new Int16Array(f.length)
    for (let j = 0; j < f.length; j++) s[j] = Math.max(-32768, Math.min(32767, Math.round(f[j] * 32767)))
    await api.transcribeAppend(job, s)
  }
  const t1 = performance.now()
  const run = api.transcribeRun(job)
  if (mode === 'cancel') setTimeout(() => api.transcribeCancel(job), 1500)
  const result = await run
  const runMs = performance.now() - t1
  clearInterval(tick); off()
  return { seconds: audio.duration, decodeMs: Math.round(decodeMs), runMs: Math.round(runMs), worstGapMs: Math.round(worst),
           progress: progress.map(p => p.percent + (p.waiting ? `(w${p.waiting})` : '') + (p.etaMs ? `~${Math.round(p.etaMs/1000)}s` : '')), result }
}
"""

TWO = r"""
async ([a, b]) => {
  const api = window.api
  const go = async (b64) => {
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0))
    const audio = await new OfflineAudioContext(1, 1, 16000).decodeAudioData(bytes.buffer)
    const f = audio.getChannelData(0), s = new Int16Array(f.length)
    for (let j = 0; j < f.length; j++) s[j] = Math.round(Math.max(-1, Math.min(1, f[j])) * 32767)
    const job = await api.transcribeBegin(); await api.transcribeAppend(job, s); return job
  }
  const seen = {}
  const off = api.onTranscribeProgress(p => { (seen[p.job] ||= []).push(p.waiting) })
  const j1 = await go(a), j2 = await go(b)
  const t = performance.now()
  const ends = []
  await Promise.all([j1, j2].map(j => api.transcribeRun(j).then(r => ends.push([j === j1 ? 'first' : 'second', Math.round(performance.now() - t), r.ok]))))
  off()
  let junk = 'none'
  try { await api.transcribeAppend('not-a-job', new Int16Array(4)) } catch (e) { junk = 'refused' }
  return { ends, secondWaited: (seen[j2] || []).some(w => w > 0), junk }
}
"""

b64 = base64.b64encode(open(rec, 'rb').read()).decode()
b64b = base64.b64encode(open(rec2, 'rb').read()).decode()
with sync_playwright() as p:
    br = p.chromium.connect_over_cdp(f'http://127.0.0.1:{port}')
    page = br.contexts[0].pages[0]
    print('available:', page.evaluate('window.api.transcribeAvailable()'))
    r = page.evaluate(JS, [b64, 'run'])
    res = r.pop('result')
    print(json.dumps(r, ensure_ascii=False))
    print('result ok:', res.get('ok'), res.get('reason', ''), '| language:', res.get('language'), '| paragraphs:', len(res.get('paragraphs', [])))
    for para in res.get('paragraphs', [])[:8]:
        print('  >', para[:160])
    c = page.evaluate(JS, [b64, 'cancel'])
    print('cancel:', c['result'], f"after {c['runMs']} ms")
    print('two at once:', page.evaluate(TWO, [b64b, b64b]))
    br.close()
