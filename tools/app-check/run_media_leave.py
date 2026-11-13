"""After leaving a note of PLAYED films: is the memory given back, and when? usage: WORK=.. python3 run_media_leave.py <port> <copies> <real clip|none>"""
import os, shutil, sys, time
from pathlib import Path
from playwright.sync_api import sync_playwright
import lab, subprocess
def parts(proc):
    out = subprocess.run(['ps', '-axo', 'pid,ppid,rss,command'], capture_output=True, text=True).stdout
    rows = []
    for line in out.splitlines()[1:]:
        a = line.split(None, 3)
        if len(a) == 4: rows.append((int(a[0]), int(a[1]), int(a[2]), a[3]))
    kids = {proc.pid}; grew = True
    while grew:
        grew = False
        for pid, ppid, _, _ in rows:
            if ppid in kids and pid not in kids: kids.add(pid); grew = True
    d = {}
    for pid, _, rss, cmd in rows:
        if pid not in kids: continue
        m = re.search(r'--type=([a-z-]+)', cmd); kind = m.group(1) if m else 'main'
        sub = re.search(r'--utility-sub-type=([\w.]+)', cmd)
        if sub: kind = sub.group(1).split('.')[-1]
        d[kind] = d.get(kind, 0) + rss / 1024
    return d
def show(label, d, base=None):
    print('   ', label.ljust(34), ' '.join(f"{k}={v:.0f}" + (f"({v-base.get(k,0):+.0f})" if base else '') for k, v in sorted(d.items())))
import re
PORT = int(sys.argv[1]); COPIES = int(sys.argv[2]); REAL = None if sys.argv[3] == 'none' else Path(sys.argv[3])
WORK = lab.WORK / 'work'; vault = WORK / 'vault-leave'
lab.seed_vault(vault, folders=1, notes=3)
lines = ['# Clips', '']
for i in range(COPIES):
    shutil.copy(REAL, vault / 'Biology' / f'clip {i + 1}.mov')
    lines += [f'<video controls src="clip%20{i + 1}.mov"></video>', '', 'Words between the clips.', '']
(vault / 'Biology' / 'Clips.md').write_text('\n'.join(lines))
ud = WORK / 'ud-leave'; lab.profile(ud, vault)
proc, _ = lab.launch(ud, PORT, WORK / 'leave.log')
try:
    with sync_playwright() as p:
        b, page = lab.connect(p, PORT)
        page.wait_for_selector('.tree-row', timeout=30000); time.sleep(3)
        cdp = page.context.new_cdp_session(page)
        def gc():
            for _ in range(3):
                cdp.send('HeapProfiler.collectGarbage'); time.sleep(0.5)
        # the floor: the other note opened first, so its own cost is in "before"
        page.locator('.tree-title', has_text='Cell structure').first.click(); time.sleep(4); gc()
        before = lab.rss_mb(proc); p0 = parts(proc); show('floor', p0)
        page.locator('.tree-title', has_text='Clips').first.click(); time.sleep(3)
        for i in range(COPIES):
            page.evaluate("""async (i) => { const v = document.querySelectorAll('video')[i]; if (!v) return
                v.scrollIntoView(); v.muted = true; v.currentTime = v.duration / 2
                try { await v.play() } catch {}
                await new Promise(r => setTimeout(r, 2000)); v.pause() }""", i)
        time.sleep(1); open_ = lab.rss_mb(proc); show('films open + played', parts(proc), p0)
        page.locator('.tree-title', has_text='Cell structure').first.click()
        time.sleep(6); a6 = lab.rss_mb(proc); show('6 s after leaving', parts(proc), p0)
        gc(); agc = lab.rss_mb(proc); show('after forced clean-up (window)', parts(proc), p0)
        time.sleep(30); a36 = lab.rss_mb(proc); show('30 s later', parts(proc), p0)
        vids = page.evaluate("() => document.querySelectorAll('video').length")
        def alive(expr):
            proto = cdp.send('Runtime.evaluate', {'expression': expr})['result']['objectId']
            arr = cdp.send('Runtime.queryObjects', {'prototypeObjectId': proto})['objects']['objectId']
            n = cdp.send('Runtime.callFunctionOn', {'objectId': arr, 'functionDeclaration': 'function(){ return this.map(v => (v.src||"").slice(0,24) + " ready=" + v.readyState + " conn=" + v.isConnected) }', 'returnByValue': True})['result']['value']
            return n
        print('    video elements still alive in the window:', alive('HTMLVideoElement.prototype'))
        print('    audio elements still alive:', alive('HTMLAudioElement.prototype'))
        print(f'  floor (other note open) {before:.0f} MB | films open+played {open_:.0f} (+{open_-before:.0f}) | 6 s after leaving +{a6-before:.0f} | after a forced clean-up +{agc-before:.0f} | 30 s later +{a36-before:.0f} | videos still in the page: {vids}')
        b.close()
finally:
    lab.stop(proc)
