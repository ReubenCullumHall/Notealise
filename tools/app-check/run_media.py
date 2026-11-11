"""A note holding big videos: how long until they are loaded, and how much memory the app holds."""
import os, sys, time
from pathlib import Path
from playwright.sync_api import sync_playwright
import lab

PORT = int(sys.argv[1]); COPIES = int(sys.argv[2])
MB_EACH = int(sys.argv[3]) if len(sys.argv) > 3 else 60
WORK = lab.WORK / 'work'
vault = WORK / 'vault-media'
lab.seed_vault(vault, folders=1, notes=3)
lines = ['# Clips', '']
for i in range(COPIES):
    # made-up bytes: the app reads a file whole whether or not it can play it
    (vault / "Biology" / f"clip {i + 1}.mov").write_bytes(os.urandom(MB_EACH * 1048576))
    lines += [f'<video controls src="clip%20{i + 1}.mov"></video>', '', 'Words between the clips.', '']
(vault / 'Biology' / 'Clips.md').write_text('\n'.join(lines))
total_mb = COPIES * MB_EACH
ud = WORK / 'ud'
lab.profile(ud, vault)
proc, _ = lab.launch(ud, PORT, WORK / 'app.log')
try:
    with sync_playwright() as p:
        b, page = lab.connect(p, PORT)
        page.wait_for_selector('.tree-row', timeout=30000)
        time.sleep(3)
        before = lab.rss_mb(proc)
        t0 = time.time()
        page.locator('.tree-title', has_text='Clips').first.click()
        peak = before
        loaded_at = None
        while time.time() - t0 < 90:
            peak = max(peak, lab.rss_mb(proc))
            try:
                n = page.evaluate("() => [...document.querySelectorAll('video')].filter(v => v.src && v.src.startsWith('blob:')).length")
                shown = page.evaluate("() => document.querySelectorAll('video').length")
            except Exception:
                n, shown = -1, -1
            if n >= COPIES and loaded_at is None:
                loaded_at = time.time() - t0
                break
            time.sleep(0.1)
        time.sleep(2)
        peak = max(peak, lab.rss_mb(proc))
        settled = lab.rss_mb(proc)
        print(f'=== {COPIES} videos, {total_mb:.0f} MB of files in one note ===')
        print(f'  all loaded after: {loaded_at if loaded_at is None else round(loaded_at, 1)} s (videos in the note: {shown}, with data: {n})')
        print(f'  memory held by the app: before {before:.0f} MB -> peak {peak:.0f} MB -> settled {settled:.0f} MB (+{settled - before:.0f} MB)')
        # leave the note: is the memory given back?
        page.locator('.tree-title', has_text='Cell structure').first.click()
        time.sleep(6)
        away = lab.rss_mb(proc)
        print(f'  after opening a different note and waiting 6 s: {away:.0f} MB (+{away - before:.0f} MB still held)')
        b.close()
finally:
    lab.stop(proc)
print(open(WORK / 'app.log').read()[-600:])
