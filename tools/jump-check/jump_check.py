"""Go to a note (Cmd/Ctrl+P) — end-to-end check against a real Electron build.

Needs a scratch build whose main process has the trigger hook (see README.md):
a file at $JUMP_TRIGGER makes main click the real "Go to Note…" menu item, so
the path under test is menu item -> IPC -> App.tsx -> pop-up, minus only the OS
turning the key into the click (CDP keys skip menu accelerators).

Usage:  python3 jump_check.py <cdp-port> <trigger-file> <out-dir>

The vault it expects (README.md has the details):
  Study/Physics/Waves.md  Study/Physics/Optics.md  Study/Waves of change.md
  Study/Plan A.md ("Refraction bends light.")  Study/Café ideas.md
  Journal/My plan.md  Journal/Plan B.md ("A refraction diagram.")
  Loose note.md ("Notes on refraction at the edge.")
  -- either Study or Journal can be the space it starts in; the check works out
  which from what the pop-up shows.
"""
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

port, trigger, out = sys.argv[1], Path(sys.argv[2]), Path(sys.argv[3])
out.mkdir(parents=True, exist_ok=True)
results = []


def check(name, ok, detail=''):
    results.append((name, bool(ok), detail))
    print(('PASS ' if ok else 'FAIL ') + name + (f'  [{detail}]' if detail else ''))


DIALOG = '[role="dialog"][aria-label="Go to a note"]'
DEEP_ON = 'button[aria-label="Searching titles and note contents"]'
DEEP_OFF = 'button[aria-label="Searching titles only"]'
ALL_ON = 'button[aria-label="Searching every space"]'
ALL_OFF = 'button[aria-label="Searching this space only"]'


def press_key_menu(page):
    """The menu item, as a real click from main."""
    trigger.write_text('1')
    for _ in range(40):
        if not trigger.exists():
            break
        time.sleep(0.1)
    time.sleep(0.4)


def rows(page):
    return page.evaluate(
        """() => [...document.querySelectorAll('[role=option][data-jump-i]')].map(r => ({
            title: r.querySelector('.tree-title')?.textContent,
            sub: r.querySelector('.tree-sub')?.textContent,
            tag: r.querySelectorAll('.tree-sub')[1]?.textContent ?? '',
            on: r.getAttribute('aria-selected')
        }))"""
    )


def titles(page):
    return [x['title'] for x in rows(page)]


def open_note_text(page):
    return page.evaluate("() => document.querySelector('.cm-content')?.innerText ?? ''")


def focused_label(page):
    return page.evaluate("() => document.activeElement?.getAttribute('aria-label')")


with sync_playwright() as p:
    browser = p.chromium.connect_over_cdp(f'http://127.0.0.1:{port}')
    page = browser.contexts[0].pages[0]
    page.emulate_media(color_scheme='light', reduced_motion='no-preference')
    time.sleep(0.8)
    page.wait_for_selector('.tree-row', timeout=20000)

    check('control: no pop-up at the start', page.locator(DIALOG).count() == 0)
    # the sidebar bar's toggles at the start: titles only, this space only
    check('start: sidebar toggles are titles-only / this space', page.locator(DEEP_OFF).count() == 1 and page.locator(ALL_OFF).count() == 1)

    # 1. the menu item opens it, with the box focused
    press_key_menu(page)
    check('the menu item opens the pop-up', page.locator(DIALOG).count() == 1)
    check('the box has focus', focused_label(page) == 'Go to a note')
    check('it carries the same two toggles, in the same state', page.locator(DIALOG + ' ' + DEEP_OFF).count() == 1 and page.locator(DIALOG + ' ' + ALL_OFF).count() == 1)
    page.screenshot(path=str(out / '1-empty.png'))

    # 2. this space only: the other space's notes are not offered
    page.keyboard.type('plan')
    time.sleep(0.3)
    r = rows(page)
    check('this space only: "plan" finds just notes in this space, none tagged', len(r) in (1, 2) and all(x['tag'] == '' for x in r), str(r))

    # 3. the every-space toggle: widens, names the other space, keeps focus in the box
    page.click(DIALOG + ' ' + ALL_OFF)
    time.sleep(0.3)
    r = rows(page)
    t = [x['title'] for x in r]
    check('every space: "plan" finds all three', sorted(t) == ['My plan', 'Plan A', 'Plan B'], str(t))
    check('the two names that start with it come first', set(t[:2]) == {'Plan A', 'Plan B'} and t[2] == 'My plan', str(t))
    check('the first row is lit', [x['on'] for x in r] == ['true', 'false', 'false'])
    check('a note in this space is not tagged', r[0]['tag'] == '', str(r[0]))
    check('a note from the other space names it', r[1]['tag'] != '', str(r[1]))
    other = r[1]['title']
    check('pressing a toggle leaves focus in the box', focused_label(page) == 'Go to a note', str(focused_label(page)))
    check('it is the SIDEBAR toggle too (one answer for both)', page.locator(ALL_ON).count() == 2, str(page.locator(ALL_ON).count()))
    page.screenshot(path=str(out / '2-plan.png'))

    # 4. nothing covers the pop-up, and the page behind is covered
    hit = page.evaluate(
        """() => { const d = document.querySelector('[role=dialog][aria-label="Go to a note"]').getBoundingClientRect();
          const el = document.elementFromPoint(d.x + d.width / 2, d.y + 40);
          const back = document.elementFromPoint(8, 8);
          return [!!el.closest('[role=dialog]'), back.classList.contains('confirm-backdrop')] }"""
    )
    check('the pop-up is on top at its middle', hit[0])
    check('the backdrop is over the page', hit[1])

    # 5. contents toggle: a word that is only in the text
    page.fill(DIALOG + ' input', 'refraction')
    time.sleep(0.3)
    check('titles only: a word that is only in the notes finds nothing', titles(page) == [], str(titles(page)))
    page.click(DIALOG + ' ' + DEEP_OFF)
    time.sleep(1.2)  # the notes are read once, then the list fills in
    r = rows(page)
    check('contents on: finds it in all three notes', sorted(titles(page)) == ['Loose note', 'Plan A', 'Plan B'], str(titles(page)))
    check('each result shows the line it was found in', all('efraction' in (x['sub'] or '') for x in r), str([x['sub'] for x in r]))
    page.screenshot(path=str(out / '3-contents.png'))
    check('the sidebar sees the contents toggle too', page.locator(DEEP_ON).count() == 2, str(page.locator(DEEP_ON).count()))
    # a name still beats the text: with contents on, "plan" lists names first
    page.fill(DIALOG + ' input', 'plan')
    time.sleep(0.3)
    check('contents on: names still come before text matches', 'My plan' in titles(page), str(titles(page)))

    # 6. Enter on a text match goes to the words
    page.fill(DIALOG + ' input', 'refraction')
    time.sleep(0.3)
    page.keyboard.press('ArrowDown')
    want = titles(page)[1]
    page.keyboard.press('Enter')
    time.sleep(1.5)
    check('Enter closes the pop-up', page.locator(DIALOG).count() == 0)
    check(f'Enter opened {want}', want in open_note_text(page), open_note_text(page)[:40])
    sel = page.evaluate("() => window.getSelection()?.toString() ?? ''")
    check('and took you to the words (they are selected)', sel.lower() == 'refraction', repr(sel))

    # 7. the key again: opens with your toggles kept, a second press closes
    press_key_menu(page)
    check('opens again', page.locator(DIALOG).count() == 1)
    check('it starts empty each time', page.input_value(DIALOG + ' input') == '')
    check('and keeps your toggles', page.locator(DIALOG + ' ' + ALL_ON).count() == 1 and page.locator(DIALOG + ' ' + DEEP_ON).count() == 1)
    press_key_menu(page)
    check('a second press closes it', page.locator(DIALOG).count() == 0)

    # 8. Escape closes and leaves the note alone
    before = open_note_text(page)
    press_key_menu(page)
    page.keyboard.type('wav')
    page.keyboard.press('Escape')
    time.sleep(0.4)
    check('Escape closes it', page.locator(DIALOG).count() == 0)
    check('the note you were in is unchanged', open_note_text(page) == before)

    # 9. names, folders, accents, a loose note
    press_key_menu(page)
    page.click(DIALOG + ' ' + DEEP_ON)  # contents off again
    page.keyboard.type('cafe')
    time.sleep(0.3)
    check('"cafe" finds Café ideas', titles(page) == ['Café ideas'], str(rows(page)))
    page.fill(DIALOG + ' input', 'physics waves')
    time.sleep(0.3)
    check('a folder word and a name word together', titles(page) == ['Waves'], str(rows(page)))
    page.fill(DIALOG + ' input', 'loose')
    time.sleep(0.3)
    check('a loose note is never tagged (every space shows it)', [(x['title'], x['tag']) for x in rows(page)] == [('Loose note', '')], str(rows(page)))
    page.fill(DIALOG + ' input', 'zzzz')
    time.sleep(0.3)
    check('no match says so', 'No matches in note titles' in page.inner_text(DIALOG))

    # 10. Cmd+Enter opens beside, keeping the note that was open
    page.fill(DIALOG + ' input', 'optics')
    time.sleep(0.3)
    tabs_before = page.evaluate("() => document.querySelectorAll('[role=tab]').length")
    page.keyboard.press('Meta+Enter')
    time.sleep(1.2)
    tabs_after = page.evaluate("() => document.querySelectorAll('[role=tab]').length")
    check('Cmd+Enter adds a tab', tabs_after == tabs_before + 1, f'{tabs_before} -> {tabs_after}')
    check('and shows Optics', 'Optics' in open_note_text(page))

    # 11. a click on a row opens it too, a click on the backdrop closes
    press_key_menu(page)
    page.keyboard.type('plan a')
    time.sleep(0.3)
    page.click(DIALOG + ' [role=option]')
    time.sleep(1.2)
    check('clicking a row opens it', page.locator(DIALOG).count() == 0 and 'Plan A' in open_note_text(page))
    press_key_menu(page)
    page.mouse.click(8, 8)
    time.sleep(0.4)
    check('clicking outside closes it', page.locator(DIALOG).count() == 0)

    # 12. while something else is up over the notes, the key does nothing
    page.evaluate(
        """() => { const d = document.createElement('div'); d.id = 'fake-modal'; d.setAttribute('aria-modal', 'true');
                   d.style.cssText = 'position:fixed;inset:0;z-index:50'; document.body.appendChild(d) }"""
    )
    press_key_menu(page)
    check('with another window up, the key is ignored', page.locator(DIALOG).count() == 0)
    page.evaluate("() => document.getElementById('fake-modal').remove()")

    # 13. the same pop-up on the dark theme (looks only)
    page.emulate_media(color_scheme='dark')
    time.sleep(0.8)
    press_key_menu(page)
    page.keyboard.type('plan')
    time.sleep(0.4)
    page.screenshot(path=str(out / '4-dark.png'))
    page.keyboard.press('Escape')

    browser.close()

bad = [r for r in results if not r[1]]
print(f'\n{len(results) - len(bad)}/{len(results)} passed')
sys.exit(1 if bad else 0)
