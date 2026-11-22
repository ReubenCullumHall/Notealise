"""Can words be taken OUT of a document's tab and into a note? In one hidden window: a real mouse drag
selects text in a Word, Excel, CSV and text tab, Select All selects a PDF's text, and each selection
is pasted into a note. The computer's real clipboard is never touched (the paste is handed the words
directly), so this cannot overwrite whatever the person running it has copied.
usage: WORK=<build dir> python3 run_file_copy.py <port>"""
import sys, time
from playwright.sync_api import sync_playwright
import lab
from file_tabs_fixtures import make_pdf, make_docx, make_xlsx

PORT = int(sys.argv[1])
OUT = lab.WORK / 'file-copy'
OUT.mkdir(parents=True, exist_ok=True)
vault = lab.WORK / 'vault-copy'
ud = lab.WORK / 'ud-copy'
results = []


def check(name, ok, detail=''):
    results.append((name, bool(ok)))
    print(('PASS ' if ok else 'FAIL ') + name + (f' — {detail!r}' if detail else ''))


lab.seed_vault(vault, spaces=('Biology',), folders=1, notes=1, lines=10)
d = vault / 'Biology'
make_pdf(d / 'Handout.pdf')
make_docx(d / 'Lab report.docx')
make_xlsx(d / 'Marks.xlsx')
(d / 'Reading list.csv').write_text('Title,Author,Pages\nThe Cell,Alberts,1464\nGenes,Mukherjee,592\n')
(d / 'Ideas.txt').write_text('First idea\nSecond idea\n')
(d / 'Lecture.md').write_text('# Lecture\n\nStart\n')
lab.profile(ud, vault)
proc, _ = lab.launch(ud, PORT, OUT / 'app.log')

SEL = "() => getSelection().toString()"


def drag(page, a, b):
    page.mouse.move(*a)
    page.mouse.down()
    for i in range(1, 9):
        page.mouse.move(a[0] + (b[0] - a[0]) * i / 8, a[1] + (b[1] - a[1]) * i / 8)
        time.sleep(0.015)
    page.mouse.up()
    time.sleep(0.2)


def start_of(box):
    return box['x'] + 2, box['y'] + box['height'] / 2


def end_of(box):
    return box['x'] + box['width'] - 2, box['y'] + box['height'] / 2


def pdf_selection(page):
    """Ask Chromium's PDF reader what is selected, through its own controller."""
    js = """async () => {
      for (const file of ['pdf_viewer_wrapper.js', 'pdf_viewer_wrapper.rollup.js']) {
        try {
          const m = await import('./' + file)
          const c = m.PluginController && m.PluginController.getInstance()
          if (c) return (await c.getSelectedText()).selectedText
        } catch (e) { var why = String(e) }
      }
      return 'ERR ' + why
    }"""
    for _ in range(6):
        for f in page.frames:
            if 'mhjfbmdgcfjbbpaeojofohoefgiehjai' in f.url:
                try:
                    got = f.evaluate(js)
                    if got:
                        return got
                except Exception as e:
                    print('reader said:', str(e)[:120])
        time.sleep(0.4)
    return None


def paste_into_note(page, words):
    page.locator('.tree-title', has_text='Lecture').first.click()
    page.wait_for_selector('.cm-content')
    time.sleep(0.6)
    page.locator('.cm-content').click()
    page.keyboard.press('Meta+ArrowDown')
    page.evaluate("""(t) => { const d = new DataTransfer(); d.setData('text/plain', t)
      document.querySelector('.cm-content').dispatchEvent(new ClipboardEvent('paste', { clipboardData: d, bubbles: true, cancelable: true })) }""", words)
    time.sleep(1.0)
    return (d / 'Lecture.md').read_text()


try:
    with sync_playwright() as p:
        b, page = lab.connect(p, PORT)
        page.emulate_media(color_scheme='light', reduced_motion='null')
        page.wait_for_selector('.tree-row', timeout=30000)
        time.sleep(1.5)

        def open_row(title, settle=1.2):
            page.locator('.tree-title', has_text=title).first.click()
            time.sleep(settle)

        open_row('Lab report.docx')
        box = page.locator('.doc-word p').first.bounding_box()
        drag(page, (box['x'] + 1, box['y'] + box['height'] / 2), (box['x'] + box['width'] - 2, box['y'] + box['height'] / 2))
        word = page.evaluate(SEL)
        check('Word: dragging selects the words', 'cell membrane' in word, word)

        open_row('Marks.xlsx')
        row = page.locator('.doc-sheet tbody tr')
        drag(page, start_of(row.nth(1).locator('td').nth(0).bounding_box()), end_of(row.nth(2).locator('td').nth(2).bounding_box()))
        sheet = page.evaluate(SEL)
        check('Excel: dragging across cells selects them', 'Ada' in sheet and 'Bo' in sheet, sheet)
        check('Excel: the row numbers are not copied with the cells', '\n3\t' not in sheet and '\n3\n' not in sheet, sheet)

        open_row('Reading list.csv')
        row = page.locator('.doc-sheet tbody tr')
        drag(page, start_of(row.nth(1).locator('td').nth(0).bounding_box()), end_of(row.nth(2).locator('td').nth(1).bounding_box()))
        csv = page.evaluate(SEL)
        check('CSV: dragging across cells selects them', 'The Cell' in csv and 'Mukherjee' in csv, csv)
        check('CSV: the row numbers are not copied with the cells', '\n3\t' not in csv and '\n3\n' not in csv, csv)
        check('CSV: dragging does not change the file', (d / 'Reading list.csv').read_text().startswith('Title,Author,Pages\nThe Cell,Alberts,1464'))

        open_row('Ideas.txt')
        page.locator('.doc-text .cm-content').click()
        page.keyboard.press('Meta+a')
        time.sleep(0.2)
        text = page.evaluate(SEL)
        check('Text: Select All selects the words', 'Second idea' in text, text)

        open_row('Handout.pdf', 3.5)
        frame = page.locator('iframe.doc-pdf').bounding_box()
        page.mouse.click(frame['x'] + frame['width'] / 2, frame['y'] + frame['height'] / 2)
        time.sleep(0.4)
        page.keyboard.press('Meta+a')
        time.sleep(0.8)
        pdf = pdf_selection(page)
        check('PDF: Select All selects the words', bool(pdf) and 'Biology handout' in pdf, pdf or 'no answer from the reader')
        page.screenshot(path=str(OUT / 'pdf-selected.png'))

        for label, words, needle in (('Word', word, 'cell membrane'), ('Excel', sheet, 'Ada'), ('PDF', pdf or '', 'Biology handout')):
            if not words:
                check(f'{label}: pasted into a note', False, 'nothing to paste')
                continue
            on_disk = paste_into_note(page, words)
            check(f'{label}: pasted into a note', needle in on_disk, on_disk[-110:])
        b.close()
finally:
    lab.stop(proc)
bad = [n for n, ok in results if not ok]
print(f'{len(results) - len(bad)} of {len(results)} passed')
sys.exit(1 if bad else 0)
