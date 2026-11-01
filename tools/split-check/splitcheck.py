"""Split view, driven for real: a scratch build, real mouse through CDP (genuine HTML5 drags).

Reuben's three Obsidian to-do items, 2026-11-01:
  bug1  closing one note of a split must not pull another tab into it
  bug2  a third note can be dragged in (column edges, the line between, the top bar, the tab strip)
  bug3  rearranging a split: drag a piece of the joined tab onto another piece (anywhere on it), drag a column by
        its top strip, a Move left / Move right arrow in each column's top bar, and Move left / right in the
        right-click menu on a piece of the joined tab (on screen AND for a parked split)

Setup and traps: ../windows-check/README.md (build the scratch app first:
  npx electron-vite build --outDir "$env:TEMP\\notealise-check\\build\\out"  +  the node_modules junction).
Run:  python -X utf8 -I splitcheck.py [bug1|bug2|bug3|frames|all]      Screenshots go to <scratch>/split-shots.

Every scenario starts from a BRAND-NEW practice vault: the app saves which tabs were open inside the vault
(.mdnotes/settings.json), so a reused vault restores the last scenario's split and contaminates the next one."""
import sys, os, json, time, shutil
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "windows-check"))
from h import *
from playwright.sync_api import sync_playwright

J = os.path.join
root = J(SP, "vault-splitchk")
SHOTS = J(SP, "split-shots"); os.makedirs(SHOTS, exist_ok=True)
R = Results()
PORT = 9461

def make_vault():
    shutil.rmtree(root, ignore_errors=True)
    for n in "ABCDE":
        w(J(root, "Work", f"{n}.md"), f"# {n}\n\nnote {n} body text\n")
    os.makedirs(J(root, ".mdnotes"), exist_ok=True)
    json.dump({"spaces": [{"folder": "Work"}], "activeSpaceFolder": "Work"}, open(J(root, ".mdnotes", "settings.json"), "w"))

STATE_JS = """() => {
  const title = k => k.split('/').pop().replace(/\\.md$/, '')
  const panes = [...document.querySelectorAll('section.pane-col')].map(s => s.getAttribute('aria-label'))
  const focus = [...document.querySelectorAll('section.pane-col')].findIndex(s => s.querySelector('[class*="border-t-brand-400"]'))
  const strip = document.querySelector('[role=tablist]')
  const items = []
  for (const ch of strip.children) {
    if (ch.querySelector('[data-group-grip]')) {
      items.push('[' + [...ch.querySelectorAll('[data-tab-key]')].map(e => title(e.getAttribute('data-tab-key'))).join('|') + ']')
    } else {
      const k = ch.getAttribute('data-tab-key')
      if (k) items.push(title(k))
    }
  }
  return { panes, focus, strip: items }
}"""

def state(pg): return pg.evaluate(STATE_JS)
def row(pg, name): return pg.locator('aside .tree-row', has=pg.locator('.tree-title', has_text=name)).first
def open_row(pg, name, ctrl=False):
    row(pg, name).click(modifiers=['Control'] if ctrl else None); time.sleep(0.8)

def build_split(pg, names):
    open_row(pg, names[0])
    for n in names[1:]:
        pg.locator('button[aria-label="Split the screen"]').last.click(); time.sleep(0.8)
        open_row(pg, n)

def moves(pg, src, dst, steps=14):
    x0, y0 = src[0] + 8, src[1] + 6
    pg.mouse.move(*src); time.sleep(0.2)
    pg.mouse.down(); time.sleep(0.25)
    pg.mouse.move(x0, y0, steps=4); time.sleep(0.2)
    for i in range(1, steps + 1):
        pg.mouse.move(x0 + (dst[0] - x0) * i / steps, y0 + (dst[1] - y0) * i / steps); time.sleep(0.03)

def drag(pg, src, dst, hold=0.9):
    """a real mouse drag, with a dwell and a last nudge (a drag whose last dragover reorders can lose its drop)"""
    moves(pg, src, dst); time.sleep(hold)
    pg.mouse.move(dst[0] + 1, dst[1]); time.sleep(0.3)
    pg.mouse.up(); time.sleep(1.0)

def centre(loc):
    b = loc.bounding_box()
    return b['x'] + b['width'] / 2, b['y'] + b['height'] / 2, b

def pane_box(pg, i): return pg.locator('section.pane-col').nth(i).bounding_box()
def seg(pg, title):
    return pg.locator('[role=tablist] [data-tab-key] [role=tab]', has=pg.locator('[data-seg-title]', has_text=title)).first
def lone(pg, title):
    return pg.locator('[role=tablist] > [data-tab-key] > [role=tab]', has=pg.locator('span.truncate', has_text=title)).first
def shot(pg, name, clip=None):
    pg.screenshot(path=J(SHOTS, name + ".png"), clip=clip)
def menu_items(pg): return pg.evaluate("[...document.querySelectorAll('.menu .menu-item')].map(e => e.innerText.trim())")
def pick(pg, label):
    pg.locator('.menu .menu-item', has_text=label).first.click(); time.sleep(0.9)
def move_btns(pg):
    return [[b.get_attribute('aria-label') for b in pg.locator('section.pane-col').nth(i).locator('button[aria-label^="Move"]').all()]
            for i in range(pg.locator('section.pane-col').count())]

def fresh(fn):
    make_vault()
    app = App("splitchk", root, port=PORT, extra=["--mute-audio"]); app.start()
    try:
        with sync_playwright() as p:
            pg = app.connect(p); time.sleep(1.2)
            pg.wait_for_selector('.tree-title')
            fn(pg)
            if app.errors: R.add(f"{fn.__name__}: no page errors", False, str(app.errors[:3]))
    finally:
        app.stop()

# ---------------------------------------------------------------- bug 1: closing
def bug1a(pg):
    build_split(pg, ["A", "B"]); open_row(pg, "C", ctrl=True)
    seg(pg, "B").hover(); time.sleep(0.4)
    pg.locator('button[aria-label="Close B"]').first.click(force=True); time.sleep(1.2)
    s = state(pg); R.add("1a close B with the x on its piece of the joined tab: C stays out", s["panes"] == ["A"] and "C" in s["strip"], str(s))

def bug1b(pg):
    build_split(pg, ["A", "B"]); open_row(pg, "C", ctrl=True)
    pg.locator('section.pane-col').nth(1).hover(); time.sleep(0.3)
    pg.locator('section.pane-col').nth(1).locator('button[aria-label="Close this note"]').click(); time.sleep(1.2)
    s = state(pg); R.add("1b close B with the x in its column: C stays out", s["panes"] == ["A"] and "C" in s["strip"], str(s))

def bug1c(pg):
    build_split(pg, ["A", "B", "C"]); open_row(pg, "D", ctrl=True); open_row(pg, "E", ctrl=True)
    pg.locator('section.pane-col').nth(1).hover(); time.sleep(0.3)
    pg.locator('section.pane-col').nth(1).locator('button[aria-label="Close this note"]').click(); time.sleep(1.2)
    s = state(pg); R.add("1c three columns, close the middle one: D and E stay out", s["panes"] == ["A", "C"] and "D" in s["strip"] and "E" in s["strip"], str(s))

def bug1d(pg):
    build_split(pg, ["A", "B"]); open_row(pg, "C", ctrl=True)
    row(pg, "B").click(button='right'); time.sleep(0.5)
    pg.get_by_text("Move to bin", exact=False).last.click(); time.sleep(1.5)
    s = state(pg); R.add("1d bin B from the sidebar while split: C stays out", s["panes"] == ["A"] and "C" in s["strip"], str(s))

# ---------------------------------------------------------------- bug 2: dragging a third note in
def edge(side):
    def f(pg):
        build_split(pg, ["A", "B"])
        b = pane_box(pg, 1 if side == 'right' else 0)
        sx, sy, _ = centre(row(pg, "C"))
        drag(pg, (sx, sy), (b['x'] + b['width'] * (0.9 if side == 'right' else 0.1), b['y'] + b['height'] * 0.5))
        s = state(pg); want = ["A", "B", "C"] if side == 'right' else ["C", "A", "B"]
        R.add(f"2 third note from the sidebar onto the {side} edge of a column", s["panes"] == want, str(s))
    f.__name__ = f"edge_{side}"; return f

def centre_drop(pg):
    build_split(pg, ["A", "B"]); b = pane_box(pg, 1)
    sx, sy, _ = centre(row(pg, "C")); drag(pg, (sx, sy), (b['x'] + b['width'] * 0.5, b['y'] + b['height'] * 0.5))
    s = state(pg); R.add("2 note onto the MIDDLE of a column replaces that column's note", s["panes"] == ["A", "C"], str(s))

def strip_piece(pg):
    build_split(pg, ["A", "B"]); sx, sy, _ = centre(row(pg, "C")); cx, cy, _ = centre(seg(pg, "B"))
    drag(pg, (sx, sy), (cx, cy)); s = state(pg)
    R.add("2 third note from the sidebar onto a piece of the joined tab", s["panes"] == ["A", "B", "C"], str(s))

def strip_lone(pg):
    build_split(pg, ["A", "B"]); open_row(pg, "D", ctrl=True); sx, sy, _ = centre(row(pg, "C")); cx, cy, _ = centre(lone(pg, "D"))
    drag(pg, (sx, sy), (cx, cy)); s = state(pg)
    R.add("2 note onto the middle of a lone tab gives three columns (the lone tab takes a column)", len(s["panes"]) == 3, str(s))

def strip_empty(pg):
    build_split(pg, ["A", "B"]); sx, sy, _ = centre(row(pg, "C")); tb = pg.locator('[role=tablist]').bounding_box()
    drag(pg, (sx, sy), (tb['x'] + tb['width'] - 60, tb['y'] + tb['height'] / 2)); s = state(pg)
    R.add("2 note onto empty tab-strip space opens it as its own tab", "C" in s["strip"] and s["panes"] == ["A", "B"], str(s))

def divider(pg):
    build_split(pg, ["A", "B"]); b1 = pane_box(pg, 1); sx, sy, _ = centre(row(pg, "C"))
    drag(pg, (sx, sy), (b1['x'], b1['y'] + b1['height'] * 0.5)); s = state(pg)
    R.add("2 note onto the line between two columns", len(s["panes"]) == 3, str(s))

def topbar(zone):
    def f(pg):
        build_split(pg, ["A", "B"]); b1 = pane_box(pg, 1); sx, sy, _ = centre(row(pg, "C"))
        x = {'right': 0.9, 'centre': 0.5}[zone]
        drag(pg, (sx, sy), (b1['x'] + b1['width'] * x, b1['y'] + 40)); s = state(pg)
        want = ["A", "B", "C"] if zone == 'right' else ["A", "C"]
        R.add(f"2 note onto a column's TOP BAR ({zone} part)", s["panes"] == want, str(s))
    f.__name__ = f"topbar_{zone}"; return f

def behind_sidebar(pg):
    build_split(pg, ["A", "B"]); open_row(pg, "C", ctrl=True); b = pane_box(pg, 1); sx, sy, _ = centre(row(pg, "C"))
    drag(pg, (sx, sy), (b['x'] + b['width'] * 0.9, b['y'] + b['height'] * 0.5)); s = state(pg)
    R.add("2 note already open behind the split, dragged from the sidebar to a column's edge", s["panes"] == ["A", "B", "C"], str(s))

def behind_strip(pg):
    build_split(pg, ["A", "B"]); open_row(pg, "C", ctrl=True); b = pane_box(pg, 1); cx, cy, _ = centre(lone(pg, "C"))
    drag(pg, (cx, cy), (b['x'] + b['width'] * 0.9, b['y'] + b['height'] * 0.5)); s = state(pg)
    R.add("2 lone tab dragged from the strip to a column's edge", s["panes"] == ["A", "B", "C"], str(s))

def no_overlay_after(pg):
    """the whole-column drop layer must be gone once the drag ends: a click on the top bar still works"""
    build_split(pg, ["A", "B"]); b1 = pane_box(pg, 1); sx, sy, _ = centre(row(pg, "C"))
    drag(pg, (sx, sy), (b1['x'] + b1['width'] * 0.9, b1['y'] + 40)); time.sleep(0.5)
    covered = pg.evaluate("""() => { const b = document.querySelector('section.pane-col button[aria-label="Close this note"]'); if (!b) return 'no button'
        const r = b.getBoundingClientRect(); const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
        return b.contains(hit) ? 'ok' : 'covered by ' + (hit && hit.className) }""")
    R.add("2 after the drop, nothing covers the top-bar buttons (the drop layer is gone)", covered == 'ok', covered)

# ---------------------------------------------------------------- bug 3: rearranging
def piece_middle(pg):
    build_split(pg, ["A", "B"]); ax, ay, _ = centre(seg(pg, "A")); bx, by, _ = centre(seg(pg, "B"))
    drag(pg, (ax, ay), (bx, by)); s = state(pg)
    R.add("3a piece dropped on the MIDDLE of the other piece: columns swap", s["panes"] == ["B", "A"] and s["strip"] == ["[B|A]"], str(s))

def piece_far_edge(pg):
    build_split(pg, ["A", "B"]); ax, ay, _ = centre(seg(pg, "A")); bx, by, bb = centre(seg(pg, "B"))
    drag(pg, (ax, ay), (bb['x'] + bb['width'] * 0.92, by)); s = state(pg)
    R.add("3b piece dropped on the FAR EDGE of the other piece: columns swap, nobody leaves the split", s["panes"] == ["B", "A"] and s["strip"] == ["[B|A]"], str(s))

def piece_near_edge(pg):
    build_split(pg, ["A", "B"]); ax, ay, ab = centre(seg(pg, "A")); bx, by, bb = centre(seg(pg, "B"))
    drag(pg, (bx, by), (ab['x'] + ab['width'] * 0.08, ay)); s = state(pg)
    R.add("3b' piece dropped on the NEAR EDGE (left part of the first piece): columns swap", s["panes"] == ["B", "A"] and s["strip"] == ["[B|A]"], str(s))

def piece_three(pg):
    build_split(pg, ["A", "B", "C"]); ax, ay, _ = centre(seg(pg, "A")); cx, cy, _ = centre(seg(pg, "C"))
    drag(pg, (ax, ay), (cx, cy)); s = state(pg)
    R.add("3c three columns: first piece dropped on the last takes its place", s["panes"] == ["B", "C", "A"], str(s))

def piece_leaves(pg):
    """the other half of the rule: dropped AWAY from the joined tab, a piece still leaves the split"""
    build_split(pg, ["A", "B"]); ax, ay, _ = centre(seg(pg, "A")); tb = pg.locator('[role=tablist]').bounding_box()
    drag(pg, (ax, ay), (tb['x'] + tb['width'] - 60, tb['y'] + tb['height'] / 2)); s = state(pg)
    R.add("3d piece dropped on empty strip space still takes the note OUT of the split", s["panes"] == ["B"] and "A" in s["strip"], str(s))

def column_grab(pg):
    build_split(pg, ["A", "B"]); b0 = pane_box(pg, 0); b1 = pane_box(pg, 1)
    pg.locator('section.pane-col').nth(0).hover(); time.sleep(0.3)
    drag(pg, (b0['x'] + b0['width'] / 2, b0['y'] + 5), (b1['x'] + b1['width'] * 0.85, b1['y'] + 5), hold=0.5); s = state(pg)
    R.add("3e column dragged by the strip along its top still works", s["panes"] == ["B", "A"], str(s))

def arrows(pg):
    build_split(pg, ["A", "B", "C"]); b = move_btns(pg); print("   arrows per column:", b)
    L, Rt = "Move this column to the left", "Move this column to the right"
    R.add("3f top-bar arrows: first column has only Right, middle both, last only Left",
          b == [[Rt], [L, Rt], [L]], str(b))
    # press Right on the first column: A goes to the middle and stays lit
    pg.locator('section.pane-col').nth(0).locator(f'button[aria-label="{Rt}"]').click(); time.sleep(1.0)
    s = state(pg); R.add("3g press Right on the first column: it moves to the middle and stays the lit column", s["panes"] == ["B", "A", "C"] and s["focus"] == 1, str(s))
    pg.locator('section.pane-col').nth(1).locator(f'button[aria-label="{L}"]').click(); time.sleep(1.0)
    s = state(pg); R.add("3g press Left on it: back to the front, still lit", s["panes"] == ["A", "B", "C"] and s["focus"] == 0, str(s))
    pg.locator('section.pane-col').nth(2).locator(f'button[aria-label="{L}"]').click(); time.sleep(1.0)
    s = state(pg); R.add("3g press Left on the last column: swaps with the middle one", s["panes"] == ["A", "C", "B"] and s["focus"] == 1, str(s))
    two = [len(x) for x in move_btns(pg)]
    R.add("3g strip stays one joined tab and shows the new order", s["strip"] == ["[A|C|B]"], str(s["strip"]))

def arrows_hover(pg):
    """the arrows live at the two ends of the strip along a column's top edge, out of sight until you point at
    that column's top bar (2026-11-01, Reuben: 'only while you hover a column's top bar, so the middle column
    keeps all its buttons')"""
    build_split(pg, ["A", "B", "C"])
    pg.mouse.move(150, 600); time.sleep(0.6)                      # park the pointer over the sidebar
    op = lambda: pg.evaluate("[...document.querySelectorAll('section.pane-col')].map(s => [...s.querySelectorAll(':scope > .pane-arrow')].map(b => getComputedStyle(b).opacity))")
    rest = op()
    R.add("3k arrows are out of sight until you point at a top bar", [len(c) for c in rest] == [1, 2, 1] and all(o == '0' for c in rest for o in c), str(rest))
    pg.locator('section.pane-col').nth(1).locator('button[data-tip^="Bold"]').hover(); time.sleep(0.6)
    hov = op()
    R.add("3k pointing at the middle column's top bar shows ITS two arrows and no others", hov[1] == ['1', '1'] and hov[0] == ['0'] and hov[2] == ['0'], str(hov))
    b = pane_box(pg, 1); pg.mouse.move(b['x'] + b['width'] / 2, b['y'] + 4); time.sleep(0.6)
    strip = op()
    R.add("3k ...and they stay while the pointer is on the strip along its top edge", strip[1] == ['1', '1'], str(strip))
    hits = pg.evaluate("""[...document.querySelectorAll('.pane-arrow')].map(a => { const r = a.getBoundingClientRect()
        const h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return a.contains(h) })""")
    R.add("3k a click on an arrow lands on the arrow, not on the drag strip", len(hits) == 4 and all(hits), str(hits))
    over = pg.evaluate("""[...document.querySelectorAll('.pane-arrow')].map(a => { const r = a.getBoundingClientRect()
        const row = a.parentElement.querySelector(':scope > .pane-row')
        return [...row.querySelectorAll('button')].some(q0 => { const q = q0.getBoundingClientRect()
          return q.width > 0 && r.left < q.right && r.right > q.left && r.top < q.bottom && r.bottom > q.top }) })""")
    R.add("3k no arrow overlaps a button in the top bar", len(over) == 4 and not any(over), str(over))
    fit = pg.evaluate("""[...document.querySelectorAll('section.pane-col')].map(s => { const t = s.querySelector('.toolbar-scroll'); return t ? [t.scrollWidth, t.clientWidth] : null })""")
    R.add("3k every column of three keeps its whole format bar (no sideways scroll, the colour button shows)", all(f and f[0] <= f[1] + 1 for f in fit), str(fit))

def menu_on_screen(pg):
    build_split(pg, ["A", "B", "C"])
    seg(pg, "A").click(button='right'); time.sleep(0.5); first = menu_items(pg); pg.keyboard.press('Escape'); time.sleep(0.3)
    seg(pg, "B").click(button='right'); time.sleep(0.5); mid = menu_items(pg); shot(pg, "menu-middle-piece"); pg.keyboard.press('Escape'); time.sleep(0.3)
    seg(pg, "C").click(button='right'); time.sleep(0.5); last = menu_items(pg); pg.keyboard.press('Escape'); time.sleep(0.3)
    print("   menus:", first, mid, last)
    R.add("3h right-click menu: first piece offers only 'Move A right'", "Move A right" in first and "Move A left" not in first, str(first))
    R.add("3h right-click menu: middle piece offers both", "Move B left" in mid and "Move B right" in mid, str(mid))
    R.add("3h right-click menu: last piece offers only 'Move C left'", "Move C left" in last and "Move C right" not in last, str(last))
    seg(pg, "B").click(button='right'); time.sleep(0.5); pick(pg, "Move B right")
    s = state(pg); R.add("3h 'Move B right' from the menu: columns and joined tab agree", s["panes"] == ["A", "C", "B"] and s["strip"] == ["[A|C|B]"], str(s))
    seg(pg, "B").click(button='right'); time.sleep(0.5); pick(pg, "Move B left")
    s = state(pg); R.add("3h 'Move B left' from the menu", s["panes"] == ["A", "B", "C"], str(s))
    lone_menu = None
    open_row(pg, "D", ctrl=True); lone(pg, "D").click(button='right'); time.sleep(0.5); lone_menu = menu_items(pg); pg.keyboard.press('Escape')
    R.add("3h a lone tab's menu has no move entries", not any(i.startswith("Move ") and ("left" in i or "right" in i) for i in lone_menu), str(lone_menu))

def menu_parked(pg):
    build_split(pg, ["A", "B"]); open_row(pg, "C", ctrl=True)
    lone(pg, "C").click(); time.sleep(1.0)          # go to C: the A|B split is parked as one joined tab
    s0 = state(pg); print("   parked:", s0)
    seg(pg, "B").click(button='right'); time.sleep(0.5); items = menu_items(pg); print("   parked menu:", items)
    pick(pg, "Move B left")
    s = state(pg); R.add("3i a PARKED split: 'Move B left' reorders it without bringing it on screen", s["strip"][0] == "[B|A]" and s["panes"] == ["C"], str(s))
    # Enter on the focused piece, not a click: the one-letter names here make a piece ~27px wide and the hover x
    # (laid over the name by design) covers all of it, so a click would close the note
    seg(pg, "A").focus(); pg.keyboard.press('Enter'); time.sleep(1.0)
    s = state(pg); R.add("3i ...and clicking it back brings the columns up in the new order", s["panes"] == ["B", "A"], str(s))

def piece_parked(pg):
    build_split(pg, ["A", "B"]); open_row(pg, "C", ctrl=True); lone(pg, "C").click(); time.sleep(1.0)
    ax, ay, _ = centre(seg(pg, "A")); bx, by, bb = centre(seg(pg, "B"))
    drag(pg, (ax, ay), (bb['x'] + bb['width'] * 0.92, by)); s = state(pg)
    R.add("3j a PARKED split: a piece dropped on the other piece swaps them too", s["strip"][0] == "[B|A]" and s["panes"] == ["C"], str(s))

def frames(pg):
    """rendered frames for Reuben to look at (layout only: a headless-style capture is fine for this)"""
    build_split(pg, ["A", "B", "C"]); open_row(pg, "D", ctrl=True)
    pg.mouse.move(5, 5); time.sleep(0.3)
    tb = pg.locator('[role=tablist]').bounding_box(); b0 = pane_box(pg, 0); b1 = pane_box(pg, 1)
    shot(pg, "1-three-columns", clip={'x': b0['x'], 'y': tb['y'], 'width': 1084 - b0['x'], 'height': 120})
    pg.locator('section.pane-col').nth(1).locator('button[data-tip^="Bold"]').hover(); time.sleep(0.6)
    shot(pg, "1b-three-columns-pointing-at-the-middle", clip={'x': b0['x'], 'y': tb['y'], 'width': 1084 - b0['x'], 'height': 120})
    from PIL import Image as _I
    _im = _I.open(J(SHOTS, "1b-three-columns-pointing-at-the-middle.png"))
    _mid = pane_box(pg, 1); _ox = _mid['x'] - b0['x']
    _im.crop((int(_ox), 40, int(_ox + _mid['width']), 115)).resize((int(_mid['width']) * 3, 225), _I.NEAREST).save(J(SHOTS, "1c-middle-top-bar-x3.png"))
    pg.mouse.move(5, 5); time.sleep(0.4)
    # mid-drag: a piece of the joined tab hovering over another piece (a NON-lit one, so the outline can be seen)
    from PIL import Image
    ax, ay, _ = centre(seg(pg, "A")); bx, by, bb = centre(seg(pg, "B"))
    outline = "document.querySelectorAll('[role=tablist] span[aria-hidden=true].border-brand-400').length"
    moves(pg, (ax, ay), (bb['x'] + bb['width'] * 0.9, by)); time.sleep(0.5)
    pg.mouse.move(bb['x'] + bb['width'] * 0.9 + 1, by); time.sleep(0.6)   # the nudge: a still pointer may not get its last dragover
    n = pg.evaluate(outline)
    R.add("frames: a piece hovering over another piece of its own joined tab shows the swap outline on it", n == 1, f"{n} outline(s)")
    shot(pg, "2-mid-drag-piece-over-piece", clip={'x': b0['x'], 'y': tb['y'], 'width': 300, 'height': 50})
    im = Image.open(J(SHOTS, "2-mid-drag-piece-over-piece.png")); im.resize((im.width * 3, im.height * 3), Image.NEAREST).save(J(SHOTS, "2-mid-drag-piece-over-piece-x3.png"))
    pg.mouse.move(ax + 2, ay); time.sleep(0.5)                                   # back over its own piece: nothing would happen
    n0 = pg.evaluate(outline)
    R.add("frames: ...and over its own piece it shows nothing", n0 == 0, f"{n0} outline(s)")
    pg.mouse.move(bb['x'] + bb['width'] * 0.9 + 1, by); time.sleep(0.2); pg.mouse.up(); time.sleep(1.0)
    # mid-drag: a note from the sidebar hovering over a column's top bar
    sx, sy, _ = centre(row(pg, "E")); b2 = pane_box(pg, 2)
    moves(pg, (sx, sy), (b2['x'] + b2['width'] * 0.5, b2['y'] + 40)); time.sleep(0.8)
    shot(pg, "3-mid-drag-over-top-bar")
    pg.mouse.move(b2['x'] + b2['width'] * 0.5 + 1, b2['y'] + 40); time.sleep(0.2); pg.mouse.up(); time.sleep(1.0)

PLAN = {
    "bug1": [bug1a, bug1b, bug1c, bug1d],
    "bug2": [edge('right'), edge('left'), centre_drop, strip_piece, strip_lone, strip_empty, divider,
             topbar('right'), topbar('centre'), behind_sidebar, behind_strip, no_overlay_after],
    "bug3": [piece_middle, piece_far_edge, piece_near_edge, piece_three, piece_leaves, column_grab,
             arrows, arrows_hover, menu_on_screen, menu_parked, piece_parked],
    "frames": [frames],
}

if __name__ == "__main__":
    which = sys.argv[1] if len(sys.argv) > 1 else "all"
    every = [f for k, v in PLAN.items() if k != "frames" for f in v]
    todo = every if which == "all" else PLAN.get(which) or [f for f in every if f.__name__ == which]
    for fn in todo:
        print("==", fn.__name__, flush=True)
        try:
            fresh(fn)
        except Exception as e:
            R.add(f"{fn.__name__} crashed", False, repr(e)[:300])
    print("\nSUMMARY")
    for r in R.rows:
        print(f"[{r[1]}] {r[0]} -- {r[2]}")
    sys.exit(1 if any(r[1] == "FAIL" for r in R.rows) else 0)
