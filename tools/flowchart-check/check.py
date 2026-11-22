#!/usr/bin/env python3
"""Flow charts in a real window (Mac). One hidden launch, one relaunch, made-up notes.

    WORK=<scratch> ../app-check/build.sh
    WORK=<scratch> python3 check.py <free port>
"""
import json, os, shutil, sys, time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'app-check'))
os.environ.setdefault('LAB_SIZE', '1280x1100')
import lab  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 9491
RUN = lab.WORK / 'flow-run'
VAULT, UD = RUN / 'vault', RUN / 'ud'
NOTE = VAULT / 'Study' / 'Flows.md'
VIEW = "document.querySelector('.cm-content').cmTile.view"

FIRST = """---
title: Revision flow
---
flowchart TD
  A[Start] --> B{Revised?}
  B -->|Yes| C[Do a test]
  B -->|No| D[Read cells notes]
  D --> B
  C --> E((Done))"""
SECOND = "flowchart LR\n  P[Plain one] --> Q[Second]"
PIE = 'pie title Time\n  "Maths": 40\n  "Biology": 60'
BROKEN = "flowchart TD\n  A --> B\n  B -->"
NASTY = 'flowchart TD\n  A["<img src=x onerror=window.__pwned=1>"] --> B\n  click A href "https://example.com/leak"'
fence = lambda s: f"```mermaid\n{s}\n```"
TEXT = f"""Intro words about cells.

{fence(FIRST)}

Middle words.

{fence(SECOND)}

{fence(PIE)}

{fence(BROKEN)}

{fence(NASTY)}

Last cells line.
"""
results = []
def check(name, ok, detail=''):
    results.append(bool(ok)); print(('PASS ' if ok else 'FAIL ') + name + (f' — {str(detail)[:260]}' if detail != '' and not ok else ''), flush=True)
def until(fn, secs=4.0):
    end = time.time() + secs
    while time.time() < end:
        try:
            v = fn()
            if v: return v
        except Exception:
            pass
        time.sleep(0.06)
    return fn()

if RUN.exists(): shutil.rmtree(RUN)
NOTE.parent.mkdir(parents=True); NOTE.write_text(TEXT)
(VAULT / 'Study' / 'Other.md').write_text('Another note.\n')
(VAULT / '.mdnotes').mkdir()
(VAULT / '.mdnotes' / 'settings.json').write_text(json.dumps({'spaces': [{'folder': 'Study'}], 'activeSpaceFolder': 'Study', 'playStartupAnimation': False, 'startup': 'last'}))
lab.profile(UD, VAULT)
errors, outside = [], []

def watch(page):
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('request', lambda r: outside.append(r.url) if r.url.startswith(('http', 'ftp')) and '127.0.0.1' not in r.url else None)
    page.emulate_media(color_scheme='light', reduced_motion='reduce')
    page.add_init_script('')

def open_note(page, title):
    page.locator('.tree-row', has=page.locator('.tree-title', has_text=title)).first.click()
    time.sleep(0.5)

proc, _ = lab.launch(UD, PORT, RUN / 'app.log')
try:
    with sync_playwright() as p:
        browser, page = lab.connect(p, PORT); watch(page)
        page.evaluate("() => { window.__csp = []; document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(e.effectiveDirective + ' ' + e.blockedURI)) }")
        page.wait_for_selector('.tree-title')
        open_note(page, 'Flows')
        page.wait_for_selector('.cm-chart-card')
        until(lambda: page.locator('.cm-chart-picture svg').count() >= 3)
        time.sleep(0.5)
        cards = page.evaluate("""() => [...document.querySelectorAll('.cm-chart-card')].map((c) => ({ name: c.querySelector('.cm-chart-name').textContent, count: c.querySelector('.cm-chart-count').textContent, svg: !!c.querySelector('svg'), broken: c.classList.contains('cm-chart-broken'), text: c.querySelector('.cm-chart-picture').innerText, h: Math.round(c.getBoundingClientRect().height) }))""")
        check('all five charts are cards', len(cards) == 5, cards)
        check('a title names its card', cards[0]['name'] == 'Revision flow', cards[0])
        check('an untitled chart is named after its note', cards[1]['name'] == 'Flows chart', cards[1])
        check('box count', cards[0]['count'] == '5 boxes', cards[0])
        check('a pie chart draws', cards[2]['svg'] and cards[2]['name'] == 'Time', cards[2])
        check('a broken chart says so', cards[3]['broken'] and 'draw' in cards[3]['text'], cards[3])
        check('all cards are the same height', len({c['h'] for c in cards}) == 1, cards)
        check('opening a note did not change its file', NOTE.read_text() == TEXT)
        check('word count leaves charts out', '9 words' in page.locator('.note-info').first.inner_text(), page.locator('.note-info').first.inner_text())
        check('sidebar line leaves charts out', 'flowchart' not in page.locator('.tree-row', has=page.locator('.tree-title', has_text='Flows')).first.inner_text())
        nasty = page.evaluate("() => ({ run: window.__pwned === 1, imgs: document.querySelectorAll('.cm-chart img, .cm-chart a, .cm-chart image, .cm-chart script, .cm-chart foreignObject').length })")
        check('a hostile chart runs nothing and links nowhere', not nasty['run'] and nasty['imgs'] == 0, nasty)
        tops = page.evaluate(f"""() => {{ const v = {VIEW}; return [...document.querySelectorAll('.cm-content > .cm-block-frame')].filter((f) => f.querySelector('.cm-chart')).map((f) => {{ const pos = v.posAtDOM(f); const want = v.lineBlockAt(pos).top + v.documentTop; return Math.abs(f.getBoundingClientRect().top - want) }}) }}""")
        check('each card is drawn where the editor thinks it is', tops and max(tops) < 1.5, tops)

        # the cursor can't get in, and Backspace picks first
        page.evaluate(f"() => {{ const v = {VIEW}; const l = v.state.doc.line(1); v.dispatch({{ selection: {{ anchor: l.to }} }}); v.focus() }}")
        page.keyboard.press('ArrowDown'); page.keyboard.press('ArrowDown'); time.sleep(0.1)
        head = page.evaluate(f"() => {{ const v = {VIEW}; return v.state.doc.lineAt(v.state.selection.main.head).text }}")
        check('arrows step over a card', head in ('', 'Middle words.'), repr(head))
        card = page.locator('.cm-chart-card').first
        box = card.bounding_box(); page.mouse.click(box['x'] + 80, box['y'] + 60); time.sleep(0.15)
        picked = page.evaluate(f"() => {{ const v = {VIEW}; const s = v.state.selection.main; return v.state.sliceDoc(s.from, s.to) }}")
        check('a click on the card picks it whole', picked == fence(FIRST), repr(picked)[:80])
        check('a picked card wears the outline', 'cm-attach-selected' in (card.get_attribute('class') or ''))
        page.keyboard.press('Meta+c'); page.keyboard.press('ArrowRight')

        # Open
        page.locator('.cm-chart-open').first.click(); page.wait_for_selector('.chart-view'); until(lambda: page.locator('.chart-stage svg').count() == 1)
        time.sleep(0.4)
        check('Open gives it its own tab, named', page.get_by_text('Revision flow').count() >= 2)
        check('the note stays open as a tab', page.evaluate("() => [...document.querySelectorAll('[data-tip]')].some((e) => e.textContent.trim() === 'Flows')") or page.get_by_text('Flows', exact=True).count() > 0)
        lit = lambda: page.evaluate("() => document.querySelector('.chart-stage .pele-node.is-here')?.getAttribute('data-id')")
        ways = lambda: page.locator('.chart-way').all_inner_texts()
        check('the walk starts at the first box', lit() == 'A', lit())
        check('an unlabelled arrow names the next box', ways() == ['Revised?'], ways())
        page.locator('.chart-way', has_text='Revised?').click(); time.sleep(0.1)
        check('a decision offers its answers', ways() == ['Yes', 'No'], ways())
        page.locator('.chart-way', has_text='No').click(); time.sleep(0.1)
        check('the answer moves the lit box', lit() == 'D', lit())
        walked = page.evaluate("() => [...document.querySelectorAll('.chart-stage .pele-node.is-walked')].map((e) => e.getAttribute('data-id'))")
        check('your path stays marked', set(walked) == {'A', 'B', 'D'}, walked)
        page.get_by_role('button', name='Back', exact=True).click(); time.sleep(0.1)
        check('Back', lit() == 'B', lit())
        page.get_by_role('button', name='Restart', exact=True).click(); time.sleep(0.1)
        check('Restart', lit() == 'A', lit())
        page.locator('.chart-canvas').focus(); page.keyboard.press('Enter'); page.keyboard.press('1'); page.keyboard.press('1'); page.keyboard.press('1'); time.sleep(0.1)
        check('keys walk it too, to the end', lit() == 'E' and page.get_by_text('End of this path').count() == 1, lit())
        check('walking never touched the note', NOTE.read_text() == TEXT)
        page.get_by_role('button', name='Restart', exact=True).click()
        pct = lambda: page.locator('.chart-percent').inner_text()
        before = pct(); page.get_by_role('button', name='Zoom in').click(); time.sleep(0.05)
        check('zoom', pct() != before, pct())
        page.get_by_role('button', name='Fit', exact=True).click()
        c = page.locator('.chart-canvas').bounding_box(); s0 = page.locator('.chart-stage').bounding_box()
        page.mouse.move(c['x'] + 50, c['y'] + 50); page.mouse.down(); page.mouse.move(c['x'] + 90, c['y'] + 80); page.mouse.up(); s1 = page.locator('.chart-stage').bounding_box()
        check('drag moves the chart', abs(s1['x'] - s0['x'] - 40) < 2, (s0, s1))
        wheel = page.evaluate("() => { const e = new WheelEvent('wheel', { deltaX: 30, bubbles: true, cancelable: true }); document.querySelector('.chart-canvas').dispatchEvent(e); return e.defaultPrevented }")
        check('a sideways scroll stays in the chart', wheel)
        page.get_by_role('button', name='Fit', exact=True).click()

        # editing text, with the note closed behind it
        page.get_by_role('button', name='Text', exact=True).click(); page.wait_for_selector('.chart-text')
        area = page.locator('.chart-text')
        check('the panel holds the chart text', area.input_value() == FIRST, area.input_value()[:60])
        area.click(); page.keyboard.press('Meta+ArrowDown'); page.keyboard.type('\n  E --> F[Extra box]')
        check('typing saves into the note', until(lambda: 'E --> F[Extra box]' in NOTE.read_text()), NOTE.read_text()[:200])
        check('nothing else in the note changed', NOTE.read_text() == TEXT.replace('C --> E((Done))', 'C --> E((Done))\n  E --> F[Extra box]'), NOTE.read_text()[:120])
        check('the picture follows', until(lambda: page.locator('.chart-stage .pele-node[data-id="F"]').count() == 1))
        page.keyboard.press('Meta+z'); time.sleep(0.1)
        for _ in range(30):
            if area.input_value() == FIRST: break
            page.keyboard.press('Meta+z'); time.sleep(0.03)
        check('undo in the panel', 'Extra' not in area.input_value(), area.input_value()[-40:])
        check('undo reaches the note', until(lambda: NOTE.read_text() == TEXT), NOTE.read_text()[:100])
        area.click(); page.keyboard.press('Meta+ArrowDown'); page.keyboard.type('\n  Z -->')
        check('a mistake says which line', until(lambda: page.get_by_text('has a mistake').count() == 1))
        check('the last good picture stays, dimmed', page.locator('.chart-dim .chart-stage svg').count() == 1)
        for _ in range(8): page.keyboard.press('Backspace')
        until(lambda: NOTE.read_text() == TEXT); check('fixing it clears the message', until(lambda: page.get_by_text('has a mistake').count() == 0))

        # Split, beside its note: one edit shows on both sides, and the note's undo survives
        page.locator('.chart-way').first.click(); time.sleep(0.1)
        page.get_by_role('button', name='Split view beside its note').click(); until(lambda: page.locator('.pane-col').count() == 2 and page.locator('.cm-content').count() == 1)
        time.sleep(0.5)
        check('Split puts it beside its note', page.locator('.pane-col').count() == 2 and page.locator('.chart-view').count() == 1)
        order = page.evaluate("() => [...document.querySelectorAll('.pane-col')].map((c) => !!c.querySelector('.chart-view'))")
        check('note left, chart right', order == [False, True], order)
        check('the walk and the text panel survive the move', lit() == 'B' and page.locator('.chart-text').count() == 1, lit())
        page.evaluate(f"() => {{ const v = {VIEW}; v.dispatch({{ selection: {{ anchor: 0 }} }}); v.focus() }}")
        page.keyboard.type('Typed '); time.sleep(0.2)
        area = page.locator('.chart-text'); area.click(); page.keyboard.press('Meta+ArrowDown'); page.keyboard.type('\n  E --> G[Live]')
        check('the card in the note updates live', until(lambda: page.locator('.cm-chart-card').first.locator('.pele-node[data-id="G"]').count() == 1))
        check('both changes reach the file', until(lambda: 'Typed Intro' in NOTE.read_text() and 'G[Live]' in NOTE.read_text()), NOTE.read_text()[:60])
        page.evaluate(f"() => {VIEW}.focus()"); page.keyboard.press('Meta+z'); time.sleep(0.3)
        check("the note's own undo still works", 'G[Live]' not in page.evaluate(f"() => {VIEW}.state.doc.toString()"))
        check('and the panel follows it', until(lambda: 'G[Live]' not in page.locator('.chart-text').input_value()))

        # edit the chart in the note's text from the editor: delete the block
        page.locator('.cm-chart-card').first.click(position={'x': 60, 'y': 50}); time.sleep(0.1); page.keyboard.press('Backspace'); time.sleep(0.3)
        check('deleting the block keeps the tab, with Put back', until(lambda: page.get_by_text('No longer in this note.').count() == 1))
        check('its text is read-only while it is gone', page.locator('.chart-text').get_attribute('readonly') is not None)
        check('the file really lost it', until(lambda: 'Revision flow' not in NOTE.read_text()))
        page.get_by_role('button', name='Put back', exact=True).click()
        check('Put back restores it', until(lambda: 'Revision flow' in NOTE.read_text() and page.get_by_text('No longer in this note.').count() == 0), NOTE.read_text()[:120])
        now = NOTE.read_text(); check('…in its old place', now.index('Revision flow') < now.index('Middle words'), now[:90])

        # outside change
        time.sleep(1.4)  # the app ignores a file event just after its own save of that file
        cur = NOTE.read_text(); NOTE.write_text(cur.replace('Do a test', 'Sit a test'))
        check('a change from outside reaches the tab', until(lambda: 'Sit a test' in page.locator('.chart-text').input_value(), 5))
        time.sleep(0.5)

        # rename the note from its title: the tab follows, and keeps saving to the right file
        title = page.locator('.note-title-row input'); title.fill('Renamed'); title.press('Enter')
        new = VAULT / 'Study' / 'Renamed.md'
        check('the note renamed', until(lambda: new.exists() and not NOTE.exists(), 5))
        check('the chart tab followed it', until(lambda: page.locator('.chart-view').count() == 1))
        area = page.locator('.chart-text'); area.click(); page.keyboard.press('Meta+ArrowDown'); page.keyboard.type('\n  E --> R[After rename]')
        ok = until(lambda: 'R[After rename]' in new.read_text(), 5)
        check('it saves to the new name', ok, {'panel': area.input_value()[-40:], 'editor': 'After rename' in page.evaluate(f"() => {VIEW}.state.doc.toString()"), 'line': page.locator('.chart-line').all_inner_texts()})
        for _ in range(len('\n  E --> R[After rename]')): page.keyboard.press('Backspace')
        check('(put that back)', until(lambda: 'After rename' not in new.read_text(), 5))

        page.get_by_role('button', name='Single view').click(); time.sleep(0.4)
        check('Single view shows the chart alone', page.locator('.pane-col').count() == 1 and page.locator('.chart-view').count() == 1)

        # Find and Replace, back in the note
        page.locator('span.truncate.font-medium', has_text='Renamed').first.click(); page.wait_for_selector('.cm-chart-card'); time.sleep(0.5)
        page.evaluate(f"() => {{ const v = {VIEW}; v.dispatch({{ selection: {{ anchor: 0 }} }}); v.focus() }}")
        page.keyboard.press('Meta+f'); time.sleep(0.2)
        box = page.locator('.cm-search input[name=search]'); box.fill('cells')
        for _ in range(3): box.press('Enter'); time.sleep(0.12)
        sel = page.evaluate(f"() => {{ const v = {VIEW}; const s = v.state.selection.main; return v.state.sliceDoc(s.from, s.to) }}")
        check('Find lands on the card, picked whole', sel.startswith('```mermaid') and 'cells' in sel and sel.endswith('```'), repr(sel)[:90])
        before_replace = page.evaluate(f"() => {VIEW}.state.doc.toString()")
        page.locator('.cm-search input[name=replace]').fill('tissue')
        page.locator('.cm-search button[name=replaceAll]').click(); time.sleep(0.2)
        after = page.evaluate(f"() => {VIEW}.state.doc.toString()")
        check('Replace All changes the words', 'Intro words about tissue' in after and 'Last tissue line' in after, after[:60])
        check('Replace All leaves the chart alone', 'Read cells notes' in after and 'Read tissue notes' not in after)
        page.locator('.cm-search button[name=close]').click(); time.sleep(0.1)
        page.evaluate(f"() => {VIEW}.focus()"); page.keyboard.press('Meta+z'); time.sleep(0.2)
        check('(undo that)', page.evaluate(f"() => {VIEW}.state.doc.toString()") == before_replace)

        # Save as
        until(lambda: new.read_text() == before_replace, 3)
        row = page.locator('.tree-row', has=page.locator('.tree-title', has_text='Renamed')).first
        row.click(button='right'); time.sleep(0.3); page.get_by_text('Save as…', exact=True).first.click()
        page.wait_for_selector('.saveas-sheet iframe'); time.sleep(1.4)
        frame = page.locator('.saveas-sheet iframe').element_handle().content_frame()
        sheet = frame.evaluate("""() => ({ charts: [...document.querySelectorAll('img[alt="Chart"]')].map((i) => ({ ok: i.complete && i.naturalWidth > 0, svg: i.src.startsWith('data:image/svg+xml') })), code: [...document.querySelectorAll('pre')].map((p) => p.innerText.slice(0, 30)), bad: document.querySelectorAll('[onerror], a[href^="javascript"]').length, plain: document.body.innerText })""")
        check('Save as draws the four good charts', len(sheet['charts']) == 4 and all(c['ok'] and c['svg'] for c in sheet['charts']), sheet['charts'])
        check('a chart it can’t draw stays as its text', len(sheet['code']) == 1 and 'flowchart' in sheet['code'][0], sheet['code'])
        check('Save as carries nothing unsafe', sheet['bad'] == 0)
        page.locator('.saveas-sheet').screenshot(path=str(RUN / 'save-as.png'))
        page.keyboard.press('Escape'); time.sleep(0.6)

        # the / menu, on an empty note
        page.locator('.tree-row', has=page.locator('.tree-title', has_text='Other')).first.click(); time.sleep(0.5)
        page.evaluate(f"() => {{ const v = {VIEW}; v.dispatch({{ changes: {{ from: 0, to: v.state.doc.length, insert: '' }} }}); v.focus() }}")
        page.keyboard.type('/flow'); time.sleep(0.3); page.keyboard.press('Enter')
        check('/flow makes a chart', until(lambda: page.locator('.cm-chart-picture svg').count() == 1))
        page.keyboard.type('Words after it'); time.sleep(0.2)
        doc = page.evaluate(f"() => {VIEW}.state.doc.toString()")
        check('the cursor lands under it, ready to type', doc.rstrip().endswith('Words after it') and '```\n' in doc and doc.index('```', 12) < doc.index('Words'), repr(doc[-40:]))

        # the six dots: a card moves whole
        page.locator('.tree-row', has=page.locator('.tree-title', has_text='Renamed')).first.click(); page.wait_for_selector('.cm-chart-card'); time.sleep(0.6)
        page.evaluate(f"() => {VIEW}.scrollDOM.scrollTo(0, 0)"); time.sleep(0.2)
        moved_before = new.read_text()
        b = page.locator('.cm-chart-card').first.bounding_box()
        page.mouse.move(b['x'] + 30, b['y'] + 40); time.sleep(0.25)
        grip = page.evaluate("""() => { const g = [...document.querySelectorAll('.cm-line-grip')].find((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && getComputedStyle(e).display !== 'none' }); if (!g) return null; const r = g.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } }""")
        check('a card has its six dots', grip is not None, grip)
        if grip:
            target = page.locator('.cm-line', has_text='Middle words').first.bounding_box()
            page.mouse.move(grip['x'], grip['y']); page.mouse.down()
            for k in range(1, 9):
                page.mouse.move(grip['x'], grip['y'] + (target['y'] + target['height'] + 2 - grip['y']) * k / 8); time.sleep(0.03)
            time.sleep(0.15); page.mouse.up()
            done = until(lambda: new.read_text() != moved_before, 3)
            now = new.read_text()
            check('dragging moves the whole chart below the words', done and now.index('Middle words') < now.index('title: Revision flow'), now[:90])
            check('and it is still one intact chart', now.count('title: Revision flow') == 1 and now.count('```mermaid') == moved_before.count('```mermaid') and len(now) == len(moved_before), (len(now), len(moved_before)))
            page.keyboard.press('Meta+z'); until(lambda: new.read_text() == moved_before, 2)

        # leave a chart open for the relaunch
        page.locator('.tree-row', has=page.locator('.tree-title', has_text='Other')).first.click(); page.wait_for_selector('.cm-chart-card'); time.sleep(0.4)
        page.locator('.cm-chart-open').first.click(); page.wait_for_selector('.chart-view'); time.sleep(0.5)
        page.locator('.chart-way').first.click(); time.sleep(0.2)
        page.screenshot(path=str(RUN / 'tab.png'))
        time.sleep(1.8)
        errs = list(errors)
        check('no error in the window', not errs, errs[:2])
        check('nothing reached the network', not outside, outside[:2])
        check('nothing was blocked by the security rules', not page.evaluate('() => window.__csp'), page.evaluate('() => window.__csp'))
finally:
    lab.stop(proc)

# Quit and reopen: the tab comes back, and the walk starts again.
time.sleep(0.8)
proc, _ = lab.launch(UD, PORT, RUN / 'app2.log')
try:
    with sync_playwright() as p:
        browser, page = lab.connect(p, PORT); watch(page)
        check('the chart tab returns after a relaunch', until(lambda: page.locator('.chart-view').count() == 1, 12))
        check('its chart draws', until(lambda: page.locator('.chart-stage svg').count() == 1, 6))
        check('the walk restarts at the first box', until(lambda: page.evaluate("() => document.querySelector('.chart-stage .pele-node.is-here')?.getAttribute('data-id')") == 'A'))
finally:
    lab.stop(proc)
print(f'{sum(results)} of {len(results)} passed'); print('pictures:', RUN)
sys.exit(0 if all(results) else 1)
