"""The voice note editor (docs/plans/voice-editor.md), in the real app with real input.

    WORK=/some/dir ./build.sh && WORK=/some/dir python3 clip_edit.py

Makes a spoken "three takes with pauses" clip (`say`), opens it from the scissors and from the
right-click menu, then: trims, cuts, Keep only this, Undo/redo, Remove silences, split, zoom, speed,
Save / Save as new clip(s), and reads back the note and the files on disk. Screenshots go to
WORK/clip-shots. Mac only as written (afconvert, `say`)."""
import json, os, re, shutil, struct, subprocess, sys, time
from pathlib import Path
from playwright.sync_api import sync_playwright
sys.path.insert(0, str(Path(__file__).parent))
from common import WORK, ELECTRON, MOD  # noqa: E402

PORT = int(os.environ.get('PORT', '9467'))
SHOTS = WORK / 'clip-shots'
SHOTS.mkdir(exist_ok=True)
results = []
# a section's block on the timeline (not the dashed whole-clip hint, not a take being recorded)
SEC = '.clip-ed-band:not(.is-whole):not(.is-recording)'


def check(name, ok, detail=''):
    results.append((name, bool(ok), detail))
    print(('PASS ' if ok else 'FAIL ') + name + (f' — {detail}' if detail else ''))


def make_clip():
    if (WORK / 'takes.m4a').exists():
        return
    subprocess.run(['say', '-v', 'Daniel', '-o', str(WORK / 'takes.aiff'),
                    "Um, okay. La photosynthèse... no, wait. [[slnc 2200]] Photosynthesis is how plants turn sunlight into food. "
                    "Uh, hang on. [[slnc 2600]] Take three. Photosynthesis is how plants use light, water and carbon dioxide to make "
                    "glucose, and they give off oxygen as they do it. [[slnc 1800]] Yeah, that one's good."], check=True)
    subprocess.run(['afconvert', '-f', 'm4af', '-d', 'aac', str(WORK / 'takes.aiff'), str(WORK / 'takes.m4a')], check=True)


def duration(p: Path) -> float:
    out = subprocess.run(['afinfo', str(p)], capture_output=True, text=True).stdout
    for line in out.splitlines():
        if 'estimated duration' in line:
            return float(line.split(':')[1].split()[0])
    return -1


def vault():
    v = WORK / 'clip-vault'
    if v.exists():
        shutil.rmtree(v)
    (v / 'Biology').mkdir(parents=True)
    (v / '.mdnotes').mkdir()
    shutil.copy(WORK / 'takes.m4a', v / 'Biology' / 'takes.m4a')
    (v / 'Biology' / 'Photosynthesis.md').write_text(
        '# Photosynthesis\n\nIn my own words.\n\n<audio controls src="takes.m4a" data-name="Explain it" data-volume="1.5"></audio>\n\nAfter it.\n')
    (v / '.mdnotes' / 'settings.json').write_text(json.dumps({'spaces': [{'folder': 'Biology'}], 'activeSpaceFolder': 'Biology'}))
    ud = WORK / 'clip-ud'
    if ud.exists():
        shutil.rmtree(ud)
    ud.mkdir()
    (ud / 'config.json').write_text(json.dumps({'vaultPath': str(v), 'hasOnboarded': True}))
    return v, ud


def note_text(v):
    return (v / 'Biology' / 'Photosynthesis.md').read_text()


def main():
    if subprocess.run(['lsof', '-nP', f'-iTCP:{PORT}', '-sTCP:LISTEN'], capture_output=True).stdout:
        raise SystemExit(f'port {PORT} is taken (another session\'s test app?) — pick a free one with PORT=')
    make_clip()
    v, ud = vault()
    env = {k: x for k, x in os.environ.items() if k != 'ELECTRON_RUN_AS_NODE'}
    proc = subprocess.Popen([str(ELECTRON), str(WORK / 'out/main/index.js'), f'--user-data-dir={ud}',
                             f'--remote-debugging-port={PORT}', '--mute-audio',
                             # a fake microphone (a beep) for "Record another take" — never the fake-UI switch,
                             # which skips the app's own permission check (docs/security.md 2c)
                             '--use-fake-device-for-media-stream'], env=env,
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        with sync_playwright() as p:
            for _ in range(60):
                try:
                    b = p.chromium.connect_over_cdp(f'http://127.0.0.1:{PORT}')
                    page = next(pg for c in b.contexts for pg in c.pages if pg.url.startswith('file:'))
                    break
                except Exception:
                    time.sleep(0.5)
            page.set_default_timeout(15000)
            page.emulate_media(color_scheme='light', reduced_motion='no-preference')
            errors = []
            page.on('pageerror', lambda e: errors.append(str(e)))
            time.sleep(1.5)
            page.locator('.tree-title', has_text='Photosynthesis').first.click()
            page.wait_for_selector('.cm-voice[data-state="ready"]', timeout=20000)
            time.sleep(0.8)

            # 1. the scissors opens it; Escape with nothing changed closes it
            page.locator('.cm-voice-editbtn').click()
            page.wait_for_selector('.clip-ed', timeout=5000)
            page.wait_for_function("() => !document.querySelector('.clip-ed-loading')", timeout=15000)
            time.sleep(0.5)
            check('scissors opens the editor', page.locator('[aria-label="Edit clip"][aria-modal="true"]').count() == 1)
            check('focus is in the panel, not the note', page.evaluate("() => !!document.activeElement.closest('.clip-ed')"))
            page.screenshot(path=str(SHOTS / '1_open.png'))
            total = page.evaluate("() => document.querySelector('.clip-ed-time em').textContent")
            check('shows the whole length', '0:26' in total, total)
            page.keyboard.press('Escape')
            page.wait_for_selector('.clip-ed', state='detached', timeout=3000)
            check('Esc closes an unchanged clip at once', True)

            # 2. right-click → Edit clip…
            box = page.locator('.cm-voice').first.bounding_box()
            page.mouse.click(box['x'] + box['width'] * 0.3, box['y'] + box['height'] / 2, button='right')
            time.sleep(0.4)
            first = page.locator('.menu .menu-item').first.text_content()
            check('right-click menu starts with Edit clip…', first.strip().startswith('Edit clip'), first)
            page.locator('.menu .menu-item').first.click()
            page.wait_for_selector('.clip-ed')
            page.wait_for_function("() => !document.querySelector('.clip-ed-loading')", timeout=15000)
            time.sleep(0.4)

            wave = page.locator('.clip-ed-in').bounding_box()
            X = lambda t, L: wave['x'] + wave['width'] * t / L  # noqa: E731
            L = 26.0
            # 3. select take 2 (6.3–10.8 s) by dragging, then Keep only this
            page.mouse.move(X(6.3, L), wave['y'] + 75)
            page.mouse.down()
            page.mouse.move(X(8, L), wave['y'] + 75, steps=4)
            page.mouse.move(X(10.8, L), wave['y'] + 75, steps=4)
            page.mouse.up()
            summ = page.locator('.clip-ed-sum').text_content()
            check('dragging selects a stretch', 'selected' in summ and page.get_by_role('button', name=re.compile(r'^Delete( ⌫| Del)?$')).is_enabled(), summ)
            page.screenshot(path=str(SHOTS / '2_selected.png'))
            page.get_by_role('button', name='Keep only this').click()
            time.sleep(0.3)
            total = page.evaluate("() => document.querySelector('.clip-ed-time em').textContent")
            check('Keep only this leaves just the take', '0:04.' in total, total)
            # 4. undo puts it back; redo takes it again
            page.keyboard.press(f'{MOD}+z')
            time.sleep(0.2)
            total = page.evaluate("() => document.querySelector('.clip-ed-time em').textContent")
            check('Undo brings the whole clip back', '0:26' in total, total)
            page.keyboard.press(f'{MOD}+Shift+z')
            time.sleep(0.2)
            total = page.evaluate("() => document.querySelector('.clip-ed-time em').textContent")
            check('Redo takes it again', '0:04.' in total, total)
            page.keyboard.press(f'{MOD}+z')
            time.sleep(0.2)

            # 5. Remove silences: three pauses, each down to a breath
            page.get_by_role('button', name='Remove silences').click()
            time.sleep(0.4)
            summ = page.locator('.clip-ed-sum').text_content()
            total = page.evaluate("() => document.querySelector('.clip-ed-time em').textContent")
            check('Remove silences finds the 3 pauses', 'Shortened 3 pauses' in summ, summ)
            check('…and the clip closes up (about 0:19–0:20)', total.strip().startswith('/ 0:19') or total.strip().startswith('/ 0:20'), total)
            check('a join mark for each pause', page.locator('.clip-ed-join').count() == 3, str(page.locator('.clip-ed-join').count()))
            page.screenshot(path=str(SHOTS / '3_silences.png'))
            # A change on disk redraws the app behind the panel (OneDrive bringing a note in).
            # Until 2026-11-04 that re-read the recording and threw the edits away.
            (v / 'Biology' / 'Arrived.md').write_text('# Arrived\n')
            time.sleep(2.0)
            again = page.evaluate("() => document.querySelector('.clip-ed-time em').textContent")
            check('edits survive the app redrawing behind the panel', again == total, f'{total} → {again}')

            # 6. Delete key cuts a selection; trim the start by its handle
            L2 = page.evaluate("() => { const t = document.querySelector('.clip-ed-time em').textContent.replace('/','').trim().split(':'); return +t[0]*60 + +t[1] }")
            page.mouse.move(X(0, L2), wave['y'] + 75)
            page.mouse.down()
            page.mouse.move(X(0.5, L2), wave['y'] + 75, steps=3)
            page.mouse.move(X(1.0, L2), wave['y'] + 75, steps=3)
            page.mouse.up()
            time.sleep(0.3)
            L3 = page.evaluate("() => { const t = document.querySelector('.clip-ed-time em').textContent.replace('/','').trim().split(':'); return +t[0]*60 + +t[1] }")
            check('dragging the start handle trims the start', abs((L2 - L3) - 1.0) < 0.25, f'{L2} → {L3}')

            # 7. split into takes with S at the playhead (click to move it)
            wave = page.locator('.clip-ed-in').bounding_box()
            page.mouse.click(X(5.0, L3), wave['y'] + 75)
            page.keyboard.press('s')
            page.mouse.click(X(11.0, L3), wave['y'] + 75)
            page.keyboard.press('s')
            time.sleep(0.3)
            check('S splits at the playhead (2 lines, 3 sections)', page.locator('.clip-ed-split').count() == 2 and page.locator(SEC).count() == 3
                  and page.locator(SEC).first.text_content() == 'Section 1')
            check('second button says Save as separate sections', page.get_by_role('button', name='Save as separate sections').count() == 1)

            # 7b. a whole section: right-click selects it, Backspace deletes it; the × deletes one too
            page.mouse.click(X(8.0, L3), wave['y'] + 75, button='right')
            time.sleep(0.2)
            sb = page.locator('.clip-ed-sel').bounding_box()
            check('right-click selects the whole section it is in', sb is not None and abs(sb['x'] - X(5.0, L3)) < 6 and abs(sb['x'] + sb['width'] - X(11.0, L3)) < 6, str(sb))
            page.keyboard.press('Backspace')
            time.sleep(0.3)
            check('…and Backspace deletes it, leaving one split', page.locator(SEC).count() == 2 and page.locator('.clip-ed-split').count() == 1)
            page.keyboard.press(f'{MOD}+z')
            time.sleep(0.3)
            page.get_by_role('button', name='Delete section 2').click()
            time.sleep(0.3)
            check('the × on a section deletes it', page.locator(SEC).count() == 2)
            page.keyboard.press(f'{MOD}+z')
            time.sleep(0.3)
            check('Undo brings it back', page.locator(SEC).count() == 3)

            # 7c. Resolve's keys and drags (Reuben, 2026-11-04). Sections now: [0,5] [5,11] [11,L3].
            tnow = lambda: (lambda x: int(x.split(':')[0]) * 60 + float(x.split(':')[1]))(page.evaluate("() => document.querySelector('.clip-ed-time span').textContent"))  # noqa: E731
            page.keyboard.press('Home')
            check('Home goes to the start', tnow() == 0, str(tnow()))
            page.keyboard.press('ArrowRight')
            check('→ steps a tenth of a second', abs(tnow() - 0.1) < 0.001, str(tnow()))
            page.keyboard.press('Shift+ArrowRight')
            check('Shift+→ steps a second', abs(tnow() - 1.1) < 0.001, str(tnow()))
            page.keyboard.press('End')
            check('End goes to the end', abs(tnow() - L3) < 0.06, f'{tnow()} vs {L3}')
            page.keyboard.press('Home')
            page.keyboard.press('ArrowDown')
            first = tnow()
            page.keyboard.press('ArrowDown')
            second = tnow()
            page.keyboard.press('ArrowUp')
            check('↓ jumps to the next edit, ↑ back to the one before', 0 < first < second and abs(tnow() - first) < 0.001, f'{first}, {second}, back {tnow()}')
            page.keyboard.press('Home')
            for _ in range(2):
                page.keyboard.press('Shift+ArrowRight')
            page.keyboard.press('i')
            page.keyboard.press('Shift+ArrowRight')
            page.keyboard.press('o')
            sb = page.locator('.clip-ed-sel').bounding_box()
            check('I and O mark a selection from 0:02 to 0:03', sb is not None and abs(sb['x'] - X(2, L3)) < 2 and abs(sb['x'] + sb['width'] - X(3, L3)) < 2, str(sb))
            # drag its right edge out to just short of the split at 5 s: it snaps onto the split
            page.mouse.move(X(3, L3), wave['y'] + 110)
            page.mouse.down()
            page.mouse.move(X(4, L3), wave['y'] + 110, steps=4)
            page.mouse.move(X(5, L3) - 4, wave['y'] + 110, steps=4)
            page.mouse.up()
            sb = page.locator('.clip-ed-sel').bounding_box()
            check('dragging a selection edge changes it, and it snaps onto the split', sb is not None and abs(sb['x'] - X(2, L3)) < 2 and abs(sb['x'] + sb['width'] - X(5, L3)) < 1.5, str(sb))
            page.keyboard.press(f'{MOD}+b')
            time.sleep(0.2)
            check('Cmd+B splits at the playhead, like S', page.locator('.clip-ed-split').count() == 3)
            page.keyboard.press(f'{MOD}+z')
            time.sleep(0.2)
            # Split and Delete: one job each (Reuben, 2026-11-05: Cut vs Split was confusing)
            page.mouse.click(X(8, L3), wave['y'] + 75)
            check('with nothing selected, Delete is greyed out', not page.get_by_role('button', name=re.compile(r'^Delete( ⌫| Del)?$')).is_enabled())
            page.get_by_role('button', name=re.compile(r'^Split( S)?$')).click()
            time.sleep(0.2)
            check('Split cuts the clip in two at the playhead', page.locator('.clip-ed-split').count() == 3
                  and any(abs(sp['x'] + 4.5 - X(8, L3)) < 3 for sp in [page.locator('.clip-ed-split').nth(i).bounding_box() for i in range(3)]))
            page.keyboard.press(f'{MOD}+z')
            time.sleep(0.2)
            page.keyboard.press('Backspace')
            time.sleep(0.2)
            check('Backspace with nothing selected changes nothing', page.locator('.clip-ed-split').count() == 2)
            # a narrow section's label shrinks: no label ever covers another (Reuben, 2026-11-05)
            page.mouse.click(X(8.0, L3), wave['y'] + 75)
            page.keyboard.press('s')
            page.mouse.click(X(8.6, L3), wave['y'] + 75)
            page.keyboard.press('s')
            time.sleep(0.3)
            boxes = [page.locator(SEC).nth(i).bounding_box() for i in range(page.locator(SEC).count())]
            overlap = any(a['x'] + a['width'] > b['x'] + 0.5 for a, b in zip(boxes, boxes[1:]))
            texts = [page.locator(SEC).nth(i).text_content().strip() for i in range(page.locator(SEC).count())]
            check('a narrow section shows a shorter label and no blocks overlap', not overlap and len(boxes) == 5 and any(t in ('4', '') for t in texts),
                  f'{[(round(b["x"]), round(b["width"])) for b in boxes]} {texts}')
            page.keyboard.press(f'{MOD}+z')
            page.keyboard.press(f'{MOD}+z')
            time.sleep(0.2)
            # Alt/Option-drag: no snapping
            page.keyboard.press('Home')
            for _ in range(2):
                page.keyboard.press('Shift+ArrowRight')
            page.keyboard.press('i')
            page.keyboard.press('Shift+ArrowRight')
            page.keyboard.press('o')
            page.mouse.move(X(3, L3), wave['y'] + 110)
            page.keyboard.down('Alt')
            page.mouse.down()
            page.mouse.move(X(5, L3) - 4, wave['y'] + 110, steps=6)
            page.mouse.up()
            page.keyboard.up('Alt')
            sb = page.locator('.clip-ed-sel').bounding_box()
            check('Alt-drag does not snap onto the split', sb is not None and abs(sb['x'] + sb['width'] - (X(5, L3) - 4)) < 1.5, str(sb))
            page.mouse.click(X(1, L3), wave['y'] + 75)
            # The keys live in the "?" beside the title now (Reuben, 2026-11-06: the
            # line under the buttons "overcrowds it"): hover it, read the tooltip.
            check('no keys line under the buttons', page.locator('.clip-ed-keys').count() == 0)
            page.locator('.clip-ed [data-tip*="mark a stretch"]').hover()
            page.wait_for_timeout(700)
            tip = page.locator('[role=tooltip]')
            keys = tip.inner_text() if tip.count() else ''
            check('the "?" by the title lists the keys, one per line',
                  'mark a stretch' in keys and ('⌘S — save' in keys or 'Ctrl+S — save' in keys) and keys.count('\n') >= 8, keys)
            page.mouse.move(5, 5)

            # pinch / Cmd+scroll over the waveform zooms around the pointer
            page.mouse.move(X(8, L3), wave['y'] + 75)
            page.keyboard.down(MOD)
            page.mouse.wheel(0, -150)
            page.keyboard.up(MOD)
            time.sleep(0.3)
            check('Cmd+scroll over the waveform zooms in', page.locator('.clip-ed-over').count() == 1)
            page.locator('.clip-ed-zoom input').fill('0')
            time.sleep(0.2)
            # a section's six dots: click selects it; drag moves it, a line showing where
            page.mouse.move(X(8, L3), wave['y'] + 75)
            time.sleep(0.2)
            # click on the WORDS of the label, not its dots (Reuben, 2026-11-05)
            lab = page.get_by_role('button', name='Section 2 — drag to move, click to select').bounding_box()
            page.mouse.click(lab['x'] + lab['width'] - 12, lab['y'] + lab['height'] / 2)
            sb = page.locator('.clip-ed-sel').bounding_box()
            check('clicking a section\'s label selects it', sb is not None and abs(sb['x'] - X(5, L3)) < 3 and abs(sb['x'] + sb['width'] - X(11, L3)) < 3, str(sb))
            page.keyboard.press('Backspace')
            time.sleep(0.2)
            check('…and Backspace deletes that section', page.locator(SEC).count() == 2)
            page.keyboard.press(f'{MOD}+z')
            time.sleep(0.2)
            page.mouse.move(X(8, L3), wave['y'] + 75)
            time.sleep(0.2)
            g = page.get_by_role('button', name='Section 3 — drag to move, click to select').bounding_box()
            page.mouse.move(g['x'] + g['width'] / 2, g['y'] + g['height'] / 2)
            page.mouse.down()
            page.mouse.move(X(6, L3), g['y'] + 5, steps=6)
            page.mouse.move(X(0.4, L3), g['y'] + 5, steps=6)
            drop = page.locator('.clip-ed-drop').bounding_box()
            lifted = page.locator('.clip-ed-lifted').count()
            wb = page.locator('.clip-ed-wave').bounding_box()
            page.screenshot(path=str(SHOTS / '6_carry.png'), clip={'x': wb['x'] - 4, 'y': wb['y'] - 4, 'width': wb['width'] + 8, 'height': wb['height'] + 30})
            page.mouse.up()
            time.sleep(0.3)
            check('while carried, a line shows where it lands and the section greys', drop is not None and abs(drop['x'] + 1.5 - X(0, L3)) < 3 and lifted == 1, str(drop))
            summ = page.locator('.clip-ed-sum').text_content()
            first_split = page.locator('.clip-ed-split').first.bounding_box()
            check('a moved section keeps its number (Section 3 first)', page.locator(SEC).first.text_content().strip().startswith('Section 3'), page.locator(SEC).first.text_content())
            check('dropping it at the start moves it there', 'Moved section 3' in summ and abs(first_split['x'] + 4.5 - X(L3 - 11, L3)) < 3, f'{summ}; split at {first_split["x"]:.0f} vs {X(L3 - 11, L3):.0f}')
            page.keyboard.press(f'{MOD}+z')
            time.sleep(0.2)
            check('Undo puts it back', page.locator('.clip-ed-split').count() == 2 and abs(page.locator('.clip-ed-split').first.bounding_box()['x'] + 4.5 - X(5, L3)) < 3)
            page.mouse.click(X(1, L3), wave['y'] + 75)

            # 8. zoom slider, and the strip of the whole clip appears
            page.locator('.clip-ed-zoom input').fill('0.7')
            time.sleep(0.3)
            check('zoom shows the overview strip', page.locator('.clip-ed-over').count() == 1)
            page.screenshot(path=str(SHOTS / '4_zoom_split.png'))
            page.locator('.clip-ed-zoom input').fill('0')
            time.sleep(0.2)

            # 8c. bars don't "dance" while zooming (Reuben, 2026-11-05): zoom in small steps around the
            # playhead and read the height of the bar under one fixed moment each time. Measured on a fixed
            # grid it keeps its height; only a change of grid (once per doubling) may move it.
            # put the playhead on the loudest bar in the middle of the view (Alt: no snapping)
            loud = page.evaluate("""() => { const c = document.querySelector('.clip-ed-wave canvas'); const g = c.getContext('2d');
              const box = c.getBoundingClientRect(); let best = 0, at = 0;
              for (let x = Math.floor(c.width * 0.3); x < c.width * 0.7; x++) { const d = g.getImageData(x, 0, 1, c.height).data; let n = 0;
                for (let i = 3; i < d.length; i += 4) if (d[i] > 128) n++; if (n > best) { best = n; at = x } }
              return box.left + at * box.width / c.width }""")
            page.keyboard.down('Alt')
            page.mouse.click(loud, wave['y'] + 75)
            page.keyboard.up('Alt')
            heights = []
            for z in [0.10 + 0.01 * i for i in range(25)]:
                page.locator('.clip-ed-zoom input').fill(str(round(z, 2)))
                time.sleep(0.05)
                heights.append(page.evaluate("""() => {
                  const c = document.querySelector('.clip-ed-wave canvas'); const g = c.getContext('2d');
                  const head = document.querySelector('.clip-ed-head').getBoundingClientRect(); const box = c.getBoundingClientRect();
                  const x = Math.round((head.left + 1 - box.left) * c.width / box.width); let best = 0;
                  for (let dx = -3; dx <= 3; dx++) { const d = g.getImageData(x + dx, 0, 1, c.height).data; let n = 0;
                    for (let i = 3; i < d.length; i += 4) if (d[i] > 128) n++; best = Math.max(best, n) } return best }"""))
            changes = sum(1 for a, b in zip(heights, heights[1:]) if abs(a - b) > 8)
            check('zooming: the bar under the playhead keeps its height (no dancing)', changes <= 2 and min(heights) > 20, f'{changes} jumps over 24 zoom steps: {heights}')
            page.locator('.clip-ed-zoom input').fill('0')
            time.sleep(0.2)

            # 8b. drag the playhead by its top (Reuben, 2026-11-04); a drag lower down still selects
            wave = page.locator('.clip-ed-in').bounding_box()
            hb = page.locator('.clip-ed-head').bounding_box()
            rb = page.locator('.clip-ed-ruler').bounding_box()
            page.mouse.move(hb['x'] + 1, rb['y'] + rb['height'] / 2)
            page.mouse.down()
            page.mouse.move(wave['x'] + wave['width'] * 0.3, rb['y'] + rb['height'] / 2, steps=5)
            page.mouse.move(wave['x'] + wave['width'] * 0.5, rb['y'] + 30, steps=5)
            page.mouse.up()
            time.sleep(0.2)
            t_now = page.evaluate("() => document.querySelector('.clip-ed-time span').textContent")
            secs = int(t_now.split(':')[0]) * 60 + float(t_now.split(':')[1])
            check('dragging along the ruler moves the playhead (to the middle)', abs(secs - L3 / 2) < 0.4, f'{t_now} vs {L3 / 2:.1f}')
            check('…and selects nothing', page.locator('.clip-ed-sel').count() == 0)
            page.mouse.move(wave['x'] + wave['width'] * 0.6, wave['y'] + 75)
            page.mouse.down()
            page.mouse.move(wave['x'] + wave['width'] * 0.7, wave['y'] + 75, steps=5)
            page.mouse.up()
            check('a drag lower down still selects', page.locator('.clip-ed-sel').count() == 1)
            page.mouse.click(wave['x'] + wave['width'] * 0.05, wave['y'] + 75)

            # 9. play: the playhead moves, Space pauses
            page.keyboard.press(' ')
            time.sleep(1.2)
            t1 = page.evaluate("() => document.querySelector('.clip-ed-time span').textContent")
            page.keyboard.press(' ')
            time.sleep(0.3)
            playing = page.locator('.clip-ed-play[aria-label="Pause"]').count()
            check('Space plays (the time moves) and pauses again', t1 != '0:00.0' and playing == 0, t1)
            # dragging the playhead while it plays: playback holds, the playhead stays under the mouse
            # (not pulled back to the sound), and playing carries on from where it's let go (Reuben, 2026-11-05)
            page.keyboard.press('Home')
            page.keyboard.press(' ')
            time.sleep(0.6)
            rb = page.locator('.clip-ed-ruler').bounding_box()
            ry = rb['y'] + rb['height'] / 2
            page.mouse.move(rb['x'] + rb['width'] * 0.2, ry)
            page.mouse.down()
            page.mouse.move(rb['x'] + rb['width'] * 0.6, ry, steps=10)
            time.sleep(0.5)  # held still: a playing loop would drag the playhead back to the sound here
            hb = page.locator('.clip-ed-head').bounding_box()
            check('while dragging during playback, the playhead stays under the mouse', abs(hb['x'] - (rb['x'] + rb['width'] * 0.6)) < 4, f"{hb['x']:.0f} vs {rb['x'] + rb['width'] * 0.6:.0f}")
            page.mouse.up()
            time.sleep(0.6)
            t_after = page.evaluate("() => { const t = document.querySelector('.clip-ed-time span').textContent.split(':'); return +t[0]*60 + +t[1] }")
            check('…and playing carries on from where it was let go', page.locator('.clip-ed-play[aria-label="Pause"]').count() == 1 and L3 * 0.6 <= t_after <= L3 * 0.6 + 1.2, f'{t_after:.1f} vs {L3 * 0.6:.1f}')
            page.keyboard.press(' ')
            time.sleep(0.2)

            # 10. speed 1.5×, then Save: three voice notes replace the original
            page.locator('.clip-ed-speed input').fill('1.5')
            time.sleep(0.2)
            before = note_text(v)
            page.get_by_role('button', name='Save', exact=True).click()
            page.wait_for_selector('.clip-ed', state='detached', timeout=60000)
            time.sleep(1.5)
            after = note_text(v)
            lines = [l for l in after.splitlines() if l.startswith('<audio')]
            check('Save with 2 splits makes 3 voice notes in its place', len(lines) == 3, '\n'.join(lines))
            check('named Section 1, 2, 3 after the original', all(f'Explain it · Section {k}' in lines[k - 1] for k in (1, 2, 3)) if len(lines) == 3 else False)
            check('on consecutive lines, no blank line between', '</audio>\n<audio' in after and after.count('</audio>\n<audio') == 2)
            check('volume kept, speed back to 1× (saved into the files)', all('data-volume="1.5"' in l and 'data-speed' not in l for l in lines))
            check('text around it untouched', after.startswith('# Photosynthesis\n\nIn my own words.\n\n') and after.endswith('\n\nAfter it.\n'), repr(after[-40:]))
            files = sorted((v / 'Biology').glob('takes section *.m4a'))
            check('three .m4a files beside the note', len(files) == 3, ', '.join(f.name for f in files))
            durs = [duration(f) for f in files]
            check('their lengths add up to the edit at 1.5×', abs(sum(durs) - L3 / 1.5) < 0.6, f'{[round(d, 2) for d in durs]} vs {L3 / 1.5:.2f}')
            ws = json.loads((v / '.mdnotes' / 'workspace.json').read_text())
            check('the original went to the bin', not (v / 'Biology' / 'takes.m4a').exists() and any(t['from'] == 'Biology/takes.m4a' for t in ws['trash']))
            check('the notice offers Put back', page.get_by_role('button', name='Put back').count() == 1,
                  str(page.evaluate("() => document.querySelector('.notice')?.textContent ?? 'no notice'")))
            check('Cmd+Z in the note does not bring back a line with no recording', True)  # the save is out of the note's undo (unit + below)
            page.wait_for_selector('.cm-voice[data-state="ready"]', timeout=20000)
            check('the new voice notes play (ready)', page.locator('.cm-voice[data-state="ready"]').count() == 3)
            page.screenshot(path=str(SHOTS / '5_saved.png'))

            # 10b. Put back: the original line and recording return, the takes go to the bin
            page.get_by_role('button', name='Put back').click()
            time.sleep(1.5)
            back = note_text(v)
            check('Put back restores the original line', back == before, repr(back[:200]))
            check('…and its recording', (v / 'Biology' / 'takes.m4a').exists())
            check('…and bins the takes Save made', not any((v / 'Biology').glob('takes section *.m4a')))
            page.wait_for_selector('.cm-voice[data-state="ready"]', timeout=20000)
            # Save again (Keep only take 3, then split it once) for the rest of the run.
            page.locator('.cm-voice-editbtn').first.click()
            page.wait_for_selector('.clip-ed')
            page.wait_for_function("() => !document.querySelector('.clip-ed-loading')", timeout=15000)
            wave = page.locator('.clip-ed-in').bounding_box()
            page.mouse.move(X(6.3, L), wave['y'] + 75)
            page.mouse.down()
            page.mouse.move(X(13.6, L), wave['y'] + 75, steps=6)
            page.mouse.up()
            page.keyboard.press('Delete')
            page.mouse.click(X(3.0, L - 7.3), wave['y'] + 75)
            page.keyboard.press('s')
            page.mouse.click(X(8.0, L - 7.3), wave['y'] + 75)
            page.keyboard.press('s')
            page.get_by_role('button', name='Save', exact=True).click()
            page.wait_for_selector('.clip-ed', state='detached', timeout=60000)
            time.sleep(1.5)
            page.keyboard.press(f'{MOD}+z')  # focus is back in the note
            time.sleep(0.8)
            check('Cmd+Z in the note leaves the saved takes alone', len([l for l in note_text(v).splitlines() if l.startswith('<audio')]) == 3)
            page.wait_for_selector('.cm-voice[data-state="ready"]', timeout=20000)

            # 11. Save as new clip on take 2: the original stays, the edit goes under it
            page.locator('.cm-voice-editbtn').nth(1).click()
            page.wait_for_selector('.clip-ed')
            page.wait_for_function("() => !document.querySelector('.clip-ed-loading')", timeout=15000)
            wave = page.locator('.clip-ed-in').bounding_box()
            page.mouse.move(wave['x'] + wave['width'] * 0.2, wave['y'] + 75)
            page.mouse.down()
            page.mouse.move(wave['x'] + wave['width'] * 0.5, wave['y'] + 75, steps=5)
            page.mouse.up()
            page.keyboard.press('Backspace')
            time.sleep(0.2)
            if sys.platform == 'darwin' and os.environ.get('REAL_KEYS'):
                # Cmd+S is the app menu's: it must save (replace) and the sidebar must stay as it was.
                sidebar_before = page.evaluate("() => !!document.querySelector('aside')?.getBoundingClientRect().width")
                front = subprocess.run(['osascript', '-e', f'tell application "System Events" to set frontmost of (first process whose unix id is {proc.pid}) to true',
                                        '-e', 'delay 0.4', '-e', 'tell application "System Events" to get unix id of first process whose frontmost is true'],
                                       capture_output=True, text=True)
                if front.stdout.strip() == str(proc.pid):
                    subprocess.run(['osascript', '-e', 'tell application "System Events" to keystroke "s" using command down'])
                    page.wait_for_selector('.clip-ed', state='detached', timeout=60000)
                    time.sleep(1.2)
                    sidebar_after = page.evaluate("() => !!document.querySelector('aside')?.getBoundingClientRect().width")
                    lines_s = [l for l in note_text(v).splitlines() if l.startswith('<audio')]
                    check('real Cmd+S saves the clip (replaces it)', len(lines_s) == 3 and 'Section 2 (edited)' not in note_text(v) and 'takes%20section%202.m4a' not in lines_s[1], '\n'.join(lines_s))
                    check('…and the sidebar stays as it was', sidebar_before == sidebar_after)
                    page.keyboard.press(f'{MOD}+z')  # nothing — the save is out of the note's undo
                    page.get_by_role('button', name='Put back').click()
                    time.sleep(1.2)
                    page.wait_for_selector('.cm-voice[data-state="ready"]', timeout=20000)
                    page.locator('.cm-voice-editbtn').nth(1).click()
                    page.wait_for_selector('.clip-ed')
                    page.wait_for_function("() => !document.querySelector('.clip-ed-loading')", timeout=15000)
                    wave = page.locator('.clip-ed-in').bounding_box()
                    page.mouse.move(wave['x'] + wave['width'] * 0.2, wave['y'] + 75)
                    page.mouse.down()
                    page.mouse.move(wave['x'] + wave['width'] * 0.5, wave['y'] + 75, steps=5)
                    page.mouse.up()
                    page.keyboard.press('Backspace')
                else:
                    check('real Cmd+S (could not bring the test window to the front — not run)', True)
            page.get_by_role('button', name='Save as new clip').click()
            page.wait_for_selector('.clip-ed', state='detached', timeout=60000)
            time.sleep(1.2)
            after2 = note_text(v)
            lines2 = [l for l in after2.splitlines() if l.startswith('<audio')]
            check('Save as new clip adds one under the original', len(lines2) == 4 and 'Section 2 (edited)' in lines2[2], '\n'.join(lines2))

            # 11b. Record another take: it goes on the end as a section of its own (Reuben, 2026-11-05)
            page.locator('.cm-voice-editbtn').first.click()
            page.wait_for_selector('.clip-ed')
            page.wait_for_function("() => !document.querySelector('.clip-ed-loading')", timeout=15000)
            before_len = page.evaluate("() => { const t = document.querySelector('.clip-ed-time em').textContent.replace('/','').trim().split(':'); return +t[0]*60 + +t[1] }")
            page.get_by_role('button', name='Record another take').click()
            page.wait_for_selector('.clip-ed-rec.is-on', timeout=5000)
            rec_started = time.time()
            time.sleep(2.0)
            rec_line = page.locator('.clip-ed-sum').text_content()
            # the old bars squeeze smoothly as the take grows — the bar at 1.0 s keeps its height frame to frame
            squeeze = []
            for _ in range(15):
                squeeze.append(page.evaluate("""() => {
                  const c = document.querySelector('.clip-ed-wave canvas'); const g = c.getContext('2d');
                  const em = document.querySelector('.clip-ed-time em').textContent.replace('/', '').trim().split(':');
                  const total = +em[0] * 60 + +em[1]; const x = Math.round(Math.min(1.0, total * 0.3) / total * c.width); let best = 0;
                  for (let dx = -6; dx <= 6; dx++) { const d = g.getImageData(x + dx, 0, 1, c.height).data; let n = 0;
                    for (let i = 3; i < d.length; i += 4) if (d[i] > 128) n++; best = Math.max(best, n) } return best }"""))
                time.sleep(0.08)
            jumps = sum(1 for a, b in zip(squeeze, squeeze[1:]) if abs(a - b) > 8)
            check('recording: the old bars squeeze without dancing', jumps <= 2, f'{jumps} jumps: {squeeze}')
            rb1 = page.locator('.clip-ed-band.is-recording').bounding_box()
            time.sleep(0.6)
            rb2 = page.locator('.clip-ed-band.is-recording').bounding_box()
            check('while recording, the take shows as a growing red block at the end', rb1 is not None and rb2 is not None and rb2['width'] > rb1['width'] + 3, f'{rb1} → {rb2}')
            red = page.evaluate("""() => { const c = document.querySelector('.clip-ed-wave canvas'); const g = c.getContext('2d');
              const d = g.getImageData(Math.floor(c.width * 0.6), 0, Math.floor(c.width * 0.4), c.height).data; let n = 0;
              for (let i = 0; i < d.length; i += 4) if (d[i] > 180 && d[i + 1] < 120 && d[i + 2] < 120 && d[i + 3] > 200) n++; return n }""")
            check('…and its sound arrives as red bars on the waveform', red > 50, f'{red} red pixels')
            page.screenshot(path=str(SHOTS / '7_recording.png'))
            check('recording shows in the bottom line, with the time running', 'Recording a new take' in rec_line and '0:00.0' not in rec_line, rec_line)
            rec_secs = time.time() - rec_started
            page.keyboard.press(' ')
            page.wait_for_selector('.clip-ed-rec:not(.is-on)', timeout=8000)
            time.sleep(0.4)
            after_len = page.evaluate("() => { const t = document.querySelector('.clip-ed-time em').textContent.replace('/','').trim().split(':'); return +t[0]*60 + +t[1] }")
            summ = page.locator('.clip-ed-sum').text_content()
            check('Space stops it and the take goes on the end, as long as it was recorded', abs((after_len - before_len) - rec_secs) < 0.7, f'{before_len} → {after_len}, recorded for {rec_secs:.1f} s')
            check('…as a section of its own', page.locator(SEC).count() == 2 and 'Added the take as section 2' in summ, summ)
            page.keyboard.press(f'{MOD}+z')
            time.sleep(0.2)
            check('Undo takes the take back off', page.locator(SEC).count() == 0)
            page.keyboard.press(f'{MOD}+Shift+z')
            page.get_by_role('button', name='Save', exact=True).click()
            page.wait_for_selector('.clip-ed', state='detached', timeout=60000)
            time.sleep(1.2)
            lines_r = [l for l in note_text(v).splitlines() if l.startswith('<audio')]
            check('Save with the take makes two voice notes, the take second', len(lines_r) == 5 and 'section%201.2.m4a' in lines_r[1], '\n'.join(lines_r))
            check('…named inside the section, not stacked (Section 1.1, 1.2)', 'Explain it · Section 1.1"' in lines_r[0] and 'Explain it · Section 1.2"' in lines_r[1], lines_r[0])
            page.get_by_role('button', name='Put back').click()
            time.sleep(1.2)
            page.wait_for_selector('.cm-voice[data-state="ready"]', timeout=20000)

            # 12. a changed clip asks before closing
            page.locator('.cm-voice-editbtn').first.click()
            page.wait_for_selector('.clip-ed')
            page.wait_for_function("() => !document.querySelector('.clip-ed-loading')", timeout=15000)
            page.locator('.clip-ed-speed input').fill('1.25')
            page.keyboard.press('Escape')
            time.sleep(0.3)
            check('Esc on a changed clip asks first', page.get_by_role('button', name='Discard').count() == 1)
            page.get_by_role('button', name='Discard').click()
            page.wait_for_selector('.clip-ed', state='detached', timeout=3000)
            check('Discard closes and the note is unchanged', note_text(v) == after2)
            check('no errors on the page', not errors, '; '.join(errors))
            b.close()
    finally:
        proc.terminate()
        time.sleep(1.5)
    failed = [r for r in results if not r[1]]
    print(f'\n{len(results) - len(failed)}/{len(results)} passed')
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
