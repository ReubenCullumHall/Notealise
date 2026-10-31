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

## The 2026-10-31 pass — ready-made checks (all run from this folder, each prints PASS/FAIL lines)

Build the scratch app first (Setup above), then `powershell -File make_media.ps1` once (spoken test sounds in several
formats — no microphone needed). Run with `python -X utf8 <script>`.

| Script | What it checks |
|---|---|
| `archive_windows.py out` / `onedrive` | the REAL Ctrl+Shift+A key, an odd note name (apostrophe, emoji, brackets, dash), a space with a ~105-character name, Put back — once outside OneDrive, once inside (it makes and deletes `%OneDrive%\_notealise-test-vault`) |
| `bugscan_editor.py` | naming a new note then typing, Tab/Shift+Tab, Enter on an empty bullet, tables, Find in a shut toggle, Search notes, `C#` links, prices, Find & Replace, `/divider` |
| `bugscan_windows.py` | real keys with Settings open, the minimum window size, a folder renamed while typing, a file held open (Move to bin, quit → "Recovered" note), a cut-off settings file, an apostrophe video |
| `quit_windows.py` | typing saved when the window is closed with the × / File → Exit, a second after the last key |
| `voice_windows.py paste` / `record` / `closemid` / `damaged` | pasting sounds of every kind (wma is converted), a fake-microphone recording, closing mid-recording, a damaged file and a 212-character vault path |
| `site_edge.py`, `site_slow_github.py` | the website in the installed Edge (every page, light/dark, desktop/phone width) and the "Download for macOS" wait when GitHub is slow |
| `sharpness.py 1,rounded,light 1.25,sharp,dark …` | text sharpness (ClearType) with the player, mixer, tape card, a dragged paragraph; `scale,corners,theme` |
| `play_press.py` | the voice play button's squeeze and the archive button's press, frame by frame |
| `packaged_smoke.py` | the packaged app (`electron-builder --dir`): opens, plays, records, refuses an inline script |

The Mac scripts in `../voice-check`, `../archive-check` and `../corners-check` also run on Windows now (`WORK` defaults to
`%TEMP%\notealise-check\build`, the same folder the setup above builds into; `NOTE_CRLF=1` makes `voice-check` write Windows
line endings).

More traps (2026-10-31): `Keys(port)` finds the app's process with `Get-NetTCPConnection -State Listen`, which sometimes
returns nothing — build it from the process you started instead (`Keys.__new__(Keys)`, `.pid = app.proc.pid`,
`.h = find_hwnd(pid)`). Python's `write_text` writes CRLF on Windows, which is a different test for the editor (pass
`newline='\n'`). In the archive the sidebar's archive button is called "Back to your notes". A toggle is only a toggle in
its one-line form `<details><summary>Title</summary>`. CDP keys don't reach menu accelerators (Ctrl+N), but Ctrl+F does
reach the editor. A real screen grab only works while the app is in front (`raise_window` before each) and only for rows
inside the window — scroll the line into view first.
