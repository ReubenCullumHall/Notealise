# Windows check harness

What drove the whole 2026-10-09 Windows pass (archive, swipe, tutorials, links/paste/files) without
a human: Python + Playwright over the Chrome debugging port, against a scratch build of the app,
with real OS keys, a real clipboard and real screen grabs where it matters. **Not shipped** and not an
app dependency; needs Python 3 + `pip install playwright pillow numpy` (Playwright's own browsers are
not used — it attaches to the app's Electron).

## Setup (once per pass)

```powershell
$sp = "$env:TEMP\notealise-check"           # or set NOTEALISE_SCRATCH
cd notes-app
npx electron-vite build --outDir "$sp\build\out"
cmd /c mklink /J "$sp\build\node_modules" "$PWD\node_modules"   # a JUNCTION, not a symlink
```

Rebuild after every code change — the harness runs the scratch build, not the source.

## Pieces

- `h.py` — `App(name, vault, port, scale=None)` starts an app on its own `--user-data-dir` and
  `--remote-debugging-port`, `kill_port`, `w(path, text)` to write fixture files, `Results` for PASS/FAIL lines.
- `startapp.py name vault port [scale|-] [keep]` — start an app and leave it running between scripts.
- `ui.py` — `UI(port)`: space switching, tree rows, context menu helpers, `real_shot()` (a real screen grab of
  the window, menu bar 26 px at 100%), `fringe()` (counts ClearType pixels), `raise_window()`.
- `swlib.py` — `Sw(port)` adds real wheel input (`Input.dispatchMouseEvent` with explicit timestamps),
  `Keys(port)` real OS key chords (guarded: refuses unless the app is in front), `set_clip`/`set_clip_files`,
  `resize_window`.

Run scripts with `python -X utf8 -I script.py` and put
`sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))` first (`-I` drops the script folder from the path).

## Traps (all in `notes-app/CLAUDE.md` → Gotchas, "A whole Windows pass can be run from one reusable harness")

Real keys for menu accelerators; Alt-tap + Down for the File menu; `SetForegroundWindow` is refused unless the
input threads are attached; `page.frames` lags (read `iframe` in the DOM); file drops only land over a `.cm-line`;
resize the 1084×655 window; dwell on a folder row before dropping; clicking a file pill opens Word and leaves `~$`
lock files; never put `\n` inside JS held in a Python string.
