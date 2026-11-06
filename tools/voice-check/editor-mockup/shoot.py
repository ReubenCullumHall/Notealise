# Mockup of the voice note editor (2026-11-04). WORK=<build.sh dir> python3 shoot.py; needs WORK/takes.m4a (say + afconvert) and WORK/wave.json (peaks + pauses) — see docs/plans/voice-editor.md.
import json, os, shutil, subprocess, sys, time
from pathlib import Path
from playwright.sync_api import sync_playwright
W = Path(os.environ['WORK']); OUT = W / ('shots' + os.environ.get('THEME', '')); PORT = 9461
ELECTRON = Path.home() / 'notes-app-mac/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'
v = W / 'vault2'
if v.exists(): shutil.rmtree(v)
(v / 'Biology').mkdir(parents=True); (v / '.mdnotes').mkdir()
shutil.copy(W / 'takes.m4a', v / 'Biology' / 'takes.m4a')
(v / 'Biology' / 'Photosynthesis.md').write_text('\n'.join([
  '# Photosynthesis', '', 'Explaining it out loud, in my own words, before the test on Friday.', '',
  '<audio controls src="takes.m4a" data-name="Photosynthesis — explain it"></audio>', '',
  '## Key words', '', '- **Chlorophyll** — the green pigment that absorbs light', '- **Glucose** — the sugar the plant makes',
  '- **Stomata** — the pores the gases pass through', '', '## Equation', '', 'carbon dioxide + water → glucose + oxygen', '']) + '\n')
(v / '.mdnotes' / 'settings.json').write_text(json.dumps({'spaces': [{'folder': 'Biology', **({'theme': os.environ['THEME']} if os.environ.get('THEME') else {})}], 'activeSpaceFolder': 'Biology'}))
ud = W / 'ud2'
if ud.exists(): shutil.rmtree(ud)
ud.mkdir(); (ud / 'config.json').write_text(json.dumps({'vaultPath': str(v), 'hasOnboarded': True}))
env = {k: x for k, x in os.environ.items() if k != 'ELECTRON_RUN_AS_NODE'}
proc = subprocess.Popen([str(ELECTRON), str(W / 'out/main/index.js'), f'--user-data-dir={ud}', f'--remote-debugging-port={PORT}', '--mute-audio'], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
wave = (W / 'wave.json').read_text(); js = (W / 'panel.js').read_text()
try:
  with sync_playwright() as p:
    for _ in range(60):
      try:
        b = p.chromium.connect_over_cdp(f'http://127.0.0.1:{PORT}')
        page = next(pg for c in b.contexts for pg in c.pages if pg.url.startswith('file:')); break
      except Exception: time.sleep(0.5)
    page.emulate_media(color_scheme='dark' if os.environ.get('THEME') == 'dark' else 'light', reduced_motion='no-preference')
    cdp = page.context.new_cdp_session(page); cdp.send('Emulation.setDeviceMetricsOverride', {'width': 1280, 'height': 800, 'deviceScaleFactor': 2, 'mobile': False}); time.sleep(1.5)
    print('innerWidth', page.evaluate('innerWidth'))
    page.locator('.tree-title', has_text='Photosynthesis').first.click()
    page.wait_for_selector('.cm-voice[data-state="ready"]', timeout=20000); time.sleep(1)
    page.mouse.click(5, 790)  # nowhere, so nothing is selected/hovered
    box = page.locator('.cm-voice').first.bounding_box()
    clip = {'x': box['x'] - 16, 'y': box['y'] - 14, 'width': box['width'] + 32, 'height': box['height'] + 28}
    page.mouse.move(box['x'] + box['width'] * 0.6, box['y'] + box['height'] / 2); time.sleep(0.4)
    page.screenshot(path=str(OUT / 'a_today.png'), clip=clip)
    page.evaluate('''() => { const m = document.querySelector('.cm-voice-mixbtn'); const e = m.cloneNode(true);
      e.classList.remove('cm-voice-mixbtn'); e.removeAttribute('aria-controls'); e.setAttribute('aria-label','Edit clip'); e.setAttribute('data-tip','Edit clip'); e.id='mock-edit'; m.before(e) }''')
    sc = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4L8.1 15.9M14.5 14.5L20 20M8.1 8.1L12 12"/></svg>'
    page.evaluate('(sc) => { const e = document.getElementById("mock-edit"); const w = document.querySelector(".cm-voice-mixbtn svg").getBoundingClientRect(); e.innerHTML = sc; const s=e.querySelector("svg"); s.style.width=w.width+"px"; s.style.height=w.height+"px" }', sc)
    time.sleep(0.3)
    eb = page.locator('#mock-edit').bounding_box()
    page.mouse.move(eb['x'] + eb['width']/2, eb['y'] + eb['height']/2); time.sleep(0.9)
    page.screenshot(path=str(OUT / 'b_button.png'), clip={**clip, 'y': clip['y'] - 34, 'height': clip['height'] + 80})
    # the real right-click menu, with "Edit clip…" added at the top
    page.mouse.click(box['x'] + box['width'] * 0.25, box['y'] + box['height'] / 2, button='right'); time.sleep(0.6)
    items = page.evaluate('() => [...document.querySelectorAll(".menu .menu-item")].map(e => e.textContent)')
    page.evaluate('''() => { const f = document.querySelector('.menu .menu-item'); const e = f.cloneNode(true);
      [...e.childNodes].forEach(n => { if (n.nodeType === 3) n.textContent = '' }); 
      const lab = [...e.querySelectorAll('*')].find(x => x.children.length === 0 && x.textContent.trim()); if (lab) lab.textContent = 'Edit clip…'; else e.textContent = 'Edit clip…';
      e.querySelectorAll('.menu-hint').forEach(h => h.remove());
      f.parentNode.insertBefore(e, f) }''')
    time.sleep(0.2)
    mb = page.locator('.menu').bounding_box()
    page.screenshot(path=str(OUT / 'c_menu.png'), clip={'x': clip['x'], 'y': clip['y'], 'width': max(clip['width'], mb['x'] + mb['width'] + 16 - clip['x']), 'height': max(clip['height'], mb['y'] + mb['height'] + 16 - clip['y'])})
    page.keyboard.press('Escape'); time.sleep(0.4)
    page.evaluate('() => document.getElementById("mock-edit")?.remove()')
    page.evaluate('w => { window.__wave = JSON.parse(w) }', wave); page.evaluate(js)
    D = json.loads(wave); dur = D['dur']
    states = {
      'd_open': {'trim': [0, dur], 'head': 0},
      'e_select': {'trim': [0, dur], 'head': 6.25, 'sel': [6.25, 10.8], 'playing': False, 'summary': '<b>4.5 s</b> selected (0:06.3 – 0:10.8) · Cut removes it, Keep only this keeps just it'},
      'f_trim_cut': {'keep': [[0.25, 3.8], [10.8, 25.2]], 'head': 6.4, 'undo': True},
      'g_silences': {'keep': [[0, 3.965], [6.085, 10.965], [13.385, 22.515], [24.185, dur]], 'head': 0, 'undo': True,
                     'summary': 'Remove silences shortened <b>3 pauses</b> longer than 1 second, leaving ⅓ s of breath in each · keeps <b>0:19.8</b> of 0:26.0'},
      'h_split': {'trim': [0, dur], 'splits': [5.0, 12.2], 'takes': [[0, 'Take 1'], [5.0, 'Take 2'], [12.2, 'Take 3']], 'head': 12.2, 'undo': True,
                  'summary': 'Saves as <b>3 voice notes</b>, one under the other'},
      'i_zoom': {'trim': [0, dur], 'view': [12.5, 19.0], 'zoom': 62, 'head': 15.2, 'sel': [13.55, 15.0], 'playing': True},
      'j_speed': {'trim': [13.4, 22.5], 'head': 13.4, 'speed': 1.5, 'undo': True},
    }
    for name, s in states.items():
      page.evaluate('s => window.__mock.render(s)', s); time.sleep(0.5)
      if name == 'd_open':
        page.screenshot(path=str(OUT / 'd_open_full.png'))
      wb = page.locator('.ve-win').bounding_box()
      page.screenshot(path=str(OUT / f'{name}.png'), clip={'x': wb['x'] - 1, 'y': wb['y'] - 1, 'width': wb['width'] + 2, 'height': wb['height'] + 2})
    print('innerWidth at end', page.evaluate('innerWidth'))
    print(json.dumps({'menu_items': items, 'win': wb, 'voice': box}))
    b.close()
finally:
  proc.terminate(); time.sleep(1.5)
