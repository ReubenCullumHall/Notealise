"""Documents in tabs — the awkward cases (docs/plans/file-tabs.md), after run_file_tabs.py: odd names, big,
empty, damaged and non-UTF-8 files, a page that must not be framed, bin / archive / move / pin while a tab is
open, files added and deleted in Finder, a save on leaving a tab, undo, Cmd+click, search, a space switch, a
quit straight after typing, and the tabs coming back after a restart (the ONE relaunch, said up front).
Any error the page throws is a FAIL. Pictures go to $WORK/file-tabs-more/*.png.
usage: WORK=<build dir> python3 run_file_tabs_more.py <port>
       APP_BIN=<…/Notealise.app> … — the PACKAGED app (opened in the background with `open -g`, moved off-screen)."""
import hashlib, json, os, subprocess, sys, time, zipfile
from pathlib import Path
from playwright.sync_api import sync_playwright
import lab
from file_tabs_fixtures import make_pdf, make_docx, make_xlsx

PORT = int(sys.argv[1])
APP = os.environ.get('APP_BIN')
OUT = lab.WORK / ('file-tabs-more-packaged' if APP else 'file-tabs-more')
OUT.mkdir(parents=True, exist_ok=True)
vault = lab.WORK / 'vault-files-more'
ud = lab.WORK / 'ud-files-more'
results = []
errors = []
step = ['start']
BIO = vault / 'Biology'


def check(name, ok, detail=''):
    results.append((name, bool(ok)))
    print(('PASS ' if ok else 'FAIL ') + name + (f' — {detail}' if detail else ''), flush=True)


def seed():
    lab.seed_vault(vault, spaces=('Biology', 'Physics'), folders=1, notes=1, lines=10,
                   extra={'spaces': [{'folder': 'Biology', 'theme': 'light'}, {'folder': 'Physics', 'theme': 'dark'}]})
    (BIO / 'Folder M').mkdir()  # sorts mid-list: a drag near the list's edge scrolls it under the robot
    (BIO / 'Folder M' / 'Inside.md').write_text('# Inside\n')
    make_pdf(BIO / 'Handout.pdf')
    make_pdf(BIO / 'Résumé #1 (50%) & co.pdf', 1)
    make_docx(BIO / 'Essay.docx')
    make_xlsx(BIO / 'Marks.xlsx')
    (BIO / 'list.csv').write_text('a,b\n1,2\n')
    (BIO / 'big.csv').write_text('n,sq\n' + ''.join(f'{i},{i * i}\n' for i in range(3000)))
    (BIO / 'latin.csv').write_bytes('name,city\nZoë,Málaga\n'.encode('cp1252'))
    (BIO / 'empty.txt').write_text('')
    (BIO / 'Ideas.txt').write_text('First idea\n')
    (BIO / 'broken.docx').write_bytes(b'not a zip')
    (BIO / 'broken.pdf').write_bytes(b'%PDF-1.4 nothing else')
    with open(BIO / 'huge.xlsx', 'wb') as f:
        f.truncate(101 * 1024 * 1024)  # over the 100 MB a tab reads; sparse, costs no disk
    # A page that must never run, and the same page wearing a .pdf name.
    page = '<html><body><script>document.title="RAN";try{parent.postMessage("RAN","*")}catch(e){}</script>RAN</body></html>'
    (BIO / 'page.html').write_text(page)
    (BIO / 'evil.pdf').write_text(page)
    # Pictures in a note still show from the media address after its new headers (CLAUDE.md: a change to
    # the address is checked in a packaged app).
    import struct, zlib
    def png(w, h):
        raw = b''.join(b'\x00' + b'\xff\x00\x00' * w for _ in range(h))
        chunk = lambda t, d: struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
        return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b'')
    (BIO / 'dot.png').write_bytes(png(40, 30))
    (BIO / 'draw.svg').write_text('<svg xmlns="http://www.w3.org/2000/svg" width="50" height="20"><rect width="50" height="20" fill="teal"/></svg>')
    (BIO / 'Pictures.md').write_text('# Pictures\n\n![](dot.png)\n\n![](draw.svg)\n')
    (BIO / 'Control.md').write_text('# Control\n')  # the drag check's control note
    (BIO / 'Cells.md').write_text('# Cells\n\n[Handout.pdf](Handout.pdf) and [Essay.docx](Essay.docx)\n')


def sha(p):
    return hashlib.sha256(Path(p).read_bytes()).hexdigest()


def launch():
    if not APP:
        return lab.launch(ud, PORT, OUT / 'app.log')[0]
    # A packaged app takes no NODE_OPTIONS (its fuses), so quiet.cjs can't hide it: open it in the
    # background (never takes focus) and push its window off-screen as soon as it exists.
    subprocess.run(['open', '-g', '-n', '-a', APP, '--args', f'--user-data-dir={ud}', f'--remote-debugging-port={PORT}', '--mute-audio'], check=True)
    for _ in range(60):
        r = subprocess.run(['osascript', '-e', f'tell application "System Events" to tell (first process whose unix id is {packaged_pid()}) to set {{position, size}} of window 1 to {{{{-4000, 40}}, {{1300, 1116}}}}'],
                           capture_output=True, text=True) if packaged_pid() else None
        if r and r.returncode == 0:
            break
        time.sleep(0.25)
    return None


def packaged_pid():
    r = subprocess.run(['pgrep', '-f', f'{APP}/Contents/MacOS/Notealise --user-data-dir={ud}'], capture_output=True, text=True)
    return r.stdout.split()[0] if r.stdout.split() else None


def stop(proc):
    if proc:
        lab.stop(proc)
    elif APP:
        pid = packaged_pid()
        if pid:
            subprocess.run(['kill', pid])
            time.sleep(2)


def connect(p):
    b, page = lab.connect(p, PORT)
    page.on('pageerror', lambda e: errors.append(f'[{step[0]}] ' + str(e)[:140]))
    page.on('console', lambda m: errors.append(f'[{step[0]}] ' + m.text[:140]) if m.type == 'error' and 'Autofill' not in m.text else None)
    page.emulate_media(color_scheme='light', reduced_motion='null')
    page.wait_for_selector('.tree-row', timeout=30000)
    if APP:  # the window exists now: off-screen, and tall enough that the list doesn't scroll under a drag
        r = subprocess.run(['osascript', '-e', f'tell application "System Events" to tell (first process whose unix id is {packaged_pid()}) to set {{position, size}} of window 1 to {{{{-4000, 40}}, {{1300, 1116}}}}'],
                           capture_output=True, text=True)
        time.sleep(0.5)
        print('  window now', page.evaluate('[innerWidth, innerHeight]'), r.stderr.strip()[:80])
    time.sleep(1.5)
    return b, page


def row(page, title):
    return page.locator('.tree-row', has=page.locator('.tree-title', has_text=title)).first


def open_row(page, title, settle=1.5, **kw):
    step[0] = title
    row(page, title).scroll_into_view_if_needed()
    page.locator('.tree-title', has_text=title).first.click(**kw)
    time.sleep(settle)


seed()
lab.profile(ud, vault)
fixed = {n: sha(BIO / n) for n in ('Handout.pdf', 'Essay.docx', 'Marks.xlsx')}
proc = launch()
try:
    with sync_playwright() as p:
        b, page = connect(p)

        open_row(page, 'Pictures', 2.5)
        sizes = page.eval_on_selector_all('.cm-content img', 'els => els.map(e => [e.naturalWidth, e.naturalHeight])')
        check('pictures in a note still show (a .png and an .svg)', [40, 30] in sizes and [50, 20] in sizes, str(sizes))

        # Awkward name: #, %, &, brackets, an accent.
        open_row(page, 'Résumé', 3)
        src = page.eval_on_selector('iframe.doc-pdf', 'f => f.src')
        check('a PDF named "Résumé #1 (50%) & co.pdf" opens', 'R%C3%A9sum%C3%A9%20%231%20(50%25)%20%26%20co.pdf' in src, src[-70:])
        page.screenshot(path=str(OUT / '01-awkward-name.png'))
        # The PDF reader's frames are a page of their own: they must not have the app's bridge (window.api —
        # every read and write the app can do). Chromium logs a failed attempt to set one up there
        # ("sandboxed_renderer… preloadScripts") — checked here that the attempt really did fail.
        time.sleep(1.0)
        bridge = {}
        for f in page.frames:
            if f == page.main_frame:
                continue
            try:
                bridge[f.url[:40]] = f.evaluate('typeof window.api')
            except Exception as e:
                bridge[f.url[:40]] = 'unreachable'
        check("the PDF reader's frames can't reach the app's files (no window.api there)",
              bridge and all(v in ('undefined', 'unreachable') for v in bridge.values()), str(bridge))

        # Big, non-UTF-8, empty, damaged, too big.
        open_row(page, 'big.csv')
        note = page.locator('[role=status]').first.inner_text()
        check('a 3,000-row CSV shows the first 2,000 and says so', 'first 2,000 rows' in note and page.locator('.doc-sheet tbody tr').count() == 2000, note)
        check('…and can’t be changed (saving would lose the rest)', page.locator('.doc-sheet td.can-edit').count() == 0)
        open_row(page, 'latin.csv')
        note = page.locator('[role=status]').first.inner_text()
        cells = page.eval_on_selector_all('.doc-sheet tbody td', 'els => els.map(e => e.textContent)')
        check('a non-UTF-8 CSV shows its words and says it can’t be changed here', 'Zoë' in cells and 'Málaga' in cells and 'UTF-8' in note, str(cells[:4]))
        open_row(page, 'empty.txt')
        page.locator('.doc-text .cm-content').click()
        page.keyboard.type('Now it has words')
        time.sleep(1.0)
        check('an empty text file takes typing and saves it', (BIO / 'empty.txt').read_text() == 'Now it has words')
        open_row(page, 'broken.docx')
        check('a damaged Word file says it can’t be shown', 'can’t be shown here' in page.locator('.pane-body').inner_text())
        open_row(page, 'huge.xlsx')
        check('a 101 MB spreadsheet says it is too big to show', 'too big to show here' in page.locator('.pane-body').inner_text())
        open_row(page, 'broken.pdf', 2.5)
        page.screenshot(path=str(OUT / '02-broken-pdf.png'))

        # A page in the vault must not run, framed directly or wearing a .pdf name. The refusals it makes
        # the page log are the point, so errors during the probe are kept apart.
        errs_before = len(errors)
        got = []
        page.expose_function('noteRan', lambda m: got.append(m))
        r = page.evaluate("""async () => {
          window.addEventListener('message', (e) => window.noteRan(String(e.data)))
          const out = {}
          for (const p of ['Biology/page.html', 'Biology/evil.pdf']) {
            const f = document.createElement('iframe'); f.src = await window.api.mediaUrl(p)
            document.body.appendChild(f); await new Promise((r) => setTimeout(r, 2000))
            let inside = 'unreadable'
            try { inside = f.contentDocument ? (f.contentDocument.body?.innerText ?? '').slice(0, 20) : 'no document' } catch (e) { inside = 'cross-origin' }
            out[p] = inside; f.remove()
          }
          out.title = document.title
          return out }""")
        time.sleep(0.5)
        check('a vault .html page is never run in a frame', 'RAN' not in got and r['title'] != 'RAN' and 'RAN' not in str(r['Biology/page.html']), str(r))
        check('…nor an .html page named .pdf', 'RAN' not in str(r['Biology/evil.pdf']), str(r))
        probe_errors = errors[errs_before:]
        del errors[errs_before:]
        print('  (what the probe made the page log:', '; '.join(e[:90] for e in probe_errors), ')')

        # Undo in a text file is saved too.
        open_row(page, 'Ideas.txt')
        page.locator('.doc-text .cm-content').click()
        page.keyboard.press('Meta+ArrowDown')
        page.keyboard.type(' plus more')
        time.sleep(1.0)
        page.keyboard.press('Meta+z')
        time.sleep(1.0)
        check('Cmd+Z in a text file, and the file follows', (BIO / 'Ideas.txt').read_text() == 'First idea\n', repr((BIO / 'Ideas.txt').read_text()))

        # A CSV edit, then straight to another tab before the save's wait is up: still saved.
        open_row(page, 'list.csv')
        page.locator('.doc-sheet tbody tr').nth(1).locator('td').nth(1).click()
        page.keyboard.press('Meta+a')
        page.keyboard.type('9')
        page.keyboard.press('Enter')
        page.keyboard.press('Escape')
        open_row(page, 'Cells', 0.1)
        time.sleep(1.0)
        check('a CSV edit is saved when you leave the tab at once', (BIO / 'list.csv').read_text() == 'a,b\n1,9\n', repr((BIO / 'list.csv').read_text()))

        # Cmd+click opens a document in another tab.
        before = page.locator('[aria-label="Close Handout.pdf"]').count()
        open_row(page, 'Handout.pdf', 1.5, modifiers=['Meta'])
        closers = page.eval_on_selector_all('[aria-label^="Close "]', 'els => els.map(e => e.getAttribute("aria-label"))')
        # One column: Cmd+click opens it in a new tab that takes the screen, and the note stays open
        # behind it (tabs/model.ts addTab) — as for a note.
        check('Cmd+click opens a document in a new tab, the note still open', before == 0 and 'Close Handout.pdf' in closers
              and 'Close Cells' in closers and page.locator('iframe.doc-pdf').count() == 1, f'closers={closers}')

        # Pin it, open it from Pinned.
        row(page, 'Handout.pdf').hover()
        row(page, 'Handout.pdf').locator('[data-tip="Pin to favourites"]').click()
        time.sleep(1.0)
        ws = json.loads((vault / '.mdnotes' / 'workspace.json').read_text()) if (vault / '.mdnotes' / 'workspace.json').exists() else {}
        check('a document can be pinned', (ws.get('entries', {}).get('Biology/Handout.pdf', {}) or {}).get('pinned') is True, str(ws.get('entries', {}).get('Biology/Handout.pdf')))

        # Search with documents in the folder: works, finds the note.
        page.locator('input[placeholder="Search titles"]').fill('Cells')
        time.sleep(1.0)
        check('title search still works with documents about', page.locator('.tree-title', has_text='Cells').count() >= 1)
        page.locator('input[placeholder="Search titles"]').fill('')
        time.sleep(0.6)

        # Move a document into a folder by dragging (run_drag_extras.py's recipe: grab, a small move, glide,
        # wiggle — a robot drag only updates on a move). A NOTE dragged the same way first is the control.
        # run_drag_extras.py case 1, step for step: hold over a closed folder until it opens, then let go
        # in the lower part of a note inside it.
        def drag_into(title, folder, inside):
            # The folder in the middle of the list, so neither end is near an edge (a drag there scrolls the list).
            page.locator(f'[data-row-path="Biology/{folder}"]').first.evaluate("e => e.scrollIntoView({ block: 'center' })"); time.sleep(0.3)
            r = page.locator(f'[data-row-path="Biology/{title}"]').first
            bx = r.bounding_box(); x0, y0 = bx['x'] + 60, bx['y'] + bx['height'] / 2
            page.mouse.move(x0, y0); page.mouse.down(); page.mouse.move(x0, y0 + 4); time.sleep(0.05)
            def glide(a, c, n=12):
                for i in range(1, n + 1):
                    page.mouse.move(a[0] + (c[0] - a[0]) * i / n, a[1] + (c[1] - a[1]) * i / n); time.sleep(0.02)
            def wiggle(at, secs):
                end = time.time() + secs; k = 0
                while time.time() < end:
                    k ^= 1; page.mouse.move(at[0] + k, at[1]); time.sleep(0.06)
            f = page.locator(f'[data-row-path="Biology/{folder}"]').first.bounding_box(); tgt = (f['x'] + 80, f['y'] + f['height'] / 2)
            glide((x0, y0), tgt)
            # Aim again where the folder IS now: the list can creep while a drag starts near its edge.
            for _ in range(3):
                f = page.locator(f'[data-row-path="Biology/{folder}"]').first.bounding_box()
                tgt = (f['x'] + 80, f['y'] + f['height'] / 2); page.mouse.move(*tgt); time.sleep(0.15)
            wiggle(tgt, 1.1)
            page.screenshot(path=str(OUT / f'hold-{title}.png'))
            print('  held at', tgt, 'folder box', f, 'hint rows lit:', page.locator('.tree-row.drop-into, [data-drop-into]').count())
            ib = page.locator(f'[data-row-path="Biology/{folder}/{inside}"]').first.bounding_box()
            at = (ib['x'] + 80, ib['y'] + ib['height'] * 0.75)
            glide(tgt, at, 6); wiggle(at, 0.3)
            page.screenshot(path=str(OUT / f'drag-{title}.png'))
            page.mouse.up(); time.sleep(1.8)
        inner = 'Inside.md'
        open_row(page, 'Cells')  # nothing framed on screen while the robot drags
        print('  frames on screen before the drag:', page.locator('iframe').count())
        drag_into('Control.md', 'Folder M', inner)
        check('control: a note dragged into a folder the same way moves there', (BIO / 'Folder M' / 'Control.md').exists())
        open_row(page, 'Essay.docx')
        print('  frames on screen before the drag:', page.locator('iframe').count())
        drag_into('Essay.docx', 'Folder M', inner)
        moved = (BIO / 'Folder M' / 'Essay.docx').exists()
        cells_md = (BIO / 'Cells.md').read_text()
        check('a document dragged into a folder moves there', moved, str(sorted(x.name for x in BIO.iterdir())[:8]))
        check("…and the note's link to it follows", 'Folder%20M/Essay.docx' in cells_md or '<Folder M/Essay.docx>' in cells_md, repr(cells_md))
        check('…and its open tab follows it', page.locator('.doc-word').count() == 1)

        # Archive a document from the right-click menu.
        row(page, 'Marks.xlsx').click(button='right')
        time.sleep(0.3)
        page.get_by_text('Move to archive', exact=True).click()
        time.sleep(2.0)
        arch = [str(x.relative_to(vault)) for x in vault.rglob('Marks.xlsx')]
        check('a document can be archived', arch and not (BIO / 'Marks.xlsx').exists(), str(arch))

        # Bin a document whose tab is open: the tab goes, the file is held in the bin.
        open_row(page, 'list.csv')
        row(page, 'list.csv').hover()
        row(page, 'list.csv').locator('[data-tip="Move to bin"]').click()
        time.sleep(1.5)
        held = [x.name for x in (vault / '.mdnotes' / 'trash').rglob('*') if x.is_file()] if (vault / '.mdnotes' / 'trash').exists() else []
        check('a document with its tab open can be binned', not (BIO / 'list.csv').exists() and any('list.csv' in h for h in held), str(held))
        check('…and its tab closes', page.locator('.doc-sheet').count() == 0)

        # Finder: a PDF added shows up; an open document deleted closes its tab.
        make_pdf(BIO / 'Added in Finder.pdf', 1)
        time.sleep(2.0)
        check('a PDF added in Finder appears in the sidebar', page.locator('.tree-title', has_text='Added in Finder.pdf').count() == 1)
        open_row(page, 'Ideas.txt')
        (BIO / 'Ideas.txt').unlink()
        time.sleep(2.0)
        check('an open document deleted in Finder closes its tab', page.locator('.doc-text').count() == 0)

        # A space switch and back keeps the document tab.
        open_row(page, 'Handout.pdf', 2)
        page.locator('aside button[data-tip]', has_text='2').first.click()
        time.sleep(1.5)
        page.locator('aside button[data-tip]', has_text='1').first.click()
        time.sleep(2.0)
        check('a space switch and back keeps the PDF tab', page.locator('iframe.doc-pdf').count() == 1)

        # Type, then close the window at once: the last words are saved (the close waits for the save).
        (BIO / 'last.txt').write_text('x\n')
        time.sleep(1.8)
        open_row(page, 'last.txt')
        page.locator('.doc-text .cm-content').click()
        page.keyboard.press('Meta+ArrowDown')
        page.keyboard.type('typed then closed')
        page.evaluate('window.close()')
        time.sleep(3.0)
        check('typing then closing the window at once still saves', 'typed then closed' in (BIO / 'last.txt').read_text(), repr((BIO / 'last.txt').read_text()))
        try:
            b.close()
        except Exception:
            pass
finally:
    stop(proc)

# The ONE relaunch: the tabs come back.
proc = launch()
try:
    with sync_playwright() as p:
        b, page = connect(p)
        time.sleep(1.5)
        check('after a restart the document tab comes back', page.locator('iframe.doc-pdf, .doc-text, .doc-sheet, .doc-word').count() >= 1,
              str(page.eval_on_selector_all('.pane-col', 'els => els.map(e => e.getAttribute("aria-label"))')))
        page.screenshot(path=str(OUT / '03-after-restart.png'))
        b.close()
finally:
    stop(proc)

after = {n: sha(next(vault.rglob(n))) for n in fixed}
check('the PDF, Word and Excel files were never written', after == fixed)
kept = [str(x) for x in (vault / '.mdnotes' / 'versions').rglob('*') if x.is_file() and not x.name.endswith('.json')] if (vault / '.mdnotes' / 'versions').exists() else []
check('no earlier versions made of any document', not any(s in k for k in kept for s in ('.pdf', '.docx', '.xlsx', '.csv', '.txt')), str(kept[:4]))
ELECTRON_PDF = ('sandboxed_renderer.bundle.js script failed', "property 'preloadScripts'")
pdf_noise = [e for e in errors if any(k in e for k in ELECTRON_PDF)]
check('no errors from the page (besides the PDF frame’s failed bridge, checked above)', not [e for e in errors if e not in pdf_noise], '; '.join(errors[:5]))
print('  (PDF frame bridge messages:', len(pdf_noise), ')')
print(f'\n{sum(ok for _, ok in results)}/{len(results)} passed')
