"""Recordings: memory while their note is open, and after leaving it. usage: WORK=.. python3 run_voice_memory.py <port> <copies> [play]"""
import json, os, re, shutil, subprocess, sys, time
from pathlib import Path
from playwright.sync_api import sync_playwright
import lab
PORT = int(sys.argv[1]); COPIES = int(sys.argv[2]); PLAY = len(sys.argv) > 3
FIX = lab.WORK / 'fix'  # made by make_media.sh
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
        d[kind] = d.get(kind, 0) + rss / 1024
    return d
def show(label, d, base=None):
    tot = sum(d.values()); b = sum(base.values()) if base else None
    print('   ', label.ljust(40), f"total {tot:.0f}" + (f" ({tot-b:+.0f})" if base else ''), '|', ' '.join(f"{k}={v:.0f}" + (f"({v-base.get(k,0):+.0f})" if base else '') for k, v in sorted(d.items()) if k in ('main', 'renderer')))
try:
    with sync_playwright() as p:
        b, page = lab.connect(p, PORT)
        page.wait_for_selector('.tree-row', timeout=30000); time.sleep(3)
        cdp = page.context.new_cdp_session(page)
        def gc():
            for _ in range(3): cdp.send('HeapProfiler.collectGarbage'); time.sleep(0.5)
        page.locator('.tree-title', has_text='Cell structure').first.click(); time.sleep(4); gc()
        p0 = parts(); show('floor (another note open)', p0)
        page.locator('.tree-title', has_text='Talks').first.click()
        try: page.wait_for_function("(n) => [...document.querySelectorAll('.cm-voice')].filter(v => v.dataset.state === 'ready').length >= n", arg=COPIES, timeout=60000)
        except Exception: pass
        time.sleep(4)
        print('    states:', page.evaluate("() => [...document.querySelectorAll('.cm-voice')].map(v => v.dataset.state)"))
        show('recordings note open', parts(), p0)
        if PLAY:
            page.locator('.cm-voice-play').first.click(); time.sleep(2)
        page.locator('.tree-title', has_text='Cell structure').first.click()
        time.sleep(6); show('6 s after leaving', parts(), p0)
        gc(); time.sleep(2); show('after a forced clean-up', parts(), p0)
        time.sleep(20); show('20 s later', parts(), p0)
        if PLAY:
            print('    still playing on the tape:', page.evaluate("() => !!document.querySelector('.deck .deck-play.is-playing, .deck-play.is-playing')"))
        b.close()
finally:
    lab.stop(proc)
