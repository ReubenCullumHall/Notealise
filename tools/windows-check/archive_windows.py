"""Windows-only archive checks: the REAL Ctrl+Shift+A key, odd file names, a whole space, inside and outside OneDrive."""
import sys, os, json, time, shutil
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from h import *
from swlib import *

J = os.path.join
MENU = "() => [...document.querySelectorAll('.menu-item')].map(e => e.innerText.trim().split(String.fromCharCode(10)).join(' / '))"
ODD = "Reuben's \U0001F4DA notes (v2) \u2013 draft"

def make_vault(root, longname):
    shutil.rmtree(root, ignore_errors=True)
    w(J(root, "Revision", "Index.md"), "# Index\n\nHello.\n")
    w(J(root, "Revision", ODD + ".md"), "# Odd name\n\nApostrophe, emoji, brackets, en dash.\n")
    w(J(root, "Revision", "Physics", "Waves.md"), "# Waves\n\nLight.\n")
    w(J(root, longname, "Deep.md"), "# Deep\n\nLong space name.\n")
    w(J(root, "Other", "Elsewhere.md"), "# Elsewhere\n")
    os.makedirs(J(root, ".mdnotes"), exist_ok=True)
    json.dump({"spaces": [{"folder": "Revision"}, {"folder": longname}, {"folder": "Other"}], "activeSpaceFolder": "Revision"},
              open(J(root, ".mdnotes", "settings.json"), "w"))

def run(label, root, port):
    R = Results()
    longname = "Long space name " + "x" * 90          # ~105 chars: whole path stays under 260
    make_vault(root, longname)
    app = App("arch" + label, root, port=port, extra=["--mute-audio"]); app.start()
    ui = UI(port); k = Keys.__new__(Keys); k.pid = app.proc.pid; k.h = find_hwnd(k.pid)
    ex = os.path.exists
    try:
        ui.pg.wait_for_selector('.tree-title'); time.sleep(1.2)
        # 1 real Ctrl+Shift+A on the open note
        ui.click_row("Index"); time.sleep(0.8)
        ui.pg.locator('.cm-content').first.click(); time.sleep(0.3)
        k.focus(); k.chord(['ctrl', 'shift'], 'a'); time.sleep(1.5)
        R.add(f"{label} real Ctrl+Shift+A archives the open note", ex(J(root, "Archive", "Index.md")) and not ex(J(root, "Revision", "Index.md")))
        tabs = ui.pg.evaluate("() => document.querySelectorAll('[role=tab]').length")
        R.add(f"{label} its tab closed", tabs == 0, f"tabs left: {tabs}")
        ui.pg.get_by_text("Undo", exact=True).first.click(); time.sleep(1.2)
        R.add(f"{label} Undo puts it back", ex(J(root, "Revision", "Index.md")))
        # 2 odd file name: archive via the sidebar right-click, then Put back
        ui.row(ODD).click(button='right'); time.sleep(0.5)
        ui.pg.get_by_text("Move to archive", exact=False).last.click(); time.sleep(1.5)
        R.add(f"{label} odd name archived (spaces, apostrophe, emoji, brackets, dash)", ex(J(root, "Archive", ODD + ".md")))
        ui.pg.locator('aside button[data-tip^="Archive"]').first.click(); time.sleep(1.2)
        ui.row(ODD).click(button='right'); time.sleep(0.5)
        ui.pg.get_by_text("Put back", exact=False).last.click(); time.sleep(0.6)
        items = ui.pg.evaluate(MENU)
        ui.pg.locator('.menu-item').first.click(); time.sleep(1.5)
        R.add(f"{label} odd name Put back", ex(J(root, "Revision", ODD + ".md")), str(items))
        ui.pg.locator('aside button[data-tip="Back to your notes"]').first.click(); time.sleep(1.0)
        # 3 archive a whole space with a ~105 char name
        ui.pg.locator('aside button[data-tip="%s"]' % longname).first.click(button='right'); time.sleep(0.6)
        ui.pg.get_by_text("Archive this space", exact=False).last.click(); time.sleep(2.0)
        deep = J(root, "Archive", longname, "Deep.md")
        R.add(f"{label} long-name space archived", ex(deep) and not os.path.isdir(J(root, longname)), f"path length {len(deep)}")
        ui.pg.locator('aside button[data-tip^="Archive"]').first.click(); time.sleep(1.2)
        ui.row(longname).click(button='right'); time.sleep(0.5)
        ui.pg.get_by_text("Put back", exact=False).last.click(); time.sleep(0.6)
        items = ui.pg.evaluate(MENU)
        ui.pg.get_by_text("As its own space", exact=False).first.click(); time.sleep(2.0)
        R.add(f"{label} long-name space Put back as its own space", ex(J(root, longname, "Deep.md")), str(items)[:120])
        R.add(f"{label} no console errors", not [e for e in ui.errors if 'favicon' not in e], str(ui.errors[:2]))
    finally:
        k.release_all(); ui.close(); app.stop()
    return R

if __name__ == "__main__":
    if sys.argv[1] == "out":
        run("OUT", J(SP, "vault-arch-out"), 9461)
    else:
        od = os.path.join(os.environ.get("OneDrive") or os.path.expanduser("~"), "_notealise-test-vault")   # throwaway, inside OneDrive; deleted afterwards
        try: run("ONEDRIVE", od, 9462)
        finally: shutil.rmtree(od, ignore_errors=True)
