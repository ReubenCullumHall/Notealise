import sys
from playwright.sync_api import sync_playwright
url = sys.argv[1]; out = sys.argv[2]
with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 1200, "height": 900}, device_scale_factor=2)
    page.emulate_media(reduced_motion="reduce")
    page.goto(url)
    page.locator(".hero").screenshot(path=out)
    browser.close()
