import sys,os,math,time; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ui import *
NAMES = ["Ideas","Journal","Revision","Work"]
class Sw(UI):
    def __init__(self, port=9451):
        super().__init__(port)
        self.cdp = self.pg.context.new_cdp_session(self.pg)
        self.t = time.time()
    def cur(self):
        return self.pg.evaluate("[...document.querySelectorAll('aside button[aria-pressed=true]')].map(b=>b.getAttribute('data-tip')).filter(t=>['Ideas','Journal','Revision','Work'].includes(t))[0]")
    def wheel(self, dx, dy, x=700, y=350, mods=0, ts=None, real_sleep=True):
        self.cdp.send('Input.dispatchMouseEvent', {'type':'mouseWheel','x':x,'y':y,'deltaX':dx,'deltaY':dy,'modifiers':mods,'timestamp':ts})
    def flick(self, sign=1, x=700, y=350, mods=0, dxscale=1.0, dyscale=0.1, n=40):
        t0 = self.t = max(self.t, time.time()) + 0.05
        for i in range(n):
            dx = sign*60*min(1,(i+1)/3)*math.exp(-i/12)*dxscale
            dy = (1 if i%2==0 else -1)*abs(dx)*dyscale/ max(dxscale,0.0001) * (dxscale if dxscale>=1 else 1) if dyscale else 0
            self.wheel(dx, dy, x, y, mods, ts=t0 + i*0.016)
            time.sleep(0.016)
        self.t = t0 + n*0.016
        time.sleep(0.9)

# ---- real OS keys, guarded ----
import ctypes, subprocess
U = ctypes.windll.user32
VK = {'n':0x4E,'v':0x56,'c':0x43,'z':0x5A,'escape':0x1B,'h':0x48,'i':0x49,'u':0x55,'x':0x58,'l':0x4C,'enter':0x0D,'end':0x23,'home':0x24,'f':0x46,'return':0x0D,'/':0xBF,'ctrl':0x11,'alt':0x12,'shift':0x10,'left':0x25,'right':0x27,'up':0x26,'down':0x28,'tab':0x09,'a':0x41,'b':0x42,'w':0x57}
EXT = {0x25,0x27,0x26,0x28}
def app_pid(port):
    return int(subprocess.run(["powershell","-NoProfile","-Command",f"(Get-NetTCPConnection -LocalPort {port} -State Listen).OwningProcess"],capture_output=True,text=True).stdout.split()[0])
class Keys:
    def __init__(self, port):
        self.pid = app_pid(port); self.h = find_hwnd(self.pid)
    def fg_ok(self):
        return U.GetForegroundWindow() == self.h
    def focus(self):
        raise_window(self.h); time.sleep(0.4)
    def _ev(self, vk, up):
        U.keybd_event(vk, U.MapVirtualKeyW(vk, 0), (0x0002 if up else 0) | (0x0001 if vk in EXT else 0), 0)
    def release_all(self):
        for k in ('shift','alt','ctrl','left','right'): self._ev(VK[k], True)
    def chord(self, mods, key, hold=0.06):
        if not self.fg_ok():
            self.focus()
        if not self.fg_ok():
            self.release_all(); raise RuntimeError("test app not foreground - key press skipped")
        for m in mods: self._ev(VK[m], False); time.sleep(0.03)
        self._ev(VK[key], False); time.sleep(hold); self._ev(VK[key], True)
        for m in reversed(mods): self._ev(VK[m], True)


def set_clip(text):
    subprocess.run(["powershell","-NoProfile","-Command","Set-Clipboard -Value $env:CLIPTXT"], env={**os.environ,"CLIPTXT":text}, capture_output=True)
def set_clip_files(paths):
    q = ",".join("'"+p+"'" for p in paths)
    subprocess.run(["powershell","-NoProfile","-Command",f"Set-Clipboard -Path {q}"], capture_output=True)

def resize_window(hwnd, w_, h_, x=20, y=10):
    U.SetWindowPos(hwnd, 0, x, y, w_, h_, 0x0004)
