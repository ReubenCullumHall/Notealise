"""While typing: which parts of the window (outside the note's own text) get rebuilt, and how
often the whole window re-measures itself."""
import sys, time, collections
from playwright.sync_api import sync_playwright
import lab

PORT = int(sys.argv[1]); TITLE = sys.argv[2]
WORK = lab.WORK / 'work'
vault = WORK / 'vault-small'
lab.seed_vault(vault)
ud = WORK / 'ud'
lab.profile(ud, vault)
proc, _ = lab.launch(ud, PORT, WORK / 'app.log')
START = """() => {
  const d = (n) => n.nodeType === 1 ? (n.tagName.toLowerCase() + (n.className && typeof n.className === 'string' ? '.' + n.className.trim().split(/\\s+/).slice(0, 3).join('.') : '')) : '#text';
  window.__mut = [];
  window.__mo = new MutationObserver((recs) => { for (const r of recs) {
    const t = r.target.nodeType === 1 ? r.target : r.target.parentElement;
    if (!t || t.closest('.cm-content')) continue;
    window.__mut.push([r.type, d(t), [...r.addedNodes].map(d).join(',').slice(0, 80), [...r.removedNodes].map(d).join(',').slice(0, 80), r.attributeName || '']);
  } });
  window.__mo.observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true });
  window.__gbcr = 0;
  const orig = Element.prototype.getBoundingClientRect;
  window.__gbcrBy = {};
  Element.prototype.getBoundingClientRect = function () { window.__gbcr++; const k = d(this).slice(0, 60); window.__gbcrBy[k] = (window.__gbcrBy[k] || 0) + 1; return orig.call(this) };
}"""
STOP = "() => { window.__mo.disconnect(); return { mut: window.__mut, gbcr: window.__gbcr, by: window.__gbcrBy } }"
try:
    with sync_playwright() as p:
        b, page = lab.connect(p, PORT)
        page.wait_for_selector('.tree-row', timeout=30000)
        time.sleep(2.5)
        lab.open_note(page, None, TITLE, settle=3)
        page.locator('.cm-line', has_text='The quick brown fox').first.click()
        page.keyboard.press('End')
        time.sleep(1.0)
        page.evaluate(START)
        text = 'some ordinary words typed here now '   # 35 keys, 6 words
        page.keyboard.type(text, delay=60)
        time.sleep(0.3)   # before the autosave's 400 ms
        r = page.evaluate(STOP)
        print(f'=== {TITLE}: {len(text)} keys, {len(text.split())} words ===')
        print(f"size measurements asked of the window: {r['gbcr']} ({r['gbcr']/len(text):.1f} per key)")
        for k, v in sorted(r['by'].items(), key=lambda kv: -kv[1])[:14]:
            print(f'   {v:5d}  {k}')
        c = collections.Counter((m[0], m[1], m[4]) for m in r['mut'])
        print(f"changes to the page outside the note text: {len(r['mut'])}")
        for (typ, target, attr), n in c.most_common(22):
            print(f'   {n:5d}  {typ:13s} {target[:70]} {attr}')
        adds = collections.Counter((m[1], m[2], m[3]) for m in r['mut'] if m[0] == 'childList')
        print('rebuilt pieces (added / removed):')
        for (target, a, rm), n in adds.most_common(14):
            print(f'   {n:5d}  in {target[:50]} | + {a[:60]} | - {rm[:60]}')
        b.close()
finally:
    lab.stop(proc)
