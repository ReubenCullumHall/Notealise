import sys, os, json, time
sys.path.insert(0, os.path.dirname(__file__))
from h import *
from playwright.sync_api import sync_playwright

class UI:
    def __init__(self, port, scheme='light'):
        self.pw = sync_playwright().start()
        self.b = self.pw.chromium.connect_over_cdp(f"http://127.0.0.1:{port}")
        self.pg = self.b.contexts[0].pages[0]
        self.pg.emulate_media(color_scheme=scheme, reduced_motion='no-preference')
        self.errors = []
        self.pg.on("pageerror", lambda e: self.errors.append(str(e)))
        self.pg.on("console", lambda m: self.errors.append("console:"+m.text) if m.type == "error" else None)
        time.sleep(0.6)
    def close(self):
        try: self.b.close()
        except Exception: pass
        self.pw.stop()
    def space(self, name):
        self.dismiss()
        self.pg.locator(f'aside button[data-tip="{name}"]').first.click(); time.sleep(1.0)
    def titles(self):
        return self.pg.evaluate("""() => [...document.querySelectorAll('aside .tree-row')].map(r=>(r.querySelector('.tree-title')||r).innerText.trim().split(String.fromCharCode(10))[0])""")
    def row(self, name):
        return self.pg.locator('aside .tree-row', has=self.pg.locator('.tree-title', has_text=__import__('re').compile('^'+__import__('re').escape(name)+'$'))).first
    def click_row(self, name):
        self.row(name).click(); time.sleep(0.6)
    def menu_items(self):
        return self.pg.evaluate("""() => [...document.querySelectorAll('[role=menu] [role=menuitem], [role=menu] button, .ctx-menu button, .context-menu button')].map(b=>b.innerText.trim())""")
    def ctx(self, name, item):
        self.row(name).click(button='right'); time.sleep(0.5)
        self.pg.get_by_text(item, exact=False).last.click(); time.sleep(0.8)
    def dismiss(self):
        if self.pg.locator('.menu-backdrop').count(): self.pg.mouse.click(900, 450); time.sleep(0.4)
    def shot(self, f): self.pg.screenshot(path=os.path.join(SP, f))
    def text(self): return self.pg.evaluate("document.body.innerText")

# ---- real screen grabs + ClearType counting (Windows) ----
import ctypes, ctypes.wintypes as wt
try: ctypes.windll.shcore.SetProcessDpiAwareness(2)
except Exception: pass
from PIL import ImageGrab
import numpy as np

def find_hwnd(pid_root):
    """top-level visible window whose process is pid_root or a child of it (electron main)"""
    user32 = ctypes.windll.user32
    res = []
    EnumProc = ctypes.WINFUNCTYPE(ctypes.c_bool, wt.HWND, wt.LPARAM)
    def cb(h, l):
        if not user32.IsWindowVisible(h): return True
        pid = wt.DWORD(); user32.GetWindowThreadProcessId(h, ctypes.byref(pid))
        buf = ctypes.create_unicode_buffer(256); user32.GetClassNameW(h, buf, 256)
        if pid.value == pid_root and buf.value.startswith('Chrome_WidgetWin'):
            res.append(h)
        return True
    user32.EnumWindows(EnumProc(cb), 0)
    return res[0] if res else None

def client_origin(hwnd):
    pt = wt.POINT(0, 0); ctypes.windll.user32.ClientToScreen(hwnd, ctypes.byref(pt))
    r = wt.RECT(); ctypes.windll.user32.GetClientRect(hwnd, ctypes.byref(r))
    return pt.x, pt.y, r.right, r.bottom

def raise_window(hwnd):
    u = ctypes.windll.user32; k = ctypes.windll.kernel32
    fg = u.GetForegroundWindow()
    cur = k.GetCurrentThreadId()
    fgt = u.GetWindowThreadProcessId(fg, None) if fg else 0
    tgt = u.GetWindowThreadProcessId(hwnd, None)
    try:
        if fgt and fgt != cur: u.AttachThreadInput(cur, fgt, True)
        if tgt and tgt != cur: u.AttachThreadInput(cur, tgt, True)
        u.ShowWindow(hwnd, 9)
        u.BringWindowToTop(hwnd)
        u.SetForegroundWindow(hwnd)
    finally:
        if fgt and fgt != cur: u.AttachThreadInput(cur, fgt, False)
        if tgt and tgt != cur: u.AttachThreadInput(cur, tgt, False)

def fringe(img, thr=24):
    a = np.asarray(img.convert('RGB')).astype(int)
    d = np.maximum(np.maximum(abs(a[...,0]-a[...,1]), abs(a[...,1]-a[...,2])), abs(a[...,0]-a[...,2]))
    return int((d > thr).sum())

def real_shot(hwnd, rect_css=None, dpr=1.0, menubar=0):
    """grab CLIENT area (or css rect inside the page) from the real screen. menubar = px of menu bar above the page"""
    ox, oy, cw, ch = client_origin(hwnd)
    if rect_css is None:
        box = (ox, oy, ox+cw, oy+ch)
    else:
        x, y, w_, h_ = rect_css
        box = (int(ox + x*dpr), int(oy + menubar + y*dpr), int(ox + (x+w_)*dpr), int(oy + menubar + (y+h_)*dpr))
    return ImageGrab.grab(bbox=box, all_screens=True)
