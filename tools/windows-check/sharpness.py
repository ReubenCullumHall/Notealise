"""Text sharpness (ClearType) and layout at 100 / 125 / 150 % while the voice block, its mixer, the tape card, a dragged
paragraph and each corner style are on screen. Real screen grabs of the real window; fringed-pixel counts."""
import sys, os, json, time, shutil, ctypes
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from h import *
from swlib import *
from playwright.sync_api import sync_playwright

J = os.path.join
M = J(SP, "media")
PARA = "Alpha paragraph with enough words in it to measure the sharpness of ordinary note text on this display, and then some more words to fill the line."
OMEGA = "Omega paragraph sits below the player so the text under it can be measured as well, with a few more words added to the end of it."

def build(name, corners, theme):
    root = J(SP, name); shutil.rmtree(root, ignore_errors=True)
    lines = ["# Sharp", "", PARA, "", "<audio controls src=\"memo.m4a\"></audio>", "", OMEGA, "", PARA.replace("Alpha", "Beta"), ""]
    lines += [f"Filler line {i} of the note." for i in range(30)]
    w(J(root, "Work", "Sharp.md"), "\n".join(lines) + "\n")
    shutil.copy(J(M, "memo.m4a"), J(root, "Work", "memo.m4a"))
    os.makedirs(J(root, ".mdnotes"), exist_ok=True)
    json.dump({"spaces": [{"folder": "Work", "theme": theme, "corners": corners}], "activeSpaceFolder": "Work"}, open(J(root, ".mdnotes", "settings.json"), "w"))
    return root

def region(pg, text_start, scroll=True):
    if scroll:
        pg.evaluate("""(t) => { const l = [...document.querySelectorAll('.cm-line')].find(e => e.textContent.startsWith(t)); if (l) l.scrollIntoView({block: 'center'}) }""", text_start); time.sleep(0.4)
    return pg.evaluate("""(t) => { const l = [...document.querySelectorAll('.cm-line')].find(e => e.textContent.startsWith(t)); if (!l) return null;
      const r = l.getBoundingClientRect(); if (r.top < 0 || r.bottom > innerHeight) return null; return [r.left, r.top, Math.min(r.width, 700), r.height] }""", text_start)

def fr(pg, hwnd, scale, text_start, tag=None, scroll=True):
    raise_window(hwnd); time.sleep(0.5)
    rc = region(pg, text_start, scroll)
    if not rc: return 'offscreen'
    ox, oy, cw, ch = client_origin(hwnd)
    inner = pg.evaluate("[innerWidth, innerHeight]")
    menubar = max(0, ch - round(inner[1] * scale))
    x, y, w_, h_ = rc
    img = real_shot(hwnd, rect_css=(x, y, w_, h_), dpr=scale, menubar=menubar)
    if tag: img.save(J(SP, 'clr_%s.png' % tag))
    return fringe(img)

def run(scale, corners="rounded", theme="light"):
    label = f"{int((scale or 1) * 100)}% {corners} {theme}"
    root = build("vault-clr", corners, theme)
    app = App("clr", root, port=9511, scale=scale, scheme=theme, extra=["--mute-audio"]); app.start()
    out = {}
    with sync_playwright() as p:
        pg = app.connect(p); time.sleep(1.5)
        hwnd = find_hwnd(app.proc.pid); sc = scale or 1
        resize_window(hwnd, 1880, 1030, 5, 0); time.sleep(1.0)
        try:
            pg.locator('aside .tree-row', has=pg.locator('.tree-title', has_text="Sharp")).first.click(); time.sleep(1.5)
            pg.wait_for_selector('.cm-voice[data-state="ready"]', timeout=15000)
            pg.evaluate("document.activeElement.blur()"); raise_window(hwnd); time.sleep(0.7)
            out["rest above"] = fr(pg, hwnd, sc, "Alpha"); out["rest below"] = fr(pg, hwnd, sc, "Omega")
            # mixer open
            pg.locator('.cm-voice-mixer-btn, .cm-voice [aria-label*=ixer], .cm-voice button[data-tip*=ixer]').first.click(); time.sleep(1.0)
            out["mixer open above"] = fr(pg, hwnd, sc, "Alpha"); out["mixer open below"] = fr(pg, hwnd, sc, "Omega", "mixer_below"); pg.screenshot(path=J(SP, "clr_mixer_page.png"))
            raise_window(hwnd); time.sleep(0.4)
            mixer_text = pg.evaluate("""() => { const m = document.querySelector('.cm-voice-mixer'); if (!m) return null; const r = m.getBoundingClientRect(); return [r.left, r.top, r.width, r.height] }""")
            if mixer_text:
                ox, oy, cw, ch = client_origin(hwnd); inner = pg.evaluate("[innerWidth, innerHeight]"); mb = max(0, ch - round(inner[1] * sc))
                out["mixer labels"] = fringe(real_shot(hwnd, rect_css=tuple(mixer_text), dpr=sc, menubar=mb))
            pg.locator('.cm-voice-mixer-btn, .cm-voice [aria-label*=ixer], .cm-voice button[data-tip*=ixer]').first.click(); time.sleep(0.8)
            # tape card
            tape = pg.locator('button[aria-label^="Play this note"]').first
            if tape.count():
                tape.click(); time.sleep(1.0)
                out["tape open above"] = fr(pg, hwnd, sc, "Alpha"); out["tape open below"] = fr(pg, hwnd, sc, "Omega")
                eye = pg.evaluate("""() => { const e = document.elementFromPoint(innerWidth - 24, innerHeight - 24); return e ? e.className.toString().slice(0, 40) : null }""")
                out["bottom-right corner element"] = eye
                pg.keyboard.press('Escape'); time.sleep(0.5)
                out['eye clickable'] = pg.evaluate("() => { const e = document.querySelector('button[aria-label*=eye], button[aria-label*=Eye], button[aria-label*=Markdown]'); if (!e) return null; const r = e.getBoundingClientRect(); const el = document.elementFromPoint(r.left + r.width/2, r.top + r.height/2); return el === e || e.contains(el) }")
            # carry a paragraph
            first = pg.evaluate("""(t) => { const l = [...document.querySelectorAll('.cm-line')].find(e => e.textContent.startsWith(t)); const r = document.createRange(); r.selectNodeContents(l); const q = r.getClientRects()[0]; return {x: q.left, y: q.top + q.height / 2} }""", "Beta")
            pg.mouse.move(first["x"] + 120, first["y"], steps=4); time.sleep(0.5)
            g = pg.locator('.cm-line-grip').first.bounding_box()
            if g:
                pg.mouse.move(g["x"] + g["width"] / 2, g["y"] + g["height"] / 2, steps=3); pg.mouse.down()
                pg.mouse.move(g["x"] + 10, first["y"] + 15, steps=4)
                y = first["y"] + 15
                while y < first["y"] + 200:
                    y += 6; pg.mouse.move(g["x"] + 10, y); time.sleep(0.03)
                time.sleep(0.5)
                out["carry above"] = fr(pg, hwnd, sc, "Alpha", scroll=False); out["carry below"] = fr(pg, hwnd, sc, "Omega", scroll=False)
                out["ghost present"] = pg.locator('.cm-drag-ghost').count()
                pg.keyboard.press('Escape'); pg.mouse.up(); time.sleep(0.8)
                out["after drop above"] = fr(pg, hwnd, sc, "Alpha", "drop_above", scroll=False); pg.screenshot(path=J(SP, "clr_drop_page.png")); out["after drop below"] = fr(pg, hwnd, sc, "Omega", scroll=False)
            # corners of tab / button as read from the page
            out["tab radius"] = pg.evaluate("(() => { const t = document.querySelector('[role=tab]'); return t ? getComputedStyle(t).borderTopLeftRadius : null })()")
            out["errors"] = len(app.errors)
        finally:
            app.stop()
    print(f"RESULT {label}: " + json.dumps(out), flush=True)
    return out

if __name__ == "__main__":
    for arg in sys.argv[1:]:
        scale, corners, theme = arg.split(",")
        run(None if scale == "1" else float(scale), corners, theme)
