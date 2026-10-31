"""Naming a voice note (Reuben, 2026-10-16): right-click the block, or click its six dots once it is
selected, → "Name voice note…" → type → Enter. The name goes onto the note's line as data-name, shows
above the player and on the tape card; Escape leaves it, clicking away keeps it, Cmd+Z takes it back,
"Remove name" takes it off.

    WORK=/some/scratch/dir python3 name.py [shots-dir]

First run, 2026-10-16 (Mac): 14 ok, 0 failed."""
import json, sys, time
from pathlib import Path
from common import WORK, app, connect, open_zoom_note, reset_vault, MOD, REDO
from playwright.sync_api import sync_playwright

SHOTS = Path(sys.argv[1]) if len(sys.argv) > 1 else WORK / 'shots'
SHOTS.mkdir(parents=True, exist_ok=True)
fails = 0
oks = 0


def check(name: str, ok: bool, saw=None) -> None:
    global fails, oks
    if ok:
        oks += 1
    else:
        fails += 1
    print(('ok    ' if ok else 'FAIL  ') + name + ('' if ok else f'  — saw {saw!r}'))


def audio_line(note: Path) -> str:
    return next((l for l in note.read_text().splitlines() if l.startswith('<audio')), '')


def shown_name(page):
    return page.evaluate("() => { const n = document.querySelector('.cm-voice-name'); return n && !n.hidden ? n.textContent : null }")


def menu_click(page, label: str) -> None:
    page.locator('.menu-item', has_text=label).first.click()
    time.sleep(0.3)


vault = reset_vault()
note = vault / 'Voice' / 'Zoom.md'

with sync_playwright() as p, app(9346):
    b, page = connect(p, 9346)
    open_zoom_note(page)
    wave = page.locator('.cm-voice-wavebox').first.bounding_box()

    # --- right-click → Name voice note… → type → Enter -------------------------
    page.mouse.click(wave['x'] + wave['width'] / 2, wave['y'] + wave['height'] / 2, button='right')
    time.sleep(0.4)
    items = page.evaluate("() => [...document.querySelectorAll('.menu-item')].map(e => e.textContent.trim())")
    check('right-click the voice note: the menu offers "Name voice note…"', items == ['Name voice note…'], items)
    menu_click(page, 'Name voice note…')
    focused = page.evaluate("() => document.activeElement?.className")
    check('…which opens the name box, ready to type', focused == 'cm-voice-name-input', focused)
    page.screenshot(path=str(SHOTS / 'name-01-box.png'), clip={'x': wave['x'] - 80, 'y': wave['y'] - 60, 'width': 900, 'height': 120})
    page.keyboard.type('Lecture 3')
    page.keyboard.press('Enter')
    time.sleep(1.2)
    check('Enter: the name shows above the player', shown_name(page) == 'Lecture 3', shown_name(page))
    check('…and is written on the line in the file', 'data-name="Lecture 3"' in audio_line(note), audio_line(note))
    page.screenshot(path=str(SHOTS / 'name-02-named.png'), clip={'x': wave['x'] - 80, 'y': wave['y'] - 60, 'width': 900, 'height': 120})

    # --- Cmd+Z takes it back, Cmd+Shift+Z puts it back -----------------------------
    page.keyboard.press(f'{MOD}+z')
    time.sleep(1.0)
    check('Cmd+Z takes the name back', shown_name(page) is None and 'data-name' not in audio_line(note), (shown_name(page), audio_line(note)))
    page.keyboard.press(REDO)
    time.sleep(1.0)
    check('Cmd+Shift+Z puts it back', shown_name(page) == 'Lecture 3', shown_name(page))

    # --- the six dots: once to select, again for the menu --------------------------
    page.locator('.cm-voice').first.hover()
    time.sleep(0.3)
    grip = page.locator('.cm-voice .cm-attach-grip').first
    grip.click()
    time.sleep(0.4)
    sel = page.evaluate("() => document.querySelector('.cm-voice').classList.contains('cm-attach-selected')")
    menu_up = page.locator('.menu-item').count()
    check('first click on the six dots selects it (no menu yet)', sel and menu_up == 0, (sel, menu_up))
    grip.click()
    time.sleep(0.4)
    items = page.evaluate("() => [...document.querySelectorAll('.menu-item')].map(e => e.textContent.trim())")
    check('second click, while selected: "Rename voice note…" and "Remove name"', items == ['Rename voice note…', 'Remove name'], items)
    page.screenshot(path=str(SHOTS / 'name-03-grip-menu.png'), clip={'x': wave['x'] - 80, 'y': wave['y'] - 60, 'width': 900, 'height': 160})
    menu_click(page, 'Rename voice note…')
    val = page.evaluate("() => { const i = document.activeElement; return [i?.className, i?.value, i?.selectionStart, i?.selectionEnd] }")
    check('the box holds the current name, all selected', val == ['cm-voice-name-input', 'Lecture 3', 0, 9], val)

    # Escape leaves it; clicking away keeps what was typed.
    page.keyboard.type('Nope')
    page.keyboard.press('Escape')
    time.sleep(0.6)
    check('Escape leaves the name as it was', shown_name(page) == 'Lecture 3' and 'Lecture 3' in audio_line(note), shown_name(page))
    page.mouse.click(wave['x'] + 40, wave['y'] + 10, button='right')
    time.sleep(0.3)
    menu_click(page, 'Rename voice note…')
    name = 'Tom\'s "big" <idea> & src=\'x.m4a\''
    page.keyboard.type(name)
    page.locator('.cm-line', has_text='The line under it').click()
    time.sleep(1.2)
    check('clicking away keeps the new name — any characters', shown_name(page) == name, shown_name(page))
    line = audio_line(note)
    check('…written safely: the recording is still memo.m4a', line.startswith('<audio controls src="memo.m4a"') and '"big"' not in line and "src='x" not in line, line)

    # --- the tape card uses the name -----------------------------------------------
    page.locator('button[aria-label="Play this note\'s voice notes"]').click()
    time.sleep(0.5)
    title = page.evaluate("() => document.querySelector('.edit-layer .deck span.truncate')?.textContent")
    check('the tape card is titled with the name', title == name, title)
    page.keyboard.press('Escape')
    time.sleep(0.3)

    # --- Remove name ---------------------------------------------------------------------
    page.mouse.click(wave['x'] + 40, wave['y'] + 10, button='right')
    time.sleep(0.3)
    menu_click(page, 'Remove name')
    time.sleep(1.0)
    check('"Remove name" takes it off the block and the line', shown_name(page) is None and 'data-name' not in audio_line(note), (shown_name(page), audio_line(note)))

    # --- dark, Lined: how it looks ---------------------------------------------------------
    page.mouse.click(wave['x'] + 40, wave['y'] + 10, button='right')
    time.sleep(0.3)
    menu_click(page, 'Name voice note…')
    page.keyboard.type('Lecture 3 — thermodynamics')
    page.keyboard.press('Enter')
    time.sleep(0.8)
    page.emulate_media(color_scheme='dark')
    time.sleep(0.8)
    w = page.locator('.cm-voice').first.bounding_box()
    page.screenshot(path=str(SHOTS / 'name-04-dark.png'), clip={'x': w['x'] - 60, 'y': w['y'] - 30, 'width': w['width'] + 80, 'height': w['height'] + 60})
    b.close()

print(f'\n{oks} ok, {fails} failed')
