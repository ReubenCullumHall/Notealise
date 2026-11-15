"""Long recordings' waveforms: the window's FOOTPRINT (what Activity Monitor shows) at its highest while their note is
open, when every waveform is drawn, and what is left after leaving. RSS (`ps`) is printed too, but it keeps counting memory the
system has already been handed back — judge by the footprint. Added 2026-11-14 (docs/app-check-2026-11-09.md, the waveform entry).
usage: WORK=<build dir> [EARLY=<s>] python3 run_voice_peak.py <port> <copies>
  $WORK/fix/long.m4a is the recording copied <copies> times (for the waveform case use one just UNDER an hour:
  ffmpeg -f lavfi -i sine=frequency=330:sample_rate=44100 -af tremolo=f=0.1:d=0.9 -t 3540 -c:a aac -b:a 128k long.m4a —
  the tremolo makes the bars differ, which is how "drawn" is told from the flat stubs). EARLY=3 leaves the note after 3 s."""
import os, re, shutil, subprocess, sys, time
from playwright.sync_api import sync_playwright
import lab
PORT = int(sys.argv[1]); COPIES = int(sys.argv[2])
FIX = lab.WORK / 'fix'
WORK = lab.WORK / 'work'; vault = WORK / 'vault-voice'
lab.seed_vault(vault, folders=1, notes=3)
lines = ['# Talks', '']
for i in range(COPIES):
    shutil.copy(FIX / 'long.m4a', vault / 'Biology' / f'talk {i + 1}.m4a')
    lines += [f'<audio controls src="talk%20{i + 1}.m4a"></audio>', '', 'Words between.', '']
(vault / 'Biology' / 'Talks.md').write_text('\n'.join(lines))
ud = WORK / 'ud-voice'; lab.profile(ud, vault)
proc, _ = lab.launch(ud, PORT, WORK / 'voice.log')

def parts():
    out = subprocess.run(['ps', '-axo', 'pid,ppid,rss,command'], capture_output=True, text=True).stdout
    rows = [(int(a[0]), int(a[1]), int(a[2]), a[3]) for a in (l.split(None, 3) for l in out.splitlines()[1:]) if len(a) == 4]
    kids = {proc.pid}; grew = True
    while grew:
        grew = False
        for pid, ppid, _, _ in rows:
            if ppid in kids and pid not in kids: kids.add(pid); grew = True
    d = {}
    for pid, _, rss, cmd in rows:
        if pid not in kids: continue
        m = re.search(r'--type=([a-z-]+)', cmd); kind = m.group(1) if m else 'main'
        if 'utility' in kind and 'audio' in cmd.lower(): kind = 'audio'
        d[kind] = d.get(kind, 0) + rss / 1024
    return d

def fpt():
    out = subprocess.run(['ps', '-axo', 'pid,ppid,command'], capture_output=True, text=True).stdout
    rs = [l.split(None, 2) for l in out.splitlines()[1:]]
    tot = 0
    for r in rs:
        if len(r) == 3 and '--type=renderer' in r[2] and 'ud-voice' in r[2]:
            o = subprocess.run(['footprint', '-p', r[0]], capture_output=True, text=True).stdout
            m = re.search(r'Footprint: ([\d.]+) (\w+)', o)
            if m: tot += float(m.group(1)) * {'KB': 1/1024, 'MB': 1, 'GB': 1024}.get(m.group(2), 0)
    return tot
TL = []
EARLY = float(os.environ.get('EARLY', '0'))

DRAWN = """() => [...document.querySelectorAll('.cm-voice')].map(v => {
  const hs = new Set([...v.querySelectorAll('.cm-voice-wave > *')].map(b => b.style.height));
  return hs.size > 2 })"""

def watch(page, seconds, base, until_drawn=False):
    t0 = time.time(); peak = 0; peak_r = 0; first_all = None; last = None; fpk = 0; fl = 0
    while time.time() - t0 < seconds:
        d = parts(); tot = sum(d.values()) - base
        if tot > peak: peak = tot
        r = d.get('renderer', 0) - p0.get('renderer', 0)
        if r > peak_r: peak_r = r
        if until_drawn and first_all is None:
            try:
                dr = page.evaluate(DRAWN)
                if dr and all(dr) and len(dr) == COPIES: first_all = time.time() - t0
            except Exception: pass
        last = tot
        fl = fpt() - f0; fpk = max(fpk, fl); TL.append((round(time.time() - t0, 1), round(fl)))
        time.sleep(0.2)
        if until_drawn and first_all is not None and time.time() - t0 > first_all + 5: break
    watch.fp = (fpk, fl)
    return peak, peak_r, first_all, last

try:
    with sync_playwright() as p:
        b, page = lab.connect(p, PORT)
        page.wait_for_selector('.tree-row', timeout=30000); time.sleep(3)
        cdp = page.context.new_cdp_session(page)
        def gc():
            for _ in range(3): cdp.send('HeapProfiler.collectGarbage'); time.sleep(0.5)
        page.locator('.tree-title', has_text='Cell structure').first.click(); time.sleep(4); gc()
        p0 = parts(); base = sum(p0.values()); f0 = fpt(); globals()['f0'] = f0
        print(f'    floor {base:.0f} MB')
        page.locator('.tree-title', has_text='Talks').first.click()
        peak, peak_r, t_all, _ = watch(page, EARLY or 180, base, until_drawn=not EARLY)
        print(f'    note open: peak {peak:+.0f} MB (window {peak_r:+.0f}); every waveform drawn after {t_all if t_all is None else round(t_all, 1)} s; FOOTPRINT peak {watch.fp[0]:+.0f}')
        print('    drawn:', page.evaluate(DRAWN), 'states:', page.evaluate("() => [...document.querySelectorAll('.cm-voice')].map(v => v.dataset.state)"))
        page.locator('.tree-title', has_text='Cell structure').first.click()
        TL.clear(); peak2, _, _, last = watch(page, 25, base); print('    timeline', [x for x in TL if x[1] > 300] or 'nothing over +300'); print('    last over 300 at', max([x[0] for x in TL if x[1] > 300] or [0]))
        print(f'    after leaving: peak {peak2:+.0f} MB over 25 s, at 25 s {last:+.0f} MB; FOOTPRINT peak {watch.fp[0]:+.0f}, at 25 s {watch.fp[1]:+.0f}')
        gc(); time.sleep(2); d = parts()
        print(f'    after a forced clean-up {sum(d.values()) - base:+.0f} MB', {k: round(v - p0.get(k, 0)) for k, v in d.items()})
        b.close()
finally:
    lab.stop(proc)
