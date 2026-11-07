"""'More accurate transcription' and word times, end to end in a scratch build (see run_check.py).

1. Status starts 'none'. 2. Download starts, progress arrives, Cancel stops it and leaves nothing.
3. Full download (550 MB, real network) → 'ready'. 4. A recording in the scratch vault is transcribed:
   the result says accurate=true, and its word times come back from transcribeWordTimes; after the
   recording is changed they don't. 5. Remove → 'none'; Base again (accurate=false).

Usage: python3 accurate_check.py <port> <recording name in the scratch vault> <scratch vault path>
"""
import os, sys, time
from playwright.sync_api import sync_playwright

port, name, vault = sys.argv[1], sys.argv[2], sys.argv[3]

TRANSCRIBE = r"""
async (name) => {
  const bytes = await window.api.readAsset(name)
  const audio = await new OfflineAudioContext(1, 1, 16000).decodeAudioData(bytes.slice().buffer)
  const f = audio.getChannelData(0), s = new Int16Array(f.length)
  for (let j = 0; j < f.length; j++) s[j] = Math.round(Math.max(-1, Math.min(1, f[j])) * 32767)
  const job = await window.api.transcribeBegin(name)
  await window.api.transcribeAppend(job, s)
  const t = performance.now()
  const r = await window.api.transcribeRun(job)
  return { ms: Math.round(performance.now() - t), ok: r.ok, accurate: r.accurate, words: r.words && r.words.length,
           text: r.paragraphs && r.paragraphs.join(' ').slice(0, 120) }
}
"""

with sync_playwright() as p:
    br = p.chromium.connect_over_cdp(f'http://127.0.0.1:{port}')
    pg = br.contexts[0].pages[0]
    st = lambda: pg.evaluate('window.api.accurateStatus()')
    print('1 status:', st()['state'])
    if st()['state'] == 'ready':
        print('  removing an earlier download first:', pg.evaluate('window.api.accurateRemove()'))

    pg.evaluate("""() => { window.__prog = []; window.api.onAccurateProgress(p => window.__prog.push(p.received));
                   window.__dl = window.api.accurateDownload() }""")
    time.sleep(4)
    mid = st()
    pg.evaluate('window.api.accurateCancel()')
    res = pg.evaluate('window.__dl')
    print(f"2 cancel after {mid['received']/1e6:.0f} MB:", res, '| progress events:', pg.evaluate('window.__prog.length'),
          '| left behind:', [f for f in os.listdir(os.path.join(sys.argv[3], '..', 'ud', 'whisper'))] if os.path.isdir(os.path.join(sys.argv[3], '..', 'ud', 'whisper')) else [])

    t = time.time()
    res = pg.evaluate('window.api.accurateDownload()')
    print(f'3 full download in {time.time()-t:.0f} s:', res, '| status:', st()['state'])

    r = pg.evaluate(TRANSCRIBE, name)
    print('4 transcribe:', r)
    times = pg.evaluate('(n) => window.api.transcribeWordTimes(n)', name)
    print('  word times kept:', len(times or []), (times or [])[:3])
    with open(os.path.join(vault, name), 'ab') as f:
        f.write(b'\0')  # the recording changes
    print('  after the recording changed:', pg.evaluate('(n) => window.api.transcribeWordTimes(n)', name))

    print('5 remove:', pg.evaluate('window.api.accurateRemove()'), '| status:', st()['state'])
    print('  Base again:', pg.evaluate(TRANSCRIBE, name))
    br.close()
