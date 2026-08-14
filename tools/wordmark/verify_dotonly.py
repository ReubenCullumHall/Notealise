import sys, json
from playwright.sync_api import sync_playwright
url=sys.argv[1]
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page(viewport={"width":1200,"height":900})
    pg.emulate_media(reduced_motion="no-preference"); pg.goto(url)
    # hide everything except the pen dot, so any ink we see IS the dot
    pg.add_style_tag(content=".wm-letter{display:none!important}.wm-note-wrap{visibility:hidden}.scroll-cue,img.mark{display:none!important}")
    pg.evaluate("document.getAnimations().forEach(a=>a.pause())")
    out=[]
    for t in range(900, 4500, 60):
        pg.evaluate("(t)=>document.getAnimations().forEach(a=>{a.currentTime=t})", t)
        box=pg.evaluate("""()=>{const c=document.querySelector('.wm-pen-dot');
          const r=c.getBoundingClientRect(); const cs=getComputedStyle(c);
          return {w:r.width,h:r.height,x:Math.round(r.x),y:Math.round(r.y),op:cs.opacity};}""")
        out.append((t,box))
    b.close()
    vis=[(t,b) for t,b in out if float(b["op"])>0.01 and b["w"]>1]
    print("frames sampled:", len(out), " dot visible in:", len(vis))
    print("first visible:", vis[0][0], "ms   last visible:", vis[-1][0], "ms")
    ops=set(round(float(b['op']),2) for t,b in vis)
    print("distinct opacities while visible:", sorted(ops))
    sizes=set(round(b['w']) for t,b in vis)
    print("distinct on-screen dot widths:", sorted(sizes))
    # any gap in visibility inside the window?
    ts=[t for t,_ in vis]
    gaps=[(ts[i],ts[i+1]) for i in range(len(ts)-1) if ts[i+1]-ts[i]>60]
    print("visibility gaps mid-animation:", gaps if gaps else "none")
