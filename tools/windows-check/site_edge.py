"""The Notealise website in Edge (installed), served from 127.0.0.1 only."""
import sys, os, threading, time, json, re
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from functools import partial
from playwright.sync_api import sync_playwright

SITE = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "site")
PORT = 4412

class Q(SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
    def end_headers(self):
        self.send_header("Cache-Control", "no-store"); super().end_headers()
srv = ThreadingHTTPServer(("127.0.0.1", PORT), partial(Q, directory=SITE))
srv.request_queue_size = 128
threading.Thread(target=srv.serve_forever, daemon=True).start()
BASE = f"http://127.0.0.1:{PORT}"
PAGES = ["index.html", "students.html", "tutorials.html", "tutorials/blocks.html", "tutorials/colours.html", "tutorials/format.html",
         "tutorials/linking.html", "updates.html", "privacy.html", "terms.html", "install/mac.html", "install/windows.html", "install/linux.html"]
rows = []
def add(ok, what, note=""):
    rows.append((ok, what, note)); print(("PASS " if ok else "FAIL ") + what + (f"  [{note}]" if note else ""), flush=True)

with sync_playwright() as p:
    for channel in ["msedge", None]:
        label = channel or "chromium"
        try:
            br = p.chromium.launch(channel=channel) if channel else p.chromium.launch()
        except Exception as e:
            print("cannot launch", label, str(e)[:100]); continue
        add(True, f"[{label}] launched", br.version)
        for scheme in ["light", "dark"]:
            for (w, h, size) in [(1440, 900, "desktop"), (402, 874, "phone")]:
                ctx = br.new_context(viewport={"width": w, "height": h}, color_scheme=scheme, device_scale_factor=1)
                bad, ext, wide = [], set(), []
                for pg_ in PAGES:
                    pg = ctx.new_page(); errs = []
                    pg.on("response", lambda r: bad.append((pg_, r.status, r.url[-60:])) if r.status >= 400 else None)
                    pg.on("request", lambda r: ext.add(r.url.split("/")[2]) if not r.url.startswith(BASE) and not r.url.startswith("data:") and not r.url.startswith("blob:") else None)
                    pg.on("pageerror", lambda e: errs.append(str(e)[:80]))
                    pg.goto(f"{BASE}/{pg_}", wait_until="load"); time.sleep(0.6)
                    sw = pg.evaluate("[document.documentElement.scrollWidth, document.documentElement.clientWidth]")
                    if sw[0] > sw[1]: wide.append((pg_, sw))
                    if errs: add(False, f"[{label} {scheme} {size}] script errors on {pg_}", str(errs[:2]))
                    pg.close()
                add(not bad, f"[{label} {scheme} {size}] no 404s / failed requests on 13 pages", str(bad[:3]))
                add(not ext, f"[{label} {scheme} {size}] nothing requested from an outside host", str(sorted(ext)))
                add(not wide, f"[{label} {scheme} {size}] no sideways scroll on 13 pages", str(wide))
                ctx.close()

        # home page details (desktop, light + dark)
        for scheme in ["light", "dark"]:
            ctx = br.new_context(viewport={"width": 1440, "height": 900}, color_scheme=scheme)
            pg = ctx.new_page(); pg.goto(f"{BASE}/index.html", wait_until="load"); time.sleep(1.5)
            fonts = pg.evaluate("[...document.fonts].filter(f=>f.status==='loaded').map(f=>f.family.replace(/\"/g,''))")
            have = {n: any(n in f for f in fonts) for n in ["Geist", "Geist Mono", "Doto"]}
            add(all(have.values()), f"[{label} {scheme}] home fonts loaded: Geist, Geist Mono, Doto", str(have))
            hl = pg.evaluate("[...document.querySelectorAll('.hl')].map(e=>[e.style.getPropertyValue('--hl-top'), e.style.getPropertyValue('--hl-bottom')])")
            add(bool(hl) and all(a and b for a, b in hl), f"[{label} {scheme}] every .hl has --hl-top/--hl-bottom set", f"{len(hl)} highlights")
            tb = pg.evaluate("(() => { const t = document.querySelector('.topbar, header, nav'); return t ? getComputedStyle(t).backgroundColor : null })()")
            opaque = bool(tb) and (tb.startswith("rgb(") or re.search(r",\s*1\)$", tb) is not None)
            add(opaque, f"[{label} {scheme}] top bar background fully solid (home)", str(tb))
            # download button hover: logos still
            pg.close(); ctx.close()

        ctx = br.new_context(viewport={"width": 1440, "height": 900}, color_scheme="light")
        pg = ctx.new_page(); pg.goto(f"{BASE}/students.html", wait_until="load"); time.sleep(1.5)
        tb = pg.evaluate("(() => { const t = document.querySelector('.topbar, header, nav'); return t ? getComputedStyle(t).backgroundColor : null })()")
        add(bool(tb) and (tb.startswith("rgb(") or re.search(r",\s*1\)$", tb) is not None), f"[{label}] top bar solid (students)", str(tb))
        fonts = pg.evaluate("[...document.fonts].filter(f=>f.status==='loaded').map(f=>f.family.replace(/\"/g,''))")
        have = {n: any(n in f for f in fonts) for n in ["Bricolage Grotesque", "Caveat", "KaTeX_Main"]}
        add(all(have.values()), f"[{label}] students fonts loaded: Bricolage Grotesque, Caveat, KaTeX_Main", str(have))
        tabs = pg.locator("[role=tab], .st-tab, [data-tab]")
        n = tabs.count()
        heights, wraps = [], []
        for i in range(min(n, 4)):
            tabs.nth(i).click(); time.sleep(0.6)
            heights.append(pg.evaluate("Math.round(document.querySelector('#stPaper').getBoundingClientRect().height)"))
        add(n >= 4 and len(set(heights)) == 1, f"[{label}] four tabs; #stPaper the same height in each", f"{n} tabs; heights {heights}")
        lefts = pg.evaluate("[...document.querySelectorAll('.st-tabs button')].map(b => Math.round(b.getBoundingClientRect().left))")
        add(lefts == sorted(lefts) and len(set(lefts)) == 4, f"[{label}] the four tabs sit side by side on one row (the page is tilted a little on purpose, so their tops differ)", str(lefts))
        # section 3 body / section 4 label do not move when all questions open
        pos = lambda: pg.evaluate("(() => { const b = document.querySelector('.st-body'); const s4 = [...document.querySelectorAll('section')].find(s => /04/.test(s.innerText.slice(0, 40))); return [b ? Math.round(b.getBoundingClientRect().left) : null, b ? Math.round(b.getBoundingClientRect().top + scrollY) : null, s4 ? Math.round(s4.getBoundingClientRect().left) : null] })()")
        before = pos()
        qs = pg.locator(".st-q"); m = qs.count()
        for i in range(m): qs.nth(i).evaluate("e => { e.open = true }")
        time.sleep(0.6)
        after = pos()
        add(m >= 4 and before[0] == after[0] and before[2] == after[2], f"[{label}] opening all {m} questions: the words on the left / section 04 don't move sideways", f"{before} -> {after}")
        pg.close(); ctx.close()

        br.close()
srv.shutdown()
print("\nTOTAL", sum(1 for r in rows if r[0]), "pass,", sum(1 for r in rows if not r[0]), "fail")
