"""Documents in their own tabs (docs/plans/file-tabs.md), in ONE hidden window: the sidebar lists them,
each kind opens in a tab (PDF, Word, Excel, CSV, text), a text and a CSV edit reach the file on disk, an
outside change reloads the tab, a document sits in a split beside a note, a dark space darkens them,
renaming a PDF keeps a note's link to it working, and nothing writes the PDF/Word/Excel files or keeps
earlier versions of them. Pictures go to $WORK/file-tabs/*.png.
usage: WORK=<build dir> python3 run_file_tabs.py <port>"""
import hashlib, json, os, subprocess, sys, time, zipfile
from pathlib import Path
from playwright.sync_api import sync_playwright
import lab
from file_tabs_fixtures import make_pdf, make_docx, make_xlsx

PORT = int(sys.argv[1])
OUT = lab.WORK / 'file-tabs'
OUT.mkdir(parents=True, exist_ok=True)
vault = lab.WORK / 'vault-files'
ud = lab.WORK / 'ud-files'
results = []


def check(name, ok, detail=''):
    results.append((name, bool(ok)))
    print(('PASS ' if ok else 'FAIL ') + name + (f' — {detail}' if detail else ''))


def seed():
    lab.seed_vault(vault, spaces=('Biology', 'Physics'), folders=1, notes=2, lines=20,
                   extra={'spaces': [{'folder': 'Biology', 'theme': 'light'}, {'folder': 'Physics', 'theme': 'dark'}]})
    for space in ('Biology', 'Physics'):
        d = vault / space
        make_pdf(d / 'Handout.pdf')
        make_docx(d / 'Lab report.docx')
        make_xlsx(d / 'Marks.xlsx')
        (d / 'Reading list.csv').write_text('Title,Author,Pages\nThe Cell,Alberts,1464\n"Gene, The",Mukherjee,592\n')
        (d / 'Ideas.txt').write_text('First idea\nSecond idea\n')
        (d / 'Slides.pptx').write_bytes(b'PK not really slides')
    (vault / 'Biology' / 'Cells.md').write_text('# Cells\n\nThe handout: [Handout.pdf](Handout.pdf)\n')


def sha(p):
    return hashlib.sha256(Path(p).read_bytes()).hexdigest()


seed()
lab.profile(ud, vault)
fixed = {n: sha(vault / 'Biology' / n) for n in ('Handout.pdf', 'Lab report.docx', 'Marks.xlsx')}
proc, _ = lab.launch(ud, PORT, OUT / 'app.log')
try:
    with sync_playwright() as p:
        b, page = lab.connect(p, PORT)
        page.emulate_media(color_scheme='light', reduced_motion='null')
        page.wait_for_selector('.tree-row', timeout=30000)
        time.sleep(1.5)
        rows = page.eval_on_selector_all('.tree-title', 'els => els.map(e => e.textContent)')
        check('sidebar lists the documents (and Slides) beside the notes',
              all(n in rows for n in ('Handout.pdf', 'Lab report.docx', 'Marks.xlsx', 'Reading list.csv', 'Ideas.txt', 'Slides.pptx', 'Cells')),
              str(rows))
        page.screenshot(path=str(OUT / '01-sidebar-light.png'))

        def open_row(title, settle=1.5):
            page.locator('.tree-title', has_text=title).first.click()
            time.sleep(settle)

        open_row('Handout.pdf', 3)
        # page.frames lags for a frame from another address (CLAUDE.md, Windows pass traps) — so the
        # frame element, its address, and the picture 02-pdf-light.png are what count.
        src = page.eval_on_selector('iframe.doc-pdf', 'f => f.src')
        check('a PDF opens in its tab, in a frame on the media address', src.startswith('notealise-media://') and 'Handout.pdf' in src, src[:60])
        check('one tab, not a note editor', page.locator('.cm-content').count() == 0)
        page.screenshot(path=str(OUT / '02-pdf-light.png'))

        open_row('Lab report.docx')
        word = page.locator('.doc-word').inner_text()
        check('a Word file shows its headings, table and link',
              page.locator('.doc-word h1').count() == 1 and page.locator('.doc-word h2').count() == 1
              and page.locator('.doc-word table td').count() == 6 and page.locator('.doc-word a').count() == 1, word[:80])
        page.screenshot(path=str(OUT / '03-word-light.png'))

        open_row('Marks.xlsx')
        cells = page.eval_on_selector_all('.doc-sheet tbody td', 'els => els.map(e => e.textContent)')
        check('a spreadsheet shows words, percentages and dates', 'Ada' in cells and '82%' in cells and any(c.startswith('2025-') for c in cells), str(cells[:12]))
        check('two sheets, two sheet buttons', page.locator('.doc-sheet-tabs [role=tab]').count() == 2)
        page.screenshot(path=str(OUT / '04-sheet-light.png'))

        # A CSV edit reaches the file.
        open_row('Reading list.csv')
        page.locator('.doc-sheet tbody tr').nth(1).locator('td').nth(2).click()
        page.keyboard.press('Meta+a')
        page.keyboard.type('600')
        page.keyboard.press('Enter')
        page.keyboard.press('Escape')
        time.sleep(1.2)
        csv = (vault / 'Biology' / 'Reading list.csv').read_text()
        check('a CSV cell edit is saved into the file', csv == 'Title,Author,Pages\nThe Cell,Alberts,600\n"Gene, The",Mukherjee,592\n', repr(csv))
        page.screenshot(path=str(OUT / '05-csv-light.png'))

        # A text edit reaches the file; an outside change comes back into the tab.
        open_row('Ideas.txt')
        page.locator('.doc-text .cm-content').click()
        page.keyboard.press('Meta+ArrowDown')
        page.keyboard.type('Third idea')
        time.sleep(1.2)
        txt = (vault / 'Biology' / 'Ideas.txt').read_text()
        check('typing in a text file is saved into the file', txt == 'First idea\nSecond idea\nThird idea', repr(txt))
        # Past the 1.5 s in which the app ignores the echo of its OWN save (vault.ts markWrite) — the
        # same for a note; a change from elsewhere inside that moment is not seen, as with notes.
        time.sleep(1.0)
        (vault / 'Biology' / 'Ideas.txt').write_text('Changed in another app\n')
        time.sleep(2.0)
        shown = page.locator('.doc-text .cm-content').inner_text()
        check('a change made in another app shows in the tab', 'Changed in another app' in shown, repr(shown[:60]))
        page.screenshot(path=str(OUT / '06-text-light.png'))

        # A note and a PDF side by side.
        open_row('Cells')
        page.locator('[aria-label="Split the screen"]').first.click()
        time.sleep(0.8)
        open_row('Handout.pdf', 3)
        check('a split holds a note and a PDF', page.locator('.pane-col').count() == 2 and page.locator('.cm-content').count() == 1
              and page.locator('iframe.doc-pdf').count() == 1)
        page.screenshot(path=str(OUT / '07-split-light.png'))

        # Rename the PDF from the sidebar: the note's link follows it.
        page.locator('.tree-title', has_text='Handout.pdf').first.click(button='right')
        time.sleep(0.4)
        page.get_by_text('Rename', exact=True).click()
        time.sleep(0.4)
        page.keyboard.press('Meta+a')
        page.keyboard.type('Week 1 handout')
        page.keyboard.press('Enter')
        time.sleep(2.0)
        note = (vault / 'Biology' / 'Cells.md').read_text()
        check('renamed with its extension kept', (vault / 'Biology' / 'Week 1 handout.pdf').exists(), str(sorted(x.name for x in (vault / 'Biology').iterdir())))
        check("the note's link follows the renamed PDF", 'Week%201%20handout.pdf' in note or '<Week 1 handout.pdf>' in note, repr(note))
        check('the open PDF tab follows the rename', page.locator('iframe.doc-pdf').count() == 1)

        # A dark space.
        page.locator('aside button[data-tip]', has_text='2').first.click()
        time.sleep(2.0)
        page.emulate_media(color_scheme='dark', reduced_motion='null')
        open_row('Handout.pdf', 3)
        dim = page.locator('iframe.doc-pdf[data-dim]').count()
        check('in a dark space the PDF pages are darkened', dim == 1)
        page.screenshot(path=str(OUT / '08-pdf-dark.png'))
        page.locator('[aria-label="Show the pages in their own colours"]').click()
        time.sleep(0.6)
        check('…and the corner button shows them in their own colours', page.locator('iframe.doc-pdf[data-dim]').count() == 0)
        page.screenshot(path=str(OUT / '09-pdf-dark-original.png'))
        open_row('Lab report.docx')
        page.screenshot(path=str(OUT / '10-word-dark.png'))
        open_row('Marks.xlsx')
        page.screenshot(path=str(OUT / '11-sheet-dark.png'))
        open_row('Ideas.txt')
        page.screenshot(path=str(OUT / '12-text-dark.png'))
        b.close()
finally:
    lab.stop(proc)

after = {n: sha(vault / 'Biology' / ('Week 1 handout.pdf' if n == 'Handout.pdf' else n)) for n in fixed}
check('the PDF, Word and Excel files were never written', after == fixed)
versions = vault / '.mdnotes' / 'versions'
kept = [str(x.relative_to(versions)) for x in versions.rglob('*') if x.is_file()] if versions.exists() else []
check('no earlier versions kept of a document', not any(('.txt' in k or '.csv' in k or '.pdf' in k) for k in kept), str(kept[:5]))
print(f'\n{sum(ok for _, ok in results)}/{len(results)} passed')
