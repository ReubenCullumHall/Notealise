import sys
from playwright.sync_api import sync_playwright
url = sys.argv[1]; outdir = sys.argv[2]
with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1200, "height": 900}, record_video_dir=outdir, record_video_size={"width":1200,"height":900})
    page = ctx.new_page()
    page.emulate_media(reduced_motion="no-preference")
    page.goto(url)
    page.wait_for_timeout(5300)
    ctx.close()
    browser.close()
