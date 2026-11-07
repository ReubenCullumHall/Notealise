"""Transcribe, the whole thing a person does, in a scratch build with REAL clicks (docs/plans/transcribe.md).

Needs a note "Biology revision" holding one voice note "Lecture 3" (a real recording) in the scratch vault.
1. The "Transcribe" line shows under the voice note. 2. Click it: the progress line shows, then the words
   land — as the fold in the FILE, drawn as the transcript under the voice note. 3. The "Transcribe" line
   is gone. 4. One Cmd+Z takes the words back out; Cmd+Shift+Z puts them back. 5. Right-click → menu has
   "Transcribe again". 6. Separate: the fold becomes plain text. 7. Settings → Extra features opens and
   shows Markdown pro + More accurate transcription. Pictures of each step go to <out dir>.

Usage: python3 ui_check.py <port> <scratch vault> <out dir>
"""
import os, sys, time
from playwright.sync_api import sync_playwright

port, vault, out = sys.argv[1], sys.argv[2], sys.argv[3]
os.makedirs(out, exist_ok=True)
note = os.path.join(vault, 'Biology revision.md')
results = []


def check(name, ok, detail=''):
    results.append((name, ok))
    print(('PASS ' if ok else 'FAIL ') + name + (f' — {detail}' if detail else ''))


def shot(pg, name):
    box = pg.evaluate("""() => { const b = document.querySelector('.cm-voice'); if (!b) return null
      const els = [b, document.querySelector('.cm-voice-tx')].filter(Boolean).map(e => e.getBoundingClientRect())
      const x = Math.min(...els.map(r => r.x)), y = Math.min(...els.map(r => r.y))
      return { x: Math.max(0, x - 50), y: Math.max(0, y - 30), width: Math.max(...els.map(r => r.right)) - x + 80, height: Math.max(...els.map(r => r.bottom)) - y + 60 } }""")
    if box:
        pg.screenshot(path=os.path.join(out, name), clip=box)


def file_text():
    return open(note, encoding='utf-8').read()


with sync_playwright() as p:
    br = p.chromium.connect_over_cdp(f'http://127.0.0.1:{port}')
    pg = br.contexts[0].pages[0]
    pg.emulate_media(color_scheme='light', reduced_motion='reduce')
    pg.get_by_text('Biology revision', exact=True).first.click()
    pg.wait_for_selector('.cm-voice[data-state="ready"]', timeout=15000)
    pg.wait_for_timeout(500)
    start = pg.locator('.cm-voice-txstart')
    check('1 the Transcribe line shows under a voice note with no transcript', start.is_visible())
    shot(pg, '1-transcribe-line.png')

    start.click()
    pg.wait_for_timeout(400)
    busy = pg.locator('.cm-voice-txline[data-mode="busy"]')
    check('2a the progress line shows while it works', busy.count() == 1, pg.locator('.cm-voice-txwords').first.inner_text() if busy.count() else '')
    shot(pg, '2-progress.png')
    t = time.time()
    while time.time() - t < 120 and '<details data-transcript' not in pg.evaluate("() => document.querySelector('.cm-content').innerText") \
            and pg.locator('.cm-voice-tx').count() == 0:
        pg.wait_for_timeout(500)
    pg.wait_for_timeout(1200)  # autosave
    has_fold = '<details data-transcript="Lecture%203.m4a"><summary>Transcript</summary>' in file_text()
    check('2b the words are in the FILE as the transcript fold', has_fold)
    tx = pg.locator('.cm-voice-tx')
    check('2c and drawn as the transcript under the voice note', tx.count() == 1, tx.first.inner_text()[:90].replace('\n', ' ') if tx.count() else '')
    check('3 the Transcribe line is gone once there are words', pg.locator('.cm-voice-txstart').count() == 0)
    shot(pg, '3-transcript.png')

    # 4. undo / redo — focus the note's text first (the click on the line moved focus to a button)
    pg.locator('.cm-content').click(position={'x': 30, 'y': 10})
    pg.keyboard.press('Meta+z')
    pg.wait_for_timeout(300)
    check('4a one Cmd+Z takes the words back out', pg.locator('.cm-voice-tx').count() == 0)
    pg.keyboard.press('Meta+Shift+z')
    pg.wait_for_timeout(300)
    check('4b Cmd+Shift+Z puts them back', pg.locator('.cm-voice-tx').count() == 1)

    # 5. the right-click menu
    pg.locator('.cm-voice-row').first.click(button='right')
    pg.wait_for_timeout(300)
    menu = pg.evaluate("() => [...document.querySelectorAll('.menu .menu-item')].map(b => b.innerText.trim())")
    check('5 right-click offers "Transcribe again" after "Edit clip…"', 'Transcribe again' in menu, ' · '.join(menu))
    pg.keyboard.press('Escape')

    # 6. Separate
    pg.locator('.cm-voice-tx-separate').click()
    pg.wait_for_timeout(1500)
    txt = file_text()
    check('6 Separate leaves the words as ordinary text, the fold gone', '<details' not in txt and 'Transcript' not in txt and pg.locator('.cm-voice-tx').count() == 0)
    check('6b and the Transcribe line is back (no transcript any more)', pg.locator('.cm-voice-txstart').count() == 1)
    shot(pg, '6-separated.png')

    # 7. Settings → Extra features
    pg.locator('aside button[aria-label="Settings"]').first.click()
    pg.wait_for_timeout(1200)
    pg.locator('.genie').get_by_text('Extra features', exact=True).first.click()
    pg.wait_for_timeout(600)
    page_text = pg.locator('.genie').inner_text()
    check('7 Settings → Extra features: Markdown pro + More accurate transcription',
          'Markdown pro' in page_text and 'More accurate transcription' in page_text and 'Download · 550 MB' in page_text)
    pg.locator('.genie').screenshot(path=os.path.join(out, '7-extra-features.png'))
    pg.keyboard.press('Escape')
    br.close()

print(f"\n{sum(ok for _, ok in results)} of {len(results)} passed")
