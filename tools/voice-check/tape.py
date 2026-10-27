"""The tape (tabs/VoiceDeck.tsx): the cassette button in a note's corner, its player card, the
sidebar player while the note is off screen, and the sidebar row's star/bin order.

    WORK=/some/scratch/dir python3 tape.py [shots-dir]

Real clicks and pointer moves over CDP, on the scratch build `build.sh` made. Screenshots go to
shots-dir (default $WORK/shots). Prints one line per check; a FAIL line says what it saw.
First run, 2026-10-16 (Mac): 28 ok, 0 failed."""
import json, sys, time
from pathlib import Path
from common import WORK, app, connect, open_zoom_note, reset_vault
from playwright.sync_api import sync_playwright

TAPE = "Play this note's voice notes"  # the corner button's label
SHOTS = Path(sys.argv[1]) if len(sys.argv) > 1 else WORK / 'shots'
SHOTS.mkdir(parents=True, exist_ok=True)
fails = 0


def check(name: str, ok: bool, saw=None) -> None:
    global fails
    if not ok:
        fails += 1
    print(('ok    ' if ok else 'FAIL  ') + name + ('' if ok else f'  — saw {saw!r}'))


def shot(page, name: str, sel=None, pad: int = 16, box=None) -> None:
    if sel:
        b = page.locator(sel).first.bounding_box()
        box = {'x': max(0, b['x'] - pad), 'y': max(0, b['y'] - pad), 'width': b['width'] + 2 * pad, 'height': b['height'] + 2 * pad}
    page.screenshot(path=str(SHOTS / f'{name}.png'), clip=box)


def playing(page) -> dict:
    """Which play buttons say playing: the block's, the card's in the note, the sidebar's."""
    return page.evaluate("""() => ({
      block: !!document.querySelector('.cm-voice-play.is-playing'),
      card: [...document.querySelectorAll('.deck .deck-play')].map(b => b.classList.contains('is-playing'))
    })""")


def tape_btn(page):
    return page.locator(f'button[aria-label="{TAPE}"], button[aria-label="Close the voice note player"]')


def sidebar_card(page):
    return page.locator('aside .deck')


def open_note(page, title: str) -> None:
    page.locator('.tree-title', has_text=title).first.click()
    time.sleep(0.8)


vault = reset_vault()
# A second note in the same space to switch to, with no voice note of its own.
(vault / 'Voice' / 'Second.md').write_text('# Second\n\nNo voice note in here.\n')

with sync_playwright() as p, app(9342):
    b, page = connect(p, 9342)

    # --- the sidebar row: star inside, bin on the outside --------------------
    open_zoom_note(page)
    row = page.locator('.tree-row', has_text='Zoom').first
    row.hover()
    time.sleep(0.4)
    order = page.evaluate("""() => { const r = [...document.querySelectorAll('.tree-row')].find(e => e.textContent.includes('Zoom'));
      return [...r.querySelectorAll('.row-acts button')].map(x => x.getAttribute('data-tip')) }""")
    check('row buttons: star first, bin last (outside)', order == ['Pin to favourites', 'Move to bin'], order)
    shot(page, '01-row-hover', '.tree-row:has-text("Zoom")', pad=8)

    # --- the corner button ---------------------------------------------------
    check('tape button on a note with a voice note', tape_btn(page).count() == 1, tape_btn(page).count())
    geo = page.evaluate("""(tape) => {
      const t = document.querySelector(`button[aria-label="${tape}"]`).getBoundingClientRect()
      const e = document.querySelector('button[aria-label^="Show the code behind"]').getBoundingClientRect()
      const hit = (r) => document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest('button')?.getAttribute('aria-label')
      return {tapeAboveEye: Math.round(e.top - t.bottom), sameRight: Math.round(t.right - e.right), hitTape: hit(t), hitEye: hit(e)} }""", TAPE)
    check('tape sits 8px above the eye, same right edge', geo['tapeAboveEye'] == 8 and geo['sameRight'] == 0, geo)
    check('nothing covers the tape or the eye', geo['hitTape'] == TAPE and geo['hitEye'].startswith('Show the code'), geo)
    br = page.locator(f'button[aria-label="{TAPE}"]').bounding_box()
    shot(page, '02-corner', box={'x': br['x'] - 60, 'y': br['y'] - 30, 'width': br['width'] + 90, 'height': 110})

    open_note(page, 'Second')
    check('no tape button on a note without one', tape_btn(page).count() == 0, tape_btn(page).count())
    open_zoom_note(page)

    # --- the card in the note -------------------------------------------------
    # Scroll the voice note well out of sight first: the card is for listening from anywhere.
    page.mouse.move(900, 600)
    for _ in range(12):
        page.mouse.wheel(0, 400)
        time.sleep(0.05)
    time.sleep(0.6)
    tape_btn(page).first.click()
    time.sleep(0.5)
    card = page.locator('.edit-layer .deck')
    check('clicking the tape opens the card', card.count() == 1, card.count())
    name = page.evaluate("() => document.querySelector('.edit-layer .deck span.truncate')?.textContent")
    check('card names the recording', name == 'memo', name)
    shot(page, '03-card-in-note', '.edit-layer .deck', pad=60)
    page.locator('.edit-layer .deck .deck-play').click()
    time.sleep(1.2)
    st = playing(page)
    check('play in the card plays it', st['card'] == [True], st)
    shot(page, '04-card-playing', '.edit-layer .deck', pad=60)

    page.locator('.edit-layer .deck button[aria-label="Go to this voice note"]').click()
    time.sleep(1.0)
    vis = page.evaluate("""() => { const v = document.querySelector('.cm-voice'); const s = document.querySelector('.cm-scroller').getBoundingClientRect();
      if (!v) return null; const r = v.getBoundingClientRect(); return {inView: r.top >= s.top && r.bottom <= s.bottom, card: !!document.querySelector('.edit-layer .deck')} }""")
    check('↗ scrolls to the voice note and closes the card', vis and vis['inView'] and not vis['card'], vis)
    st = playing(page)
    check('…and it is still playing, in its own block', st['block'], st)
    check('no sidebar player while the note is on screen', sidebar_card(page).count() == 0, sidebar_card(page).count())

    # --- moving away: the sidebar takes over --------------------------------
    open_note(page, 'Second')  # replaces the tab, as a sidebar click does
    time.sleep(0.8)
    check('sidebar player appears once the note is off screen', sidebar_card(page).count() == 1, sidebar_card(page).count())
    st = playing(page)
    check('…and the recording kept playing', st['card'] == [True], st)
    page.mouse.move(1500, 300)
    time.sleep(0.5)
    shot(page, '05-sidebar-rest', 'aside .deck', pad=24)
    h0 = sidebar_card(page).bounding_box()['height']
    y0 = page.locator('aside .deck .deck-play').bounding_box()['y']
    cb = sidebar_card(page).bounding_box()
    page.mouse.move(cb['x'] + 12, cb['y'] + cb['height'] - 6)  # onto the card's bottom edge, off every button
    time.sleep(0.5)
    h1 = sidebar_card(page).bounding_box()['height']
    y1 = page.locator('aside .deck .deck-play').bounding_box()['y']
    check('hover opens the name row (card grows upwards)', h1 > h0 + 20, (h0, h1))
    check('…and the buttons under the pointer do not move', abs(y1 - y0) < 0.5, (y0, y1))
    shot(page, '06-sidebar-hover', 'aside .deck', pad=24)
    title = page.evaluate("() => document.querySelector('aside .deck span.truncate')?.textContent")
    check('sidebar card names the note', title == 'Zoom', title)

    page.locator('aside .deck .deck-play').click()
    time.sleep(0.5)
    check('pause from the sidebar', playing(page)['card'] == [False], playing(page))
    page.locator('aside .deck .deck-play').click()
    time.sleep(0.8)
    check('play again from the sidebar', playing(page)['card'] == [True], playing(page))

    sidebar_card(page).hover()
    time.sleep(0.4)
    page.locator('aside .deck button[aria-label^="Go back to"]').click()
    time.sleep(1.5)
    tabs_now = page.evaluate("() => [...document.querySelectorAll('.cm-voice')].length")
    st = playing(page)
    check('sidebar ↗ goes back to the note, playing in its block', tabs_now == 1 and st['block'], (tabs_now, st))
    check('sidebar player gone once back', sidebar_card(page).count() == 0, sidebar_card(page).count())

    # --- another space ------------------------------------------------------
    page.locator('button[data-tip="Other"]').first.click()
    time.sleep(1.5)
    check('switching space: sidebar player shows, still playing',
          sidebar_card(page).count() == 1 and playing(page)['card'] == [True], (sidebar_card(page).count(), playing(page)))
    sidebar_card(page).hover()
    time.sleep(0.4)
    page.locator('aside .deck button[aria-label^="Go back to"]').click()
    time.sleep(2.0)
    space = page.evaluate("() => [...document.querySelectorAll('.tree-title')].map(e => e.textContent.trim()).join(',')")
    check('↗ from another space comes back to it', 'Zoom' in space and playing(page)['block'], (space, playing(page)))

    # --- ×: stop and close ----------------------------------------------------
    open_note(page, 'Second')
    sidebar_card(page).hover()
    time.sleep(0.4)
    page.locator('aside .deck button[aria-label="Stop and close"]').click()
    time.sleep(0.8)
    check('× closes the sidebar player', sidebar_card(page).count() == 0, sidebar_card(page).count())
    open_zoom_note(page)
    time.sleep(0.5)
    check('…and stopped the recording', not playing(page)['block'], playing(page))

    # --- deleting the voice note's line while it plays stops it ---------------
    page.locator('.cm-voice-play').click()
    time.sleep(0.8)
    page.locator('.cm-voice .cm-attach-grip').first.click(force=True)  # selects the voice note
    time.sleep(0.3)
    page.keyboard.press('Backspace')
    time.sleep(1.2)
    gone = page.evaluate("() => document.querySelectorAll('.cm-voice').length")
    check('voice note deleted (the "lose its recording" box is up)', gone == 0, gone)
    # Cancel: the box puts the voice note back. Its recording must have stopped meanwhile.
    page.keyboard.press('Escape')
    time.sleep(1.2)
    back = page.evaluate("() => document.querySelectorAll('.cm-voice').length")
    check('Cancel puts the voice note back, not playing', back == 1 and not playing(page)['block'], (back, playing(page)))
    open_note(page, 'Second')
    time.sleep(0.6)
    check('…and nothing left on the tape: no sidebar player', sidebar_card(page).count() == 0, sidebar_card(page).count())

    # --- dark ---------------------------------------------------------------
    open_zoom_note(page)
    page.emulate_media(color_scheme='dark')
    time.sleep(0.8)
    tape_btn(page).first.click()
    time.sleep(0.5)
    shot(page, '07-card-dark', '.edit-layer .deck', pad=60)
    page.keyboard.press('Escape')
    time.sleep(0.3)
    check('Escape closes the card', page.locator('.edit-layer .deck').count() == 0, page.locator('.edit-layer .deck').count())
    page.locator('.cm-voice-play').click()
    open_note(page, 'Second')
    page.mouse.move(1500, 300)
    time.sleep(0.6)
    shot(page, '08-sidebar-dark', 'aside .deck', pad=24)
    sidebar_card(page).hover()
    time.sleep(0.5)
    shot(page, '09-sidebar-dark-hover', 'aside .deck', pad=24)
    b.close()

print(f'\n{fails} failed')
