"""Keep-a-copy on quit, another program's own save, and the awkward edges around them."""
import ctypes, json, os, subprocess, sys, time
from ctypes import wintypes
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
import winlab as w

PORT = int(sys.argv[1])
INS = PORT + 100
NODE = r'C:\Program Files\nodejs\node.exe'
k32 = ctypes.WinDLL('kernel32', use_last_error=True)
k32.CreateFileW.restype = wintypes.HANDLE
k32.CreateFileW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD, wintypes.LPVOID, wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE]
k32.CloseHandle.argtypes = [wintypes.HANDLE]
results = []
FILES = {'Ideas.txt': b'start\r\n', 'Other.txt': b'other\n', 'm.csv': b'a,b\n1,2\n'}


def check(name, ok, detail=''):
    results.append(bool(ok))
    print(('PASS ' if ok else 'FAIL ') + name + (f' - {detail}' if detail else ''), flush=True)


def lock(a, f='Ideas.txt', share=1):
    return k32.CreateFileW(str(a.bio / f), 0xC0000000, share, None, 3, 0x80, None)


def type_in(a, words='KEEPME', wait=2.5):
    a.page.locator('.doc-text .cm-content').click()
    a.page.keyboard.press('Control+End')
    a.page.keyboard.type(words)
    if wait: time.sleep(wait)


def blocked(a, f='Ideas.txt', words='KEEPME'):
    a.open(f)
    h = lock(a, f)
    type_in(a, words)
    return h


def shown(a):
    return a.page.evaluate("() => document.querySelector('.doc-text .cm-content')?.innerText ?? ''")


def quit_app(a):
    a.page.evaluate('window.close()')
    for _ in range(40):
        if a.proc.poll() is not None: break
        time.sleep(0.15)
    time.sleep(0.3)


def copies(a):
    return sorted(p for p in a.vault.glob('Recovered*.md'))


def words(p):
    return p.read_bytes().replace(b'\r\n', b'\n')


def outside_save(a, f, data):
    """Another program replaces the file, as Excel does when it saves."""
    t = a.bio / (f + '.outside')
    t.write_bytes(data)
    os.replace(t, a.bio / f)


# --- quit ---------------------------------------------------------------------------
with w.App('k-quit', FILES, PORT) as a:
    h = blocked(a); quit_app(a); k32.CloseHandle(h)
    c = copies(a)
    check('quit while held: one Recovered note', len(c) == 1, str([p.name for p in c]))
    check('...holding the words', c and words(c[0]) == b'start\nKEEPME', repr(words(c[0])) if c else '')
    check('...the original is untouched', (a.bio / 'Ideas.txt').read_bytes() == b'start\r\n')
    check('...no temp files left', not [p for p in a.vault.rglob('*.tmp')])

with w.App('k-quick', FILES, PORT) as a:
    a.open('Ideas.txt'); h = lock(a); type_in(a, 'FAST', 0); quit_app(a); k32.CloseHandle(h)
    c = copies(a)
    check('quit a split second after typing, while held: still kept', len(c) == 1 and b'FAST' in words(c[0]), str([words(p) for p in c]))

with w.App('k-away', FILES, PORT) as a:
    h = blocked(a); a.open('Other.txt'); quit_app(a); k32.CloseHandle(h)
    c = copies(a)
    check('quit with the blocked file not on screen: kept', len(c) == 1 and b'KEEPME' in words(c[0]), str([p.name for p in c]))

with w.App('k-two', {'A/Same.txt': b'one\n', 'B/Same.txt': b'two\n', 'Note2.md': b'# n\n'}, PORT) as a:
    a.open('A', 0.5); a.open('B', 0.5)
    rows = a.page.locator('.tree-title', has_text='Same.txt')
    rows.nth(0).click(); time.sleep(1); h1 = lock(a, 'A/Same.txt'); type_in(a, 'FIRST')
    rows.nth(1).click(); time.sleep(1); h2 = lock(a, 'B/Same.txt'); type_in(a, 'SECOND')
    quit_app(a); k32.CloseHandle(h1); k32.CloseHandle(h2)
    got = [words(p) for p in copies(a)]
    check('two blocked files with the same name: two separate copies', len(got) == 2 and any(b'FIRST' in x for x in got) and any(b'SECOND' in x for x in got), str(got))

LONG = 'L' * (250 - len(str(w.WORK / 'case-k-long' / 'vault' / 'Biology')) - 1 - 4) + '.txt'
with w.App('k-long', {LONG: b'deep\n'}, PORT) as a:
    n = LONG
    a.open('LLLL'); h = lock(a, n); type_in(a); quit_app(a); k32.CloseHandle(h)
    c = copies(a)
    check('a very long file name still gets its copy', len(c) == 1 and b'KEEPME' in words(c[0]), str(len(c)))

with w.App('k-csv', FILES, PORT) as a:
    a.open('m.csv'); h = lock(a, 'm.csv')
    a.page.locator('.doc-sheet tbody tr').nth(1).locator('td').nth(1).click()
    a.page.keyboard.press('Control+a'); a.page.keyboard.type('77'); a.page.keyboard.press('Enter'); a.page.keyboard.press('Escape'); time.sleep(2.5)
    quit_app(a); k32.CloseHandle(h)
    c = copies(a)
    check('a blocked CSV keeps its table as CSV', len(c) == 1 and words(c[0]) == b'a,b\n1,77\n', str([words(p) for p in c]))

with w.App('k-none', FILES, PORT) as a:
    a.open('Ideas.txt'); type_in(a, 'fine', 1); quit_app(a)
    check('an ordinary quit makes no copy', not copies(a) and (a.bio / 'Ideas.txt').read_bytes() == b'start\r\nfine')

with w.App('k-freed', FILES, PORT) as a:
    h = blocked(a); k32.CloseHandle(h); time.sleep(0.2); quit_app(a)
    check('let go before the quit: saved, no copy', not copies(a) and (a.bio / 'Ideas.txt').read_bytes() == b'start\r\nKEEPME', str([p.name for p in copies(a)]))

# --- another program saves its own work --------------------------------------------
with w.App('k-outside', FILES, PORT) as a:
    h = blocked(a); k32.CloseHandle(h)
    outside_save(a, 'Ideas.txt', b'FROM EXCEL\r\n'); time.sleep(3)
    check('its save is never written over', (a.bio / 'Ideas.txt').read_bytes() == b'FROM EXCEL\r\n', repr((a.bio / 'Ideas.txt').read_bytes()))
    c = copies(a)
    check('...your change goes in a Recovered note', len(c) == 1 and b'KEEPME' in words(c[0]), str([p.name for p in c]))
    check('...the tab shows the other program\'s words', 'FROM EXCEL' in shown(a), shown(a))
    check('...the message says so', 'Recovered' in a.page.locator('.notice').first.inner_text())
    check('...the note appears in the sidebar', any('Recovered' in t for t in a.titles()), str(a.titles()))
    check('...the "couldn\'t save" line has gone', a.page.locator('[role=alert]').count() == 0)
    type_in(a, 'NEXT', 1.2)
    check('...and typing afterwards saves on top of its version', (a.bio / 'Ideas.txt').read_bytes() == b'FROM EXCEL\r\nNEXT', repr((a.bio / 'Ideas.txt').read_bytes()))
    a.page.evaluate('window.dispatchEvent(new Event("blur"))'); time.sleep(1)
    check('...with only one copy made', len(copies(a)) == 1, str(len(copies(a))))

with w.App('k-outside-away', FILES, PORT) as a:
    h = blocked(a); a.open('Other.txt'); k32.CloseHandle(h)
    outside_save(a, 'Ideas.txt', b'FROM EXCEL\r\n'); time.sleep(3)
    check('same when the file is not on screen', (a.bio / 'Ideas.txt').read_bytes() == b'FROM EXCEL\r\n' and len(copies(a)) == 1, str([p.name for p in copies(a)]))
    a.open('Ideas.txt')
    check('...and reopening shows its version', 'FROM EXCEL' in shown(a) and 'KEEPME' not in shown(a), shown(a))

with w.App('k-outside-held', FILES, PORT) as a:
    h = blocked(a); k32.CloseHandle(h)
    outside_save(a, 'Ideas.txt', b'SAVED BUT STILL OPEN\r\n')
    h = lock(a); time.sleep(3)
    check('other program saved and still has it open: its words stay', (a.bio / 'Ideas.txt').read_bytes() == b'SAVED BUT STILL OPEN\r\n')
    check('...your change is in a note', len(copies(a)) == 1 and b'KEEPME' in words(copies(a)[0]), str(len(copies(a))))
    k32.CloseHandle(h)

with w.App('k-same', FILES, PORT) as a:
    h = blocked(a); k32.CloseHandle(h)
    outside_save(a, 'Ideas.txt', b'start\r\nKEEPME'); time.sleep(3)
    check('other program saved the very same words: no copy', not copies(a) and a.page.locator('[role=alert]').count() == 0, str([p.name for p in copies(a)]))

with w.App('k-resaved', FILES, PORT) as a:
    a.open('Ideas.txt'); type_in(a, 'ONE', 1.2)
    h = lock(a); type_in(a, 'TWO'); k32.CloseHandle(h); time.sleep(0.2)
    a.page.evaluate('window.dispatchEvent(new Event("blur"))'); time.sleep(1.5)
    check('a blocked edit after a saved one lands, with no false "changed elsewhere"', not copies(a) and (a.bio / 'Ideas.txt').read_bytes() == b'start\r\nONETWO', repr((a.bio / 'Ideas.txt').read_bytes()))

with w.App('k-popup-outside', FILES, PORT) as a:
    h = blocked(a); a.page.locator('[aria-label="Close Ideas.txt"]').first.click(); time.sleep(2)
    k32.CloseHandle(h); outside_save(a, 'Ideas.txt', b'FROM EXCEL\r\n'); time.sleep(0.2)
    a.page.get_by_role('button', name='Try again').click(); time.sleep(2)
    check('Try again after the other program saved: its words stay', (a.bio / 'Ideas.txt').read_bytes() == b'FROM EXCEL\r\n')
    check('...your change is in a note and the tab closes', len(copies(a)) == 1 and a.page.locator('[aria-label="Close Ideas.txt"]').count() == 0, str(len(copies(a))))

# --- the file goes ------------------------------------------------------------------
with w.App('k-gone', FILES, PORT) as a:
    h = blocked(a); k32.CloseHandle(h); (a.bio / 'Ideas.txt').unlink(); time.sleep(3)
    c = copies(a)
    check('the file deleted outside: your change is in a note', len(c) == 1 and b'KEEPME' in words(c[0]), str([p.name for p in c]))
    check('...and it is not recreated', not (a.bio / 'Ideas.txt').exists())
    check('...no page errors', not a.errors, str(a.errors[:2]))

# --- spaces and folders -------------------------------------------------------------
with w.App('k-space', {**FILES, '../Chemistry/Lab.md': b'# Lab\n'}, PORT) as a:
    time.sleep(1)
    h = blocked(a)
    before = a.page.evaluate("() => document.documentElement.dataset.theme")
    a.page.keyboard.press('Control+Alt+Shift+ArrowRight'); time.sleep(1.4)
    away = a.page.locator('[aria-label="Close Ideas.txt"]').count() == 0
    a.page.keyboard.press('Control+Alt+Shift+ArrowLeft'); time.sleep(1.6)
    check('switching space and back keeps the words', away and 'KEEPME' in shown(a), f'left the space: {away}; shows {shown(a)!r}')
    k32.CloseHandle(h); time.sleep(0.2); quit_app(a)
    check('...and they save once it lets go', (a.bio / 'Ideas.txt').read_bytes() == b'start\r\nKEEPME' and not copies(a), repr((a.bio / 'Ideas.txt').read_bytes()))

with w.App('k-folder', {'Unit/Ideas.txt': b'start\r\n'}, PORT) as a:
    a.open('Unit', 0.6); a.open('Ideas.txt'); h = lock(a, 'Unit/Ideas.txt'); type_in(a)
    k32.CloseHandle(h); h = k32.CreateFileW(str(a.bio / 'Unit' / 'Ideas.txt'), 0x80000000, 7, None, 3, 0x80, None)
    a.page.locator('.tree-title', has_text='Unit').first.click(button='right'); time.sleep(0.4)
    a.page.get_by_text('Rename', exact=True).first.click(); time.sleep(0.4)
    a.page.keyboard.press('Control+a'); a.page.keyboard.type('Unit two'); a.page.keyboard.press('Enter'); time.sleep(3)
    k32.CloseHandle(h); time.sleep(0.3)
    moved = (a.bio / 'Unit two' / 'Ideas.txt')
    if moved.exists():
        check('a folder renamed round a blocked file keeps the words', 'KEEPME' in shown(a), shown(a))
        quit_app(a)
        check('...and saves them in the new place', b'KEEPME' in moved.read_bytes() and not (a.bio / 'Unit').exists(), repr(moved.read_bytes()))
    else:
        check('folder rename refused while held keeps the words', 'KEEPME' in shown(a), shown(a))
        quit_app(a)
        check('...and saves them', b'KEEPME' in (a.bio / 'Unit' / 'Ideas.txt').read_bytes(), repr((a.bio / 'Unit' / 'Ideas.txt').read_bytes()))

with w.App('k-bin', FILES, PORT) as a:
    h = blocked(a); k32.CloseHandle(h)
    h = k32.CreateFileW(str(a.bio / 'Ideas.txt'), 0x80000000, 7, None, 3, 0x80, None)
    row = a.page.locator('.tree-row', has=a.page.locator('.tree-title', has_text='Ideas.txt')).first
    row.hover(); row.locator('[data-tip="Move to bin"]').click(); time.sleep(2.5)
    k32.CloseHandle(h); time.sleep(0.3)
    gone = not (a.bio / 'Ideas.txt').exists()
    check('binning a file with a blocked edit moves it to the bin', gone)
    check('...and the edit is in one Recovered note', len(copies(a)) == 1 and b'KEEPME' in words(copies(a)[0]), str(len(copies(a))))
    check('...which shows in the sidebar', any('Recovered' in t for t in a.titles()), str(a.titles()))
    quit_app(a)
    check('...the binned file is not brought back by the quit', not (a.bio / 'Ideas.txt').exists())
    check('...and the quit makes no second copy', len(copies(a)) == 1, str(len(copies(a))))

if os.environ.get('APP_EXE'):  # the real app has no way in to answer its folder box
    print(f'\n{sum(results)}/{len(results)} passed'); raise SystemExit(0)

with w.App('k-switch', FILES, PORT, inspect=INS) as a:
    other = w.WORK / 'k-other-vault'
    import shutil
    if other.exists(): shutil.rmtree(other)
    (other / 'Biology').mkdir(parents=True); (other / 'Biology' / 'Ideas.txt').write_bytes(b'other vault\n'); (other / '.mdnotes').mkdir()
    (other / '.mdnotes' / 'settings.json').write_text(json.dumps({'spaces': [{'folder': 'Biology', 'theme': 'light'}], 'activeSpaceFolder': 'Biology', 'playStartupAnimation': False}), encoding='utf-8')
    time.sleep(0.6)
    subprocess.run([NODE, str(w.REPO / 'tools' / 'app-check' / 'patch_dialog.mjs'), str(INS), str(other)], capture_output=True, text=True)
    h = blocked(a)
    a.page.locator('[aria-label="Settings"]').first.click(); time.sleep(1.2)
    a.page.get_by_text('Data', exact=True).first.click(); time.sleep(0.5)
    a.page.get_by_text('Source folder', exact=True).first.click(); time.sleep(0.5)
    sw = a.page.get_by_role('button', name='Choose a different folder')
    has = sw.count() > 0
    if has:
        sw.first.click(); time.sleep(2.2)
        check('switching notes folder while held is refused', (other / 'Biology' / 'Ideas.txt').read_bytes() == b'other vault\n' and 'Couldn' in a.page.locator('.notice').first.inner_text(), a.page.locator('.notice').first.inner_text()[:80] if a.page.locator('.notice').count() else 'no message')
        k32.CloseHandle(h); time.sleep(0.2)
        sw.first.click(); time.sleep(3)
        check('...once it lets go the change saves to the right file', (a.bio / 'Ideas.txt').read_bytes() == b'start\r\nKEEPME', repr((a.bio / 'Ideas.txt').read_bytes()))
        check('...and the other folder\'s same-named file is untouched', (other / 'Biology' / 'Ideas.txt').read_bytes() == b'other vault\n')
    else:
        k32.CloseHandle(h); print('SKIP folder switch: button not found', flush=True)

print(f'\n{sum(results)}/{len(results)} passed')
