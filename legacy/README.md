# legacy/ — pre-Electron browser prototype (reference only)

This is the original **browser** notes-app: Vite + React 19 + CodeMirror 6 in plain JS,
reaching disk through the File System Access API with a localStorage fallback. It was moved
here on **2026-07-23** when the project migrated to Electron (see `../CLAUDE.md`).

## Run it (the canonical "good" look — localhost:5173)

**Easiest — double-click `../run-legacy.bat`.** It starts the live server and opens the app in
your browser. Runs through `cmd`+`npm.cmd`, so it dodges the PowerShell "running scripts is
disabled" error and needs no admin. Keep the window open; close it (Ctrl+C) to stop.

**From a terminal** (in `notes-app/`):

```powershell
$env:Path = "C:\Program Files\nodejs;$env:Path"
npm.cmd run dev:legacy            # live-editing server -> http://localhost:5173 (next free port if busy)
# or a lighter production live server:
npm.cmd run build:legacy          # build once -> legacy/dist/
npm.cmd run serve:legacy          # serve it at http://localhost:5173/
```

Use **Chrome/Edge** (folder access); the **first load needs internet** (fonts + Tailwind via CDN);
notes are saved **per browser** so two machines don't share note *data*, but the look is identical.
This is the **reference the Electron app is kept in sync with** — the look here is canonical.

**It is not part of the Electron build** — it is not wired into `electron.vite.config.ts` and
nothing in `src/` imports it. It is kept because it holds substantial feature work worth
porting onto the Electron/IPC foundation:

- `src/livePreview.js` — Obsidian-style live preview (CM6 decorations hide syntax off the
  cursor line; the headline feature).
- `src/settings.js`, `src/index.css` — theme/density/accent token system (`R G B` channels).
- `src/storage.js` — org sidecar (virtual folders, pin, archive, bin) + File System Access I/O.
- `src/completions.js` — `/` slash menu + `[[wiki-link]]` autocomplete.
- `src/App.jsx` — the full UI: sidebar vault, formatting bar, settings window, archive, bin.

When porting a feature, reimplement its disk access over the vault IPC layer in `src/main/` —
**the renderer must never touch `fs`** (CLAUDE.md rule 6). File placement/config that the old
app stored in localStorage should move into the vault's `.mdnotes/` (CLAUDE.md rule 2).
