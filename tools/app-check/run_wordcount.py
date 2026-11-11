"""The word count in a note's top bar: shown on open, follows typing (also without a pause),
survives a rename, follows a change made outside the app, and is right for each note."""
import sys, time, re
from playwright.sync_api import sync_playwright
import lab

PORT = int(sys.argv[1])
WORK = lab.WORK / 'work'
vault = WORK / 'vault-small'
lab.seed_vault(vault)
ud = WORK / 'ud'
lab.profile(ud, vault)
proc, _ = lab.launch(ud, PORT, WORK / 'app.log')
fails = []


def count(page):
    t = page.evaluate("() => { const e = document.querySelector('.note-info span'); return e ? e.textContent : null }")
    m = re.match(r'\s*([\d,.\s]+)\s+words?', t or '')
    return int(re.sub(r'[^\d]', '', m.group(1))) if m else None


def check(n, name, ok, detail=''):
    print(f"  {n}. {'PASS' if ok else 'FAIL'}  {name}  {detail}")
    if not ok:
        fails.append(n)


def type_at_end(page, text, delay=40):
    """Type on a fresh line at the very end of the note — nowhere a new word can join an old one."""
    page.locator('.cm-content').first.click()
    page.keyboard.press('Meta+ArrowDown')
    page.keyboard.press('Enter')
    page.keyboard.type(text, delay=delay)




try:
    with sync_playwright() as p:
        b, page = lab.connect(p, PORT)
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)[:200]))
        page.wait_for_selector('.tree-row', timeout=30000)
        time.sleep(2.5)

        lab.open_note(page, None, 'Typical', settle=1.5)
        n0 = count(page)
        check(1, 'a note shows its count when opened', bool(n0) and n0 > 100, f'({n0} words)')

        type_at_end(page, 'alpha beta gamma')
        time.sleep(0.5)
        n1 = count(page)
        check(2, 'typing three words adds three', n1 == n0 + 3, f'({n0} -> {n1})')

        # typing with no pause: the count must move WHILE the keys are still going
        seen = set()
        text = ' one two three four five six seven eight nine ten eleven twelve'
        page.keyboard.press('Meta+ArrowDown')
        for i, ch in enumerate(text):
            page.keyboard.type(ch)
            if i % 6 == 5:
                seen.add(count(page))
            time.sleep(0.03)
        mid = max(x for x in seen if x is not None)
        time.sleep(0.5)
        n2 = count(page)
        check(3, 'the count follows while you type without a pause', len(seen) >= 3 and mid > n1, f'(saw {sorted(x for x in seen if x is not None)})')
        check(4, 'and settles on the right number', n2 == n1 + 12, f'({n1} -> {n2})')

        # another note has its own count; coming back shows this one's again
        lab.open_note(page, None, 'Cell structure', settle=1.2)
        other = count(page)
        lab.open_note(page, None, 'Typical', settle=1.2)
        back = count(page)
        check(5, 'each note shows its own count', other is not None and other != n2 and back == n2, f'(other {other}, back {back})')

        # rename from the note's name box: the count stays
        title = page.locator('input[placeholder="Untitled"]').first
        title.click()
        page.keyboard.press('Meta+a')
        page.keyboard.type('Renamed note', delay=20)
        page.keyboard.press('Enter')
        time.sleep(1.5)
        n3 = count(page)
        on_disk = (vault / 'Biology' / 'Renamed note.md').exists()
        check(6, 'renaming the note keeps its count', on_disk and n3 == n2, f'(renamed on disk: {on_disk}, count {n3})')

        # typed straight after the rename: still counted, under the new name
        type_at_end(page, 'delta epsilon')
        time.sleep(0.5)
        n4 = count(page)
        time.sleep(1.0)
        landed = 'delta epsilon' in (vault / 'Biology' / 'Renamed note.md').read_text()
        check(7, 'typing after a rename still counts', n4 == n3 + 2 and landed, f'({n3} -> {n4}; saved under the new name: {landed})')

        # a change made outside the app (the note saved first, so it is not holding unsaved typing)
        time.sleep(1.2)
        f = vault / 'Biology' / 'Renamed note.md'
        f.write_text('# Renamed note\n\nJust five words here now.\n')
        time.sleep(2.5)
        n5 = count(page)
        check(8, 'a change made outside the app is counted', n5 == 7, f'(count {n5}, expected 7)')

        # an emptied note reads 0 words, and "1 word" is singular
        page.locator('.cm-content').first.click()
        page.keyboard.press('Meta+a')
        page.keyboard.press('Backspace')
        time.sleep(0.5)
        zero = page.evaluate("() => document.querySelector('.note-info span').textContent.trim()")
        page.keyboard.type('hello', delay=30)
        time.sleep(0.5)
        one = page.evaluate("() => document.querySelector('.note-info span').textContent.trim()")
        check(9, 'an empty note says "0 words", one word says "1 word"', zero == '0 words' and one == '1 word', f'({zero!r}, {one!r})')

        check(10, 'no errors in the window', not errors, str(errors[:3]))
        b.close()
finally:
    lab.stop(proc)
print('ALL PASS' if not fails else f'FAILED: {fails}')
