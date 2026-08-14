import sys
from playwright.sync_api import sync_playwright
url = sys.argv[1]; outdir = sys.argv[2]
with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_page(viewport={"width": 1200, "height": 900}, device_scale_factor=2)
    page.emulate_media(reduced_motion="no-preference")
    page.goto(url)
    # Hide the caret so anything left on screen is genuinely glyph ink, not the caret bar.
    page.add_style_tag(content=".wm-caret{display:none !important}")
    page.evaluate("document.getAnimations().forEach(a => a.pause())")
    for t in [560, 650, 750, 795]:
        page.evaluate("(t)=>document.getAnimations().forEach(a=>{a.currentTime=t})", t)
        page.locator(".wm-note-wrap").screenshot(path=f"{outdir}/nocaret_{t}.png")
    # also the true "No" reference: clip exactly at the 'o' with no t in the DOM at all
    page.evaluate("""()=>{
      const s=document.querySelector('.wm-note');
      s.setAttribute('data-orig', s.textContent);
      s.textContent='No';
      s.style.clipPath='none'; s.style.animation='none';
    }""")
    page.locator(".wm-note-wrap").screenshot(path=f"{outdir}/ref_No.png")
    b.close()
