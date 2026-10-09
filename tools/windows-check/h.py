"""Windows pass harness — see README.md. Launches a scratch build of the app on its own profile + debug port."""
import os, sys, json, time, shutil, subprocess, socket
from playwright.sync_api import sync_playwright

# Scratch space for builds, profiles and vaults (never inside the repo or OneDrive).
SP = os.environ.get("NOTEALISE_SCRATCH") or os.path.join(os.environ.get("TEMP", "."), "notealise-check")
os.makedirs(SP, exist_ok=True)
BUILD = SP + r"\build"
REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # notes-app/
ELECTRON = os.path.join(REPO, "node_modules", "electron", "dist", "electron.exe")

def kill_port(port):
    out = subprocess.run(["powershell", "-NoProfile", "-Command",
        f"Get-NetTCPConnection -LocalPort {port} -ErrorAction SilentlyContinue | Select -Expand OwningProcess -Unique"],
        capture_output=True, text=True).stdout.split()
    for pid in out:
        subprocess.run(["taskkill", "/PID", pid, "/T", "/F"], capture_output=True)

class App:
    def __init__(self, name, vault, port=9411, scale=None, extra=None, scheme='light', config=None):
        self.name, self.vault, self.port = name, vault, port
        self.ud = os.path.join(SP, "ud-" + name)
        self.scale, self.extra, self.scheme = scale, extra or [], scheme
        self.config = config or {}
        self.proc = None

    def start(self, fresh=True):
        kill_port(self.port)
        if fresh and os.path.isdir(self.ud):
            shutil.rmtree(self.ud, ignore_errors=True)
        os.makedirs(self.ud, exist_ok=True)
        cfg = {"vaultPath": self.vault, "hasOnboarded": True}
        cfg.update(self.config)
        p = os.path.join(self.ud, "config.json")
        if fresh or not os.path.exists(p):
            json.dump(cfg, open(p, "w"))
        env = dict(os.environ); env.pop("ELECTRON_RUN_AS_NODE", None)
        args = [ELECTRON, BUILD + r"\out\main\index.js", f"--user-data-dir={self.ud}",
                f"--remote-debugging-port={self.port}"]
        if self.scale: args.append(f"--force-device-scale-factor={self.scale}")
        args += self.extra
        self.log = open(os.path.join(SP, f"log-{self.name}.txt"), "w")
        self.proc = subprocess.Popen(args, env=env, stdout=self.log, stderr=self.log)
        for _ in range(60):
            try:
                socket.create_connection(("127.0.0.1", self.port), 0.3).close(); break
            except OSError: time.sleep(0.5)
        time.sleep(2.5)
        return self

    def connect(self, pw):
        self.browser = pw.chromium.connect_over_cdp(f"http://127.0.0.1:{self.port}")
        ctx = self.browser.contexts[0]
        for _ in range(40):
            if ctx.pages: break
            time.sleep(0.25)
        self.page = ctx.pages[0]
        self.page.emulate_media(color_scheme=self.scheme, reduced_motion='no-preference')
        time.sleep(0.8)
        self.errors = []
        self.page.on("pageerror", lambda e: self.errors.append(str(e)))
        self.page.on("console", lambda m: self.errors.append("console:"+m.text) if m.type == "error" else None)
        return self.page

    def stop(self):
        try:
            self.browser.close()
        except Exception: pass
        if self.proc:
            subprocess.run(["taskkill", "/PID", str(self.proc.pid), "/T", "/F"], capture_output=True)
        kill_port(self.port)

def w(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    open(path, "w", encoding="utf-8", newline="\n").write(text)

class Results:
    def __init__(self): self.rows = []
    def add(self, id_, ok, note=""):
        self.rows.append((id_, "PASS" if ok is True else ("FAIL" if ok is False else str(ok)), note))
        print(f"[{self.rows[-1][1]}] {id_} {note}", flush=True)
