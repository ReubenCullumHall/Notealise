"""CPU profile of typing in a long note: which functions the time goes to."""
import sys, time, collections
from playwright.sync_api import sync_playwright
import lab

PORT = int(sys.argv[1]); TITLE = sys.argv[2]; KEYS = int(sys.argv[3]) if len(sys.argv) > 3 else 120
WORK = lab.WORK / 'work'
vault = WORK / 'vault-small'
lab.seed_vault(vault)
ud = WORK / 'ud'
lab.profile(ud, vault)
proc, _ = lab.launch(ud, PORT, WORK / 'app.log')
TEXT = 'these are some ordinary words typed at a steady pace to see how the note keeps up with the hands '
try:
    with sync_playwright() as p:
        b, page = lab.connect(p, PORT)
        page.wait_for_selector('.tree-row', timeout=30000)
        time.sleep(2.5)
        lab.open_note(page, None, TITLE, settle=5)
        page.locator('.cm-line', has_text='The quick brown fox').first.click()
        page.keyboard.press('End')
        time.sleep(1.0)
        cdp = page.context.new_cdp_session(page)
        cdp.send('Profiler.enable')
        cdp.send('Profiler.setSamplingInterval', {'interval': 200})
        cdp.send('Profiler.start')
        t0 = time.time()
        page.keyboard.type((TEXT * 5)[:KEYS], delay=45)
        time.sleep(0.8)
        prof = cdp.send('Profiler.stop')['profile']
        wall = time.time() - t0
        nodes = {n['id']: n for n in prof['nodes']}
        self_us = collections.Counter()
        for nid, dt in zip(prof['samples'], prof['timeDeltas']):
            self_us[nid] += dt
        parent = {}
        for n in prof['nodes']:
            for c in n.get('children', []):
                parent[c] = n['id']
        def key(n):
            cf = n['callFrame']
            url = cf['url'].split('/')[-1][:24]
            return f"{cf['functionName'] or '(anonymous)'} @{url}:{cf['lineNumber'] + 1}"
        by_fn = collections.Counter()
        incl = collections.Counter()
        for nid, us in self_us.items():
            by_fn[key(nodes[nid])] += us
            seen = set()
            cur = nid
            while cur is not None:
                k = key(nodes[cur])
                if k not in seen:
                    incl[k] += us
                    seen.add(k)
                cur = parent.get(cur)
        total = sum(self_us.values())
        idle = sum(us for k, us in by_fn.items() if k.startswith('(idle)') or k.startswith('(program)'))
        busy = total - idle
        print(f'=== {TITLE}: {KEYS} keys in {wall:.1f} s | profile {total/1000:.0f} ms, busy {busy/1000:.0f} ms = {busy/1000/KEYS:.1f} ms per key ===')
        print('--- where the time is spent (self time) ---')
        for k, us in by_fn.most_common(28):
            if k.startswith('(idle)') or k.startswith('(program)'):
                continue
            print(f'  {us/1000:8.0f} ms  {us/busy*100:5.1f}%  {k}')
        print('--- biggest callers (time including what they call) ---')
        n = 0
        for k, us in incl.most_common(400):
            if k.startswith('(') or us / busy < 0.03:
                continue
            print(f'  {us/1000:8.0f} ms  {us/busy*100:5.1f}%  {k}')
            n += 1
            if n >= 60:
                break
        b.close()
finally:
    lab.stop(proc)
