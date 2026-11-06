import json, os, shutil, subprocess, sys, time
from pathlib import Path
from playwright.sync_api import sync_playwright
W = Path(os.environ['WORK']); PORT = int(os.environ['PORT'])
ELECTRON = Path.home() / 'notes-app-mac/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'
v = W / 'lag-vault'
if v.exists(): shutil.rmtree(v)
(v / 'B').mkdir(parents=True); (v / '.mdnotes').mkdir()
shutil.copy(W / 'long.m4a', v / 'B' / 'long.m4a')
(v / 'B' / 'Long.md').write_text('# Long\n\n<audio controls src="long.m4a"></audio>\n')
(v / '.mdnotes' / 'settings.json').write_text(json.dumps({'spaces': [{'folder': 'B'}], 'activeSpaceFolder': 'B'}))
ud = W / 'lag-ud'
if ud.exists(): shutil.rmtree(ud)
ud.mkdir(); (ud / 'config.json').write_text(json.dumps({'vaultPath': str(v), 'hasOnboarded': True}))
env = {k: x for k, x in os.environ.items() if k != 'ELECTRON_RUN_AS_NODE'}
proc = subprocess.Popen([str(ELECTRON), str(W / os.environ.get('OUT', 'out') / 'main/index.js'), f'--user-data-dir={ud}', f'--remote-debugging-port={PORT}', '--mute-audio'], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
try:
  with sync_playwright() as p:
    for _ in range(60):
      try:
        b = p.chromium.connect_over_cdp(f'http://127.0.0.1:{PORT}'); page = next(pg for c in b.contexts for pg in c.pages if pg.url.startswith('file:')); break
      except Exception: time.sleep(0.5)
    time.sleep(1.5)
    page.locator('.tree-title', has_text='Long').first.click()
    page.wait_for_selector('.cm-voice[data-state="ready"]', timeout=20000); time.sleep(0.5)
    page.locator('.cm-voice-editbtn').click()
    page.wait_for_function("() => document.querySelector('.clip-ed') && !document.querySelector('.clip-ed-loading')", timeout=30000); time.sleep(0.8)
    page.evaluate("""() => { window.__ev = []; window.__lt = []; window.__raf = [];
      new PerformanceObserver(l => l.getEntries().forEach(e => window.__ev.push([e.name, Math.round(e.duration), Math.round(e.processingEnd - e.processingStart)]))).observe({type: 'event', buffered: false, durationThreshold: 16});
      new PerformanceObserver(l => l.getEntries().forEach(e => window.__lt.push(Math.round(e.duration)))).observe({type: 'longtask'});
      let last = performance.now(); const f = (t) => { window.__raf.push(Math.round(t - last)); last = t; if (window.__raf.length < 2000) requestAnimationFrame(f) }; requestAnimationFrame(f) }""")
    if os.environ.get('XCSS'):
      page.add_style_tag(content=os.environ['XCSS'])
    if os.environ.get('NOSHADOW'):
      page.add_style_tag(content='.clip-ed{box-shadow:none!important}')
    if os.environ.get('NOPLAYED'):
      page.add_style_tag(content='.clip-ed-played{display:none!important}')
    if os.environ.get('NOHEAD'):
      page.add_style_tag(content='.clip-ed-head{display:none!important}')
    if os.environ.get('NOBLUR'):
      page.add_style_tag(content='.genie-backdrop{-webkit-backdrop-filter:none!important;backdrop-filter:none!important}')
    if os.environ.get('PLAY_FIRST'):
      page.keyboard.press(' '); time.sleep(1.0)
      if os.environ.get('PLAY_FIRST') == 'pause': page.keyboard.press(' '); time.sleep(0.3)
    if os.environ.get('BENCH'):
      res = []
      for rep in range(3):
        page.evaluate("() => { window.__raf.length = 0 }")
        bb = page.locator('.clip-ed-ruler').bounding_box(); y = bb['y'] + bb['height'] / 2
        page.mouse.move(bb['x'] + 20, y); page.mouse.down()
        for i in range(300): page.mouse.move(bb['x'] + 20 + (bb['width'] - 40) * ((i % 150) / 149 if (i // 150) % 2 == 0 else 1 - (i % 150) / 149), y)
        page.mouse.up()
        raf = page.evaluate("() => window.__raf.slice(1)")
        res.append(round(100 * sum(1 for f in raf if f > 20) / max(1, len(raf)), 1))
      print('dropped-frame %, 3 runs:', res)
      b.close(); raise SystemExit
    if os.environ.get('CONTROL'):
      page.keyboard.press('Escape'); time.sleep(1.0)
      page.evaluate("() => { window.__raf.length = 0 }")
      bb = page.locator('.cm-content').bounding_box(); y = bb['y'] + 20
      page.mouse.move(bb['x'] + 5, y); page.mouse.down()
      for i in range(300): page.mouse.move(bb['x'] + 5 + 400 * ((i % 150) / 149), y + (i % 3))
      page.mouse.up()
      raf = sorted(page.evaluate("() => window.__raf.slice()")[1:])
      print('control dropped-frame %:', round(100 * sum(1 for f in raf if f > 20) / max(1, len(raf)), 1))
      b.close(); raise SystemExit
    if os.environ.get('IDLE'):
      for label in ['editor open, idle', 'editor closed, idle']:
        if label.startswith('editor closed'):
          page.keyboard.press('Escape'); time.sleep(1.0)
        page.evaluate("() => { window.__raf.length = 0 }"); time.sleep(2.5)
        raf = sorted(page.evaluate("() => window.__raf.slice()")[1:])
        print(label, 'raf p50/p90/max:', raf[len(raf)//2], raf[int(len(raf)*0.9)], raf[-1], 'frames', len(raf))
      b.close(); raise SystemExit
    for label, sel in [('ruler', '.clip-ed-ruler'), ('waveform-select', '.clip-ed-in')]:
      page.evaluate("() => { window.__ev.length = 0; window.__lt.length = 0; window.__raf.length = 0 }")
      bb = page.locator(sel).bounding_box(); y = bb['y'] + bb['height'] / 2
      page.mouse.move(bb['x'] + 20, y); page.mouse.down()
      t0 = time.time()
      for i in range(120):
        page.mouse.move(bb['x'] + 20 + (bb['width'] - 40) * (i / 119), y)
      page.mouse.up(); dt = time.time() - t0
      r = page.evaluate("() => ({ev: window.__ev.slice(), lt: window.__lt.slice(), raf: window.__raf.slice()})")
      raf = sorted(r['raf'][1:]); 
      print(label, f'moves took {dt:.2f}s', 'slow events(>16ms):', len(r['ev']), r['ev'][:8], 'longtasks:', r['lt'][:10], 'raf p50/p90/max:', raf[len(raf)//2] if raf else None, raf[int(len(raf)*0.9)] if raf else None, raf[-1] if raf else None)
    if os.environ.get('TRACE'):
      b.start_tracing(page=page, categories=['devtools.timeline', 'disabled-by-default-devtools.timeline', 'disabled-by-default-devtools.timeline.invalidationTracking', 'blink', 'cc'])
      if os.environ.get('TRACE_CONTROL'):
        page.keyboard.press('Escape'); time.sleep(0.8)
        bb = page.locator('.cm-content').bounding_box(); y = bb['y'] + 20
        page.mouse.move(bb['x'] + 5, y); page.mouse.down()
        for i in range(80): page.mouse.move(bb['x'] + 5 + 400 * (i / 79), y)
        page.mouse.up()
      else:
        bb = page.locator('.clip-ed-ruler').bounding_box(); y = bb['y'] + bb['height'] / 2
        page.mouse.move(bb['x'] + 20, y); page.mouse.down()
        for i in range(80): page.mouse.move(bb['x'] + 20 + (bb['width'] - 40) * (i / 79), y)
        page.mouse.up()
      raw = b.stop_tracing()
      data = json.loads(raw)
      events = data['traceEvents'] if isinstance(data, dict) else data
      print('events', len(events))
      tot = {}
      for e in events:
        if e.get('ph') == 'X' and 'dur' in e:
          tot[e['name']] = tot.get(e['name'], 0) + e['dur']
      for k in ['Layout', 'UpdateLayoutTree', 'PrePaint', 'Paint', 'Layerize', 'Commit', 'RasterTask', 'EventDispatch', 'FunctionCall', 'HitTest', 'ScrollbarAnimation', 'UpdateLayer', 'CompositeLayers', 'LocalFrameView::RunPaintLifecyclePhase', 'LocalFrameView::RunStyleAndLayoutLifecyclePhases', 'ProxyMain::BeginMainFrame', 'RendererRasterWorker', 'DisplayScheduler::DrawAndSwap']: print(f'{tot.get(k,0)/1000:9.1f} ms  {k}')
      cnt = {}
      for e in events:
        if e.get('name') in ('Layout', 'Paint', 'UpdateLayoutTree') and e.get('ph') == 'X': cnt[e['name']] = cnt.get(e['name'], 0) + 1
      print('counts', cnt)
      inv = {}
      for e in events:
        if e.get('name') in ('PaintInvalidationTracking', 'LayoutInvalidationTracking', 'StyleRecalcInvalidationTracking', 'StyleInvalidatorInvalidationTracking', 'ScheduleStyleInvalidationTracking'):
          d = e.get('args', {}).get('data', {})
          key = (e['name'].replace('InvalidationTracking',''), str(d.get('nodeName', ''))[:60], str(d.get('reason', ''))[:40])
          inv[key] = inv.get(key, 0) + 1
      for k, n in sorted(inv.items(), key=lambda x: -x[1])[:18]: print(n, k)
      b.close(); raise SystemExit
    # one move, profiled
    cdp = page.context.new_cdp_session(page)
    cdp.send('Profiler.enable'); cdp.send('Profiler.setSamplingInterval', {'interval': 200}); cdp.send('Profiler.start')
    bb = page.locator('.clip-ed-ruler').bounding_box(); y = bb['y'] + bb['height'] / 2
    page.mouse.move(bb['x'] + 20, y); page.mouse.down()
    for i in range(80): page.mouse.move(bb['x'] + 20 + (bb['width'] - 40) * (i / 79), y)
    page.mouse.up()
    prof = cdp.send('Profiler.stop')['profile']
    nodes = {n['id']: n for n in prof['nodes']}; self_t = {}
    dts = prof['timeDeltas']
    for s_, d in zip(prof['samples'], dts):
      n = nodes[s_]; key = f"{n['callFrame']['functionName'] or '(anon)'} {n['callFrame']['url'].split('/')[-1]}:{n['callFrame']['lineNumber']}"
      self_t[key] = self_t.get(key, 0) + d
    top = sorted(self_t.items(), key=lambda x: -x[1])[:14]
    for k, us in top: print(f'{us/1000:8.1f} ms  {k}')
    b.close()
finally:
  proc.terminate(); time.sleep(1)
