import asyncio, os, sys, threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from functools import partial
from playwright.async_api import async_playwright
class Q(SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
    def end_headers(self): self.send_header("Cache-Control", "no-store"); super().end_headers()
srv = ThreadingHTTPServer(("127.0.0.1", 4414), partial(Q, directory=os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "site")))
threading.Thread(target=srv.serve_forever, daemon=True).start()
BASE = "http://127.0.0.1:4414"
async def main():
    async with async_playwright() as p:
        br = await p.chromium.launch(channel="msedge")
        for delay in [0, 6]:
            ctx = await br.new_context(viewport={"width": 1440, "height": 900})
            pg = await ctx.new_page()
            async def handler(route, request):
                if delay: await asyncio.sleep(delay)
                await route.fulfill(status=200, content_type="application/json", body='{"tag_name":"v1.5.0","assets":[{"name":"Notealise.dmg"},{"name":"Notealise.intel.dmg"}]}')
            await pg.route("https://api.github.com/**", handler)
            await pg.goto(BASE + "/index.html", wait_until="load"); await asyncio.sleep(1.5)
            ms = await pg.evaluate("""() => new Promise(res => { const t0 = performance.now(); const mo = new MutationObserver(() => { if (document.querySelector('dialog[open]')) { mo.disconnect(); res(Math.round(performance.now() - t0)) } }); mo.observe(document.body, {attributes: true, subtree: true, childList: true}); document.getElementById('macBtn').click(); setTimeout(() => res(-1), 12000) })""")
            print(f"GitHub answers after {delay}s: clicking Download for macOS opens the question after {ms} ms (-1 = never within 12 s)")
            await ctx.close()
        await br.close()
asyncio.run(main())
srv.shutdown()
