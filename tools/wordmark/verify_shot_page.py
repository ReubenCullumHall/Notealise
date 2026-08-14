import sys
from playwright.sync_api import sync_playwright
url=sys.argv[1]; out=sys.argv[2]
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page(viewport={"width":1250,"height":900},device_scale_factor=2)
    pg.goto(url); pg.wait_for_timeout(300)
    pg.screenshot(path=out, full_page=True)
    b.close()
