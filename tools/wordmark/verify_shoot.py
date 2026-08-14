import sys
from playwright.sync_api import sync_playwright

url = sys.argv[1]
outdir = sys.argv[2]
times_ms = [int(x) for x in sys.argv[3].split(",")]

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 1200, "height": 900}, device_scale_factor=2)
    page.emulate_media(reduced_motion="no-preference")
    page.goto(url)
    # Pause every animation so we can seek deterministically, independent of real wall-clock overhead.
    page.evaluate("document.getAnimations().forEach(a => a.pause())")
    for t in times_ms:
        page.evaluate("(t) => document.getAnimations().forEach(a => { a.currentTime = t; })", t)
        page.locator(".hero").screenshot(path=f"{outdir}/t{t:04d}.png")
    browser.close()
