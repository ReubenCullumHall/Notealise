"""What happens to a document's tab when the file moves under it, and the "Edit in …" button, in ONE
hidden window on made-up files. Part 1: the button (see beside_hook.cjs: no real app opens and nothing
the person is using moves). Part 2: files renamed, moved, replaced and deleted, in the app and from
outside it, including in the moment after typing.
usage: WORK=<build dir> python3 run_file_moves.py <port>"""
import json, os, shutil, subprocess, sys, time, traceback
from pathlib import Path
from playwright.sync_api import sync_playwright
import lab
from file_tabs_fixtures import make_pdf, make_docx, make_xlsx

PORT = int(sys.argv[1])
OUT = lab.WORK / 'file-moves'
OUT.mkdir(parents=True, exist_ok=True)
vault = lab.WORK / 'vault-moves'
ud = lab.WORK / 'ud-moves'
BIO = vault / 'Biology'
OUTSIDE = lab.WORK / 'outside-the-vault'
FLAGS = OUT / 'flags.json'
LOG = Path(str(FLAGS) + '.log')
OTHER_OUT = OUT / 'other.json'
HERE = Path(__file__).resolve().parent
WORK_BOX = {'x': -1400, 'y': 60, 'width': 1440, 'height': 700}
ODD = 'Bob\'s "notes" $(touch pwned) (2).pdf'
results, errors = [], []


def check(name, ok, detail=''):
    results.append((name, bool(ok)))
    print(('PASS ' if ok else 'FAIL ') + name + (f' — {str(detail)[:190]}' if detail != '' else ''), flush=True)


def flags(**kw):
    FLAGS.write_text(json.dumps({'trusted': True, 'other': f'pid:{other.pid}', 'work': WORK_BOX, 'openFails': False, **kw}))


def logged():
    return [json.loads(x) for x in LOG.read_text().splitlines()] if LOG.exists() else []


lab.seed_vault(vault, spaces=('Biology',), folders=1, notes=1, lines=8)
(BIO / 'Folder A').mkdir()
(BIO / 'Folder A' / 'Inside A.md').write_text('# Inside\n')
(BIO / 'Folder B').mkdir()
OUTSIDE.mkdir(exist_ok=True)
for n in ('Handout', 'Moved pdf', 'Renamed pdf', 'Replaced pdf', 'Bin pdf', 'Gone pdf', 'Case pdf'):
    make_pdf(BIO / f'{n}.pdf', 1)
make_pdf(BIO / ODD, 1)
make_pdf(BIO / 'Folder A' / 'In folder.pdf', 1)
for n in ('Essay', 'Moved word', 'Saved word'):
    make_docx(BIO / f'{n}.docx')
for n in ('Marks', 'Moved sheet'):
    make_xlsx(BIO / f'{n}.xlsx')
(BIO / 'Reading.csv').write_text('Title,Pages\nCells,10\n')
for n in ('Plain', 'Typed then moved', 'Typed then deleted', 'Typed then renamed in app', 'Typed then replaced', 'Back again'):
    (BIO / f'{n}.txt').write_text('first line\n')
(BIO / 'Typed sheet.csv').write_text('A,B\n1,2\n')
lab.profile(ud, vault)
LOG.unlink(missing_ok=True)
env = {k: v for k, v in os.environ.items() if k != 'ELECTRON_RUN_AS_NODE'}
other = subprocess.Popen([str(lab.ELECTRON), str(HERE / 'beside_other.cjs'), f'--user-data-dir={OUT}/ud-other'],
                         env={**env, 'OTHER_TITLE': 'Handout', 'OTHER_OUT': str(OTHER_OUT)},
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1.5)
flags(trusted=False)
os.environ['BESIDE_FLAGS'] = str(FLAGS)
os.environ['NODE_OPTIONS'] = f'--require "{HERE / "beside_hook.cjs"}"'
proc, _ = lab.launch(ud, PORT, OUT / 'app.log')

DOC = '.doc-text, .doc-word, .doc-sheet, iframe.doc-pdf'


def case(name):
    def wrap(f):
        try:
            f()
        except Exception as e:
            check(f'{name}: ran to the end', False, f'{type(e).__name__}: {e}')
            traceback.print_exc(limit=2)
            page.keyboard.press('Escape')
        return f
    return wrap


try:
    with sync_playwright() as p:
        b, page = lab.connect(p, PORT)
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.emulate_media(color_scheme='light', reduced_motion='null')
        page.wait_for_selector('.tree-row', timeout=30000)
        time.sleep(1.5)

        def row(title):
            return page.locator('.tree-row', has=page.locator('.tree-title', has_text=title)).first

        def open_row(title, settle=1.2):
            row(title).scroll_into_view_if_needed()
            row(title).click()
            time.sleep(settle)

        def shown():
            return page.locator(DOC).count()

        def in_sidebar(title):
            return page.locator('.tree-title', has_text=title).count() > 0

        def notice():
            n = page.locator('.notice')
            return n.inner_text() if n.count() else ''

        def bounds():
            return page.evaluate('({ x: screenX, y: screenY, width: outerWidth, height: outerHeight })')

        def press(label):
            page.locator(f'button[aria-label="{label}"]').first.click()

        def type_end(words):
            page.locator('.doc-text .cm-content').click()
            page.keyboard.press('Meta+ArrowDown')
            page.keyboard.type(words)

        def rename_in_app(title, new):
            row(title).scroll_into_view_if_needed()
            row(title).click(button='right')
            time.sleep(0.25)
            page.get_by_text('Rename', exact=True).first.click()
            time.sleep(0.25)
            page.keyboard.press('Meta+a')
            page.keyboard.type(new)
            page.keyboard.press('Enter')
            time.sleep(1.5)

        # ---------- Part 1: the button ----------
        @case('button words')
        def _():
            open_row('Handout.pdf', 1.8)
            check('a PDF offers its real app', page.locator('button[aria-label="Edit in Preview"]').count() == 1)
            open_row('Essay.docx', 1.4)
            check('a Word file offers Word', page.locator('button[aria-label="Edit in Word"]').count() == 1)
            open_row('Plain.txt', 0.9)
            check('a text file keeps the plain button (it is edited in its tab)', page.locator('button[aria-label="Open in its own app"]').count() == 1)
            open_row('Reading.csv', 0.9)
            check('a CSV keeps the plain button', page.locator('button[aria-label="Open in its own app"]').count() == 1)

        start = bounds()

        @case('no permission')
        def _():
            open_row('Handout.pdf', 1.8)
            flags(trusted=False)
            press('Edit in Preview')
            time.sleep(0.8)
            check('no permission yet: the Mac is asked, and the message says what to do', any(x.get('asked') for x in logged()) and 'Accessibility' in notice(), notice())
            check('…no file opened behind its box', not any('opened' in x for x in logged()))
            check('…and the window has not moved', bounds() == start, bounds())

        @case('lined up')
        def _():
            flags()
            press('Edit in Preview')
            time.sleep(2.2)
            there = json.loads(OTHER_OUT.read_text())
            # What Notealise asked for: macOS keeps 40 points of a window on screen, so the stand-in
            # "screen" off to the side can't show the real result.
            ours = [x['setBounds'] for x in logged() if 'setBounds' in x][-1]
            check('the other app lands on the right half', there['x'] == -680 and there['width'] == 720 and there['y'] == 60, there)
            check('Notealise takes the left half', ours['x'] == -1400 and ours['width'] == 720, ours)
            check('they meet with no gap and no overlap', ours['x'] + ours['width'] == there['x'], (ours, there))
            check('the file is opened from its real place', any(x.get('opened') == str(BIO / 'Handout.pdf') for x in logged()), logged()[-1:])
            check('the message says so and offers Undo', 'beside this tab' in notice() and page.locator('.notice-action').count() == 1, notice())

        @case('second file')
        def _():
            open_row('Essay.docx', 1.4)
            press('Edit in Word')
            time.sleep(2.2)
            page.locator('.notice-action').click()
            time.sleep(0.9)
            check('Undo after a second file goes back to the ORIGINAL size', bounds() == start, (bounds(), start))

        @case('can not move')
        def _():
            open_row('Handout.pdf', 1.6)
            flags(other='pid:999999')
            press('Edit in Preview')
            time.sleep(9.5)
            check('a window that can’t be moved: says so', 'couldn’t be moved' in notice(), notice())
            check('…and Notealise stays the size it was', bounds() == start, bounds())

        @case('open fails')
        def _():
            flags(openFails=True)
            press('Edit in Preview')
            time.sleep(0.8)
            check('a file the system won’t open: says so', 'Couldn’t open' in notice(), notice())
            check('…and nothing moves', bounds() == start)

        @case('narrow')
        def _():
            flags(work={**WORK_BOX, 'width': 1000})
            press('Edit in Preview')
            time.sleep(1.0)
            check('a screen too small for both: says so, nothing moves', 'too small' in notice() and bounds() == start, notice())
            flags()

        @case('odd name')
        def _():
            open_row('touch pwned', 1.8)
            press('Edit in Preview')
            time.sleep(2.2)
            check('a file name with quotes and $( ) runs nothing', not list(lab.WORK.rglob('pwned')) and not (Path.cwd() / 'pwned').exists())
            check('…and still opens that exact file', any(x.get('opened') == str(BIO / ODD) for x in logged()))
            if page.locator('.notice-action').count():
                page.locator('.notice-action').click()
            time.sleep(0.8)

        # ---------- Part 2: the file moves under its tab ----------
        @case('finder move pdf')
        def _():
            open_row('Moved pdf.pdf', 1.6)
            shutil.move(BIO / 'Moved pdf.pdf', BIO / 'Folder B' / 'Moved pdf.pdf')
            time.sleep(2.2)
            check('PDF moved in Finder: no dead tab left', page.locator('iframe.doc-pdf').count() == 0 or 'Folder' in page.locator('iframe.doc-pdf').first.get_attribute('src'))
            check('…the file is where it was put, once', (BIO / 'Folder B' / 'Moved pdf.pdf').exists() and not (BIO / 'Moved pdf.pdf').exists())

        @case('finder rename word')
        def _():
            open_row('Moved word.docx', 1.2)
            (BIO / 'Moved word.docx').rename(BIO / 'Moved word 2.docx')
            time.sleep(2.2)
            check('Word renamed in Finder: its old name leaves the sidebar, the new one arrives', in_sidebar('Moved word 2.docx') and page.locator('.tree-title', has_text='Moved word.docx').count() == 0)
            check('…the old file is not brought back', not (BIO / 'Moved word.docx').exists())

        @case('moved out')
        def _():
            open_row('Moved sheet.xlsx', 1.2)
            shutil.move(BIO / 'Moved sheet.xlsx', OUTSIDE / 'Moved sheet.xlsx')
            time.sleep(2.2)
            check('Excel moved out of the notes folder: tab closes', page.locator('.doc-sheet').count() == 0)
            check('…and nothing is written back', not (BIO / 'Moved sheet.xlsx').exists())

        @case('type then finder move')
        def _():
            open_row('Typed then moved.txt', 1.0)
            type_end('WORDS-A')
            (BIO / 'Typed then moved.txt').rename(BIO / 'Folder B' / 'Typed then moved.txt')
            time.sleep(2.6)
            where = [str(x.relative_to(vault)) for x in vault.rglob('*') if x.is_file() and x.suffix in ('.txt', '.md') and 'WORDS-A' in x.read_text(errors='ignore')]
            check('typing then a Finder move: the words are not lost', bool(where), where)
            check('…the file is not recreated at its old place', not (BIO / 'Typed then moved.txt').exists())

        @case('type then delete')
        def _():
            open_row('Typed then deleted.txt', 1.0)
            type_end('WORDS-B')
            (BIO / 'Typed then deleted.txt').unlink()
            where = []
            for _ in range(24):  # with no other click: it must get there by itself
                time.sleep(0.25)
                where = [str(x.relative_to(vault)) for x in vault.rglob('*') if x.is_file() and x.suffix in ('.txt', '.md') and 'WORDS-B' in x.read_text(errors='ignore')]
                if where:
                    break
            check('typing then a delete: the words are kept somewhere', bool(where), where)

        @case('type then rename in app')
        def _():
            open_row('Typed then renamed in app.txt', 1.0)
            type_end('WORDS-C')
            rename_in_app('Typed then renamed in app.txt', 'Renamed in app')
            new = BIO / 'Renamed in app.txt'
            check('typing then a rename in the app: words reach the new name', new.exists() and 'WORDS-C' in new.read_text(), sorted(x.name for x in BIO.glob('*amed*')))
            check('…no copy at the old name', not (BIO / 'Typed then renamed in app.txt').exists())
            check('…the tab follows', page.locator('.doc-text').count() == 1)
            type_end('WORDS-D')
            time.sleep(1.0)
            check('…and typing after the rename saves to the new name', 'WORDS-D' in new.read_text())

        @case('rename pdf in app then edit button')
        def _():
            open_row('Renamed pdf.pdf', 1.5)
            rename_in_app('Renamed pdf.pdf', 'Renamed pdf 2')
            time.sleep(1.2)
            check('PDF renamed in the app: its tab follows', page.locator('iframe.doc-pdf').count() == 1 and 'Renamed%20pdf%202' in page.locator('iframe.doc-pdf').first.get_attribute('src'))
            press('Edit in Preview')
            time.sleep(2.2)
            check('…and Edit opens the file at its NEW name', logged()[-1].get('opened') == str(BIO / 'Renamed pdf 2.pdf') or any(x.get('opened') == str(BIO / 'Renamed pdf 2.pdf') for x in logged()), logged()[-2:])
            if page.locator('.notice-action').count():
                page.locator('.notice-action').click()
            time.sleep(0.8)

        @case('edit button on a file just gone')
        def _():
            open_row('Gone pdf.pdf', 1.5)
            before = len(logged())
            (BIO / 'Gone pdf.pdf').unlink()
            press('Edit in Preview')
            time.sleep(0.7)
            check('Edit pressed the moment a file goes: nothing opens, no crash', len(logged()) == before, logged()[before:])

        @case('folder renamed outside')
        def _():
            open_row('In folder.pdf', 1.5) if in_sidebar('In folder.pdf') else (row('Folder A').click(), time.sleep(.4), open_row('In folder.pdf', 1.5))
            (BIO / 'Folder A').rename(BIO / 'Folder A2')
            time.sleep(2.6)
            frames = page.locator('iframe.doc-pdf')
            check('its folder renamed in Finder: no tab left on the old address',
                  frames.count() == 0 or 'Folder%20A%2F' not in (frames.first.get_attribute('src') or ''))
            check('…the app is still working', page.locator('.tree-row').count() > 0)

        @case('atomic replace')
        def _():
            open_row('Saved word.docx', 1.2)
            before = page.locator('.doc-word').inner_text()
            tmp = BIO / '.~saved.tmp'
            zipped = OUT / 'new.docx'
            make_docx(zipped)
            import zipfile
            with zipfile.ZipFile(zipped) as z, zipfile.ZipFile(tmp, 'w') as o:
                for i in z.infolist():
                    d = z.read(i.filename)
                    o.writestr(i, d.replace(b'Lab report', b'Second version') if i.filename == 'word/document.xml' else d)
            os.replace(tmp, BIO / 'Saved word.docx')
            time.sleep(2.4)
            after = page.locator('.doc-word').inner_text() if page.locator('.doc-word').count() else ''
            check('Word saves a new version the way Word does: the tab shows it', 'Second version' in after, (before[:20], after[:20]))

        @case('pdf replaced')
        def _():
            open_row('Replaced pdf.pdf', 1.6)
            a = page.locator('iframe.doc-pdf').get_attribute('src')
            tmp = BIO / '.rep.tmp'
            make_pdf(tmp, 2)
            time.sleep(1.1)
            os.replace(tmp, BIO / 'Replaced pdf.pdf')
            time.sleep(2.4)
            frame = page.locator('iframe.doc-pdf')
            check('a PDF saved by its real app reloads in its tab', frame.count() == 1 and frame.get_attribute('src') != a)

        @case('away and back')
        def _():
            open_row('Back again.txt', 1.0)
            (BIO / 'Back again.txt').rename(OUTSIDE / 'Back again.txt')
            time.sleep(0.15)
            (OUTSIDE / 'Back again.txt').rename(BIO / 'Back again.txt')
            time.sleep(2.4)
            check('a file moved away and straight back is still there, unchanged', (BIO / 'Back again.txt').read_text() == 'first line\n', (BIO / 'Back again.txt').read_text())
            check('…and shows in the sidebar', in_sidebar('Back again.txt'))

        @case('case only')
        def _():
            open_row('Case pdf.pdf', 1.5)
            (BIO / 'Case pdf.pdf').rename(BIO / 'case PDF.pdf')
            time.sleep(2.4)
            names = [x.name for x in BIO.iterdir() if x.name.lower() == 'case pdf.pdf']
            check('a capitals-only rename in Finder: still one file', names == ['case PDF.pdf'], names)
            check('…one row in the sidebar', page.locator('.tree-title').filter(has_text='ase').count() == 1 or page.evaluate("[...document.querySelectorAll('.tree-title')].filter(e => e.textContent.toLowerCase() === 'case pdf.pdf').length") == 1)

        @case('type then replaced')
        def _():
            open_row('Typed then replaced.txt', 1.0)
            type_end('MINE')
            (BIO / 'Typed then replaced.txt').write_text('other program\n')
            time.sleep(2.6)
            on = (BIO / 'Typed then replaced.txt').read_text()
            kept = [x.name for x in vault.rglob('*') if x.is_file() and x.suffix in ('.txt', '.md') and 'MINE' in x.read_text(errors='ignore')]
            check('typing while another program saves: its version is not written over', on == 'other program\n', on)
            check('…and what was typed is kept in a note', any(k.startswith('Recovered') for k in kept), kept)
            time.sleep(0.6)
            check('…and the tab shows the other program’s version', 'other program' in page.locator('.doc-text').inner_text())

        @case('ordinary saves')
        def _():
            count = lambda: len(list(vault.glob('Recovered*')))
            had = count()
            open_row('Plain.txt', 1.0)
            for w in ('one', 'two', 'three'):
                type_end(f' {w}')
                time.sleep(1.0)
            check('ordinary typing, saved three times: all in the file', all(w in (BIO / 'Plain.txt').read_text() for w in ('one', 'two', 'three')), (BIO / 'Plain.txt').read_text())
            open_row('Typed sheet.csv', 1.0)
            for v in ('x, with a comma', 'say "hi"', 'plain'):
                page.locator('.doc-sheet tbody tr').nth(1).locator('td').nth(1).click()
                page.keyboard.press('Meta+a')
                page.keyboard.type(v)
                page.keyboard.press('Escape') if False else page.keyboard.press('Tab')
                page.keyboard.press('Escape')
                time.sleep(1.0)
            page.locator('.doc-new-row td').first.click()
            page.keyboard.type('new row')
            page.keyboard.press('Enter')
            time.sleep(1.0)
            page.locator('.doc-sheet tbody tr').nth(0).locator('td').nth(0).click()
            page.keyboard.press('Meta+a')
            page.keyboard.type('renamed')
            page.keyboard.press('Tab')
            page.keyboard.press('Escape')
            time.sleep(1.0)
            csv = (BIO / 'Typed sheet.csv').read_text()
            check('ordinary CSV edits, quotes and a new row: all in the file', 'plain' in csv and 'new row' in csv and 'renamed' in csv, repr(csv))
            check('…and no false "Recovered" note', count() == had, count() - had)

        @case('bin open')
        def _():
            open_row('Bin pdf.pdf', 1.5)
            row('Bin pdf.pdf').hover()
            row('Bin pdf.pdf').locator('[data-tip="Move to bin"]').click()
            time.sleep(1.6)
            check('binning an open PDF: tab closes, file is in the bin', not (BIO / 'Bin pdf.pdf').exists() and any('Bin pdf.pdf' in x.name for x in (vault / '.mdnotes' / 'trash').rglob('*')))

        page.screenshot(path=str(OUT / 'end.png'))
        check('no errors from the page', not [e for e in errors if 'preloadScripts' not in e and 'sandboxed_renderer' not in e], errors[:3])
        b.close()
finally:
    lab.stop(proc)
    other.terminate()
bad = [n for n, ok in results if not ok]
print(f'{len(results) - len(bad)} of {len(results)} passed')
for n in bad:
    print('  still failing:', n)
sys.exit(1 if bad else 0)
