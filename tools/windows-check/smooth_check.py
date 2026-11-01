"""Smoothness checks for Settings (2026-11-01) — see README, "Measuring smoothness".

Measures what a person feels, on a COPY of the real vault — an empty vault hides the cost (the first
slider fix measured smooth on one and was still laggy in Reuben's hands).

  python -X utf8 -I smooth_check.py slider [collection|every]   drag Look's Intensity slider fast
  python -X utf8 -I smooth_check.py click                       flick General -> Interface animations 10x
  python -X utf8 -I smooth_check.py colour                      drag the accent colour strip (Look -> Accent colour -> +)

Environment:
  VAULT=<folder>  use this vault instead (it WILL be written to — settings change)
                  default: a copy of the vault named in %APPDATA%\\notes-app\\config.json, deleted after
  BUILD=<dir>     the build to run (default: the harness build). Point it at a build of HEAD for the
                  "before" numbers — README says how to make one.

Prints frames drawn, frames over 25 ms (a stutter you can see), the worst gap, long tasks (over 50 ms,
the window frozen), and for `click` the per-click style/script time from CDP Performance.getMetrics.
"""
import sys, os, json, time, shutil, stat
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import h
from h import App, SP, sync_playwright

if os.environ.get("BUILD"):
    h.BUILD = os.environ["BUILD"]

METER = """() => {
  window.__lt = []; new PerformanceObserver(l => { for (const e of l.getEntries()) window.__lt.push(Math.round(e.duration)) }).observe({ type: 'longtask' })
  window.__fr = []; let last = performance.now(); window.__go = true
  const f = (t) => { window.__fr.push(Math.round(t - last)); last = t; if (window.__go) requestAnimationFrame(f) }
  requestAnimationFrame(f)
}"""


def longp(p):
    """Windows' long-path form: a vault can hold paths past 260 characters, which plain copy/delete refuse."""
    p = os.path.abspath(p)
    return p if p.startswith("\\\\?\\") else "\\\\?\\" + p


def rmtree(p):
    """Delete a vault copy: long paths, and read-only files (some arrive read-only from OneDrive)."""
    def again(func, path, _exc):
        try:
            os.chmod(path, stat.S_IWRITE)
            func(path)
        except OSError:
            pass
    if not os.path.exists(p):
        return
    if sys.version_info >= (3, 12):
        shutil.rmtree(longp(p), onexc=again)
    else:
        shutil.rmtree(longp(p), onerror=again)


def report(pg, label):
    r = pg.evaluate("() => { window.__go = false; return { fr: window.__fr, lt: window.__lt } }")
    fr = r["fr"][2:] or [0]
    slow = [x for x in fr if x > 25]
    print(f"{label} | frames: {len(fr)}  over 25 ms: {len(slow)}  worst: {max(fr)} ms  long tasks: {r['lt']}")


def sweep(pg, box, y_frac=0.5, moves=120):
    """Pointer down at the left, then back and forth across the box at ~60 moves a second."""
    y = box["y"] + box["height"] * y_frac
    pg.mouse.move(box["x"] + 1, y)
    pg.mouse.down()
    for i in range(moves):
        f = (i % 60) / 60 if (i // 60) % 2 == 0 else 1 - (i % 60) / 60
        pg.mouse.move(box["x"] + f * box["width"], y)
        time.sleep(0.016)
    pg.mouse.up()


def open_settings(pg, page=None):
    pg.locator('[aria-label="Settings"], [title^="Settings"]').first.click()
    time.sleep(1.0)
    if page:
        pg.get_by_role("button", name=page, exact=True).first.click()
        time.sleep(0.8)


def slider(pg, where):
    open_settings(pg, "Look")
    if where == "collection":
        pg.get_by_text("Your collection").first.click()
    else:
        pg.get_by_text("Page", exact=True).first.click()
    time.sleep(0.8)
    sl = pg.locator("#page-look-intensity").first
    sl.scroll_into_view_if_needed()
    time.sleep(0.4)
    pg.evaluate(METER)
    sweep(pg, sl.bounding_box())
    time.sleep(1.0)
    report(pg, f"slider ({where})")
    print("  label after letting go:", pg.locator("label[for=page-look-intensity]").first.text_content())


def click(pg):
    open_settings(pg)
    pg.evaluate(METER)
    cdp = pg.context.new_cdp_session(pg)
    cdp.send("Performance.enable")
    m0 = {m["name"]: m["value"] for m in cdp.send("Performance.getMetrics")["metrics"]}
    row = pg.get_by_text("Interface animations").first
    n = 10
    for _ in range(n):
        row.click()
        time.sleep(0.5)
    m1 = {m["name"]: m["value"] for m in cdp.send("Performance.getMetrics")["metrics"]}
    per = {k: round((m1[k] - m0[k]) * 1000 / n, 1) for k in ["RecalcStyleDuration", "ScriptDuration", "TaskDuration"]}
    report(pg, "click x10")
    print("  per click (ms):", per)


def colour(pg):
    open_settings(pg, "Look")
    any_ = pg.locator('[aria-label="Any colour"]').first
    any_.scroll_into_view_if_needed()
    # A strong colour first: the accent's shades come from the HUE alone, so a near-grey accent (or a
    # drag in the square) changes nothing on screen. The second dot is a palette colour.
    dots = any_.locator("xpath=..").locator("button")
    dots.nth(1).click()
    time.sleep(0.8)
    if any_.get_attribute("aria-expanded") != "true":
        any_.click()
        time.sleep(0.6)
    # The Look page has more than one colour square (the folder-colour picker comes first) — use the
    # one in the accent's own panel.
    panel = any_.locator("xpath=ancestor::div[2]")
    strip = panel.locator(".color-hue").first
    strip.scroll_into_view_if_needed()
    time.sleep(0.3)
    pg.evaluate("""() => { window.__acc = new Map(); new MutationObserver(() => {
      const v = document.documentElement.style.getPropertyValue('--accent-500')
      if (!window.__acc.has(v)) window.__acc.set(v, 0)
      window.__accLast = [v, performance.now()]
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['style'] }) }""")
    pg.evaluate(METER)
    sweep(pg, strip.bounding_box())
    let_go = pg.evaluate("() => performance.now()")
    time.sleep(2.0)
    report(pg, "accent colour strip")
    shades, last = pg.evaluate("() => [window.__acc.size, window.__accLast ? window.__accLast[1] : 0]")
    print("  different accent shades drawn during the drag:", shades,
          "(under ~10 means the drag didn't recolour the app — the test, not the app)")
    print("  the app was still recolouring", max(0, round(last - let_go)), "ms after letting go (catching up)")


def main():
    what = sys.argv[1] if len(sys.argv) > 1 else "slider"
    vault = os.environ.get("VAULT")
    copied = None
    if not vault:
        cfg = json.load(open(os.path.join(os.environ["APPDATA"], "notes-app", "config.json"), encoding="utf-8"))
        copied = os.path.join(SP, "smooth-vault")
        rmtree(copied)
        shutil.copytree(longp(cfg["vaultPath"]), longp(copied))
        vault = copied
    app = App("smooth", vault, 9435).start()
    try:
        with sync_playwright() as pw:
            pg = app.connect(pw)
            time.sleep(3)
            if what == "slider":
                slider(pg, sys.argv[2] if len(sys.argv) > 2 else "collection")
            elif what == "click":
                click(pg)
            elif what == "colour":
                colour(pg)
            else:
                sys.exit(f"unknown check: {what}")
            if app.errors:
                print("  errors:", app.errors[:3])
    finally:
        app.stop()
        if copied:
            rmtree(copied)


if __name__ == "__main__":
    main()
