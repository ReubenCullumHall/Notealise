"""The blocked-save pop-up and every way of leaving a file, with a real lock from another process' handle."""
import ctypes, sys, time
from ctypes import wintypes
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
import winlab as w

PORT = int(sys.argv[1])
k32 = ctypes.WinDLL('kernel32', use_last_error=True)
k32.CreateFileW.restype = wintypes.HANDLE
k32.CreateFileW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD, wintypes.LPVOID, wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE]
k32.CloseHandle.argtypes = [wintypes.HANDLE]
results = []
FILES = {'Ideas.txt': b'start\r\n', 'Other.txt': b'other\n', 'm.csv': b'a,b\n1,2\n'}


def check(name, ok, detail=''):
    results.append(bool(ok))
    print(('PASS ' if ok else 'FAIL ') + name + (f' - {detail}' if detail else ''), flush=True)


def lock(a, f='Ideas.txt'):
    return k32.CreateFileW(str(a.bio / f), 0xC0000000, 1, None, 3, 0x80, None)


def blocked(a):
    a.open('Ideas.txt')
    h = lock(a)
    a.page.locator('.doc-text .cm-content').click()
    a.page.keyboard.press('Control+End')
    a.page.keyboard.type('KEEPME')
    time.sleep(2.5)
    return h


def shown(a):
    return a.page.evaluate("() => document.querySelector('.doc-text .cm-content')?.innerText ?? ''")


def box(a):
    return a.page.locator('[role=dialog][aria-label^="Couldn"]')


def disk(a, f='Ideas.txt'):
    return (a.bio / f).read_bytes()


def quit_app(a):
    a.page.evaluate('window.close()')
    time.sleep(3)


def close_tab(a, f='Ideas.txt'):
    a.page.locator(f'[aria-label="Close {f}"]').first.click()
    time.sleep(2)


with w.App('w-try', FILES, PORT) as a:
    h = blocked(a); close_tab(a)
    check('closing a tab with a blocked edit shows the pop-up', box(a).count() == 1)
    check('...and the tab stays open behind it', a.page.locator('[aria-label="Close Ideas.txt"]').count() == 1)
    a.page.screenshot(path=str(w.WORK / 'warn-popup.png'))
    a.page.get_by_role('button', name='Try again').click(); time.sleep(2)
    check('Try again while still blocked keeps the pop-up and says so', box(a).count() == 1 and 'still open' in box(a).inner_text(), box(a).inner_text()[:90])
    a.page.screenshot(path=str(w.WORK / 'warn-again.png'))
    k32.CloseHandle(h); time.sleep(0.3)
    a.page.get_by_role('button', name='Try again').click(); time.sleep(1.2)
    check('Try again after the other program lets go saves it', disk(a) == b'start\r\nKEEPME', repr(disk(a)))
    check('...and closes the tab and pop-up', box(a).count() == 0 and a.page.locator('[aria-label="Close Ideas.txt"]').count() == 0)

with w.App('w-anyway', FILES, PORT) as a:
    h = blocked(a); close_tab(a)
    a.page.get_by_role('button', name='Close anyway').click(); time.sleep(0.8)
    check('Close anyway closes the tab', box(a).count() == 0 and a.page.locator('[aria-label="Close Ideas.txt"]').count() == 0)
    k32.CloseHandle(h); time.sleep(0.3)
    a.open('Other.txt'); a.open('Ideas.txt')
    check('...and the change really is gone when reopened', 'KEEPME' not in shown(a), shown(a))
    quit_app(a)
    check('...and never reaches the file', disk(a) == b'start\r\n', repr(disk(a)))

with w.App('w-esc', FILES, PORT) as a:
    h = blocked(a); close_tab(a)
    a.page.keyboard.press('Escape'); time.sleep(0.5)
    check('Escape leaves the tab and the words', box(a).count() == 0 and 'KEEPME' in shown(a), shown(a))
    a.page.keyboard.press('Control+w'); time.sleep(2)
    check('Ctrl+W asks too', box(a).count() == 1)
    a.page.keyboard.press('Control+w'); time.sleep(0.5)
    check('...and a second Ctrl+W behind the pop-up does nothing', a.page.locator('[aria-label="Close Ideas.txt"]').count() == 1)
    a.page.mouse.click(8, 8); time.sleep(0.4)
    check('a click outside the pop-up keeps everything', box(a).count() == 0 and 'KEEPME' in shown(a))
    t = a.page.locator('[aria-label="Close Ideas.txt"]').bounding_box()
    a.page.mouse.click(t['x'] - 30, t['y'] + t['height'] / 2, button='middle'); time.sleep(2)
    check('a middle-click on the tab asks too', box(a).count() == 1)
    a.page.keyboard.press('Escape'); time.sleep(0.3)
    a.page.mouse.click(t['x'] - 30, t['y'] + t['height'] / 2, button='right'); time.sleep(0.5)
    a.page.locator('.menu-item', has_text='Close Ideas.txt').click(); time.sleep(2)
    check('the tab right-click menu asks too', box(a).count() == 1)
    a.page.keyboard.press('Escape'); time.sleep(0.3)
    k32.CloseHandle(h)

with w.App('w-tab', {**FILES}, PORT) as a:
    a.open('Other.txt')
    a.page.locator('.tree-title', has_text='Ideas.txt').first.click(modifiers=['Control']); time.sleep(1)
    h = lock(a)
    a.page.locator('.doc-text .cm-content').click(); a.page.keyboard.press('Control+End'); a.page.keyboard.type('KEEPME'); time.sleep(2.5)
    a.page.keyboard.press('Control+1'); time.sleep(1); a.page.keyboard.press('Control+2'); time.sleep(1.2)
    check('switching tabs and back keeps the words', 'KEEPME' in shown(a), shown(a))
    check('...and still says it could not save', 'Couldn' in a.page.locator('[role=alert]').first.inner_text())
    a.page.locator('.doc-text .cm-content').click(); a.page.keyboard.press('Control+End'); a.page.keyboard.type('MORE'); time.sleep(2.5)
    k32.CloseHandle(h); time.sleep(0.3)
    quit_app(a)
    check('typing more after coming back, then the lock lifts and a quit saves both', disk(a) == b'start\r\nKEEPMEMORE', repr(disk(a)))

with w.App('w-replace', FILES, PORT) as a:
    h = blocked(a)
    a.open('Other.txt'); a.open('Ideas.txt')
    check('clicking another file in the sidebar and back keeps the words', 'KEEPME' in shown(a), shown(a))
    a.open('Other.txt')
    k32.CloseHandle(h); time.sleep(0.3)
    quit_app(a)
    check('...and a quit with the file no longer on screen still saves it', disk(a) == b'start\r\nKEEPME', repr(disk(a)))

with w.App('w-csv', FILES, PORT) as a:
    a.open('m.csv'); h = lock(a, 'm.csv')
    a.page.locator('.doc-sheet tbody tr').nth(1).locator('td').nth(1).click()
    a.page.keyboard.press('Control+a'); a.page.keyboard.type('77'); a.page.keyboard.press('Enter'); a.page.keyboard.press('Escape'); time.sleep(2.5)
    a.open('Other.txt'); a.open('m.csv')
    check('a blocked CSV cell survives clicking away', a.page.locator('.doc-sheet tbody tr').nth(1).locator('td').nth(1).inner_text() == '77')
    k32.CloseHandle(h); time.sleep(0.3)
    close_tab(a, 'm.csv')
    check('closing it once unblocked saves with no pop-up', box(a).count() == 0 and disk(a, 'm.csv') == b'a,b\n1,77\n', repr(disk(a, 'm.csv')))

with w.App('w-normal', FILES, PORT) as a:
    a.open('Ideas.txt'); a.page.locator('.doc-text .cm-content').click(); a.page.keyboard.press('Control+End'); a.page.keyboard.type('fast')
    a.page.locator('[aria-label="Close Ideas.txt"]').first.click(); time.sleep(0.8)
    check('an ordinary quick close saves with no pop-up', box(a).count() == 0 and disk(a) == b'start\r\nfast', repr(disk(a)))
    check('no page errors', not a.errors, str(a.errors[:2]))

with w.App('w-rename', FILES, PORT) as a:
    h = blocked(a); k32.CloseHandle(h); time.sleep(0.2)
    h2 = k32.CreateFileW(str(a.bio / 'Ideas.txt'), 0x80000000, 7, None, 3, 0x80, None)
    a.page.locator('.tree-title', has_text='Ideas.txt').first.click(button='right'); time.sleep(0.4)
    a.page.get_by_text('Rename', exact=True).first.click(); time.sleep(0.4)
    a.page.keyboard.press('Control+a'); a.page.keyboard.type('Renamed'); a.page.keyboard.press('Enter'); time.sleep(2.5)
    check('a rename with a blocked edit keeps the words on screen', 'KEEPME' in shown(a), shown(a))
    k32.CloseHandle(h2); time.sleep(0.3)
    quit_app(a)
    check('...and they land in the renamed file, with no copy at the old name', (a.bio / 'Renamed.txt').exists() and b'KEEPME' in (a.bio / 'Renamed.txt').read_bytes() and not (a.bio / 'Ideas.txt').exists(), repr((a.bio / 'Renamed.txt').read_bytes()) if (a.bio / 'Renamed.txt').exists() else 'no file')

with w.App('w-quit', FILES, PORT) as a:
    h = blocked(a)
    quit_app(a)
    k32.CloseHandle(h); time.sleep(0.2)
    made = sorted(p.name for p in a.vault.rglob('*') if 'Recovered' in p.name)
    print('INFO quit while the file is STILL held: in the file =', b'KEEPME' in disk(a), '| recovered copies =', made, flush=True)

print(f'\n{sum(results)}/{len(results)} passed')
