# CLAUDE.md — notes-app

Local-first desktop Markdown editor. Every note is a plain `.md` file in a user-chosen folder
on disk (the **vault**). This app is a better-feeling editor over those files — **not a
database that happens to export Markdown**. No accounts, no sync, no cloud.

If a rule below and the code disagree, the rule wins: fix the code, or ask. Do not weaken a
rule to match the code.

## Hard architectural rules (non-negotiable)

1. **Files are the source of truth.** No SQLite, no IndexedDB-as-note-store, no ORM, no note
   metadata database. Delete this app and the user's notes are untouched and fully usable in
   any other editor.

2. **App config lives in `.mdnotes/` inside the vault** — space colours, theme/appearance,
   window state, per-note placement. Mirrors how Obsidian uses `.obsidian/`. The one exception
   is the chosen vault path itself, which lives in `userData` (the app must know it *before* a
   vault is open). Never write app config into note frontmatter unless it is genuinely a
   property of *that* note.

3. **The editor is CodeMirror 6.** Locked. Not Monaco, not a `<textarea>`, not
   `contenteditable`, not ProseMirror. The live-preview syntax-hiding feature depends on CM6's
   decoration system; changing the editor breaks the core feature.

4. **Markdown must degrade.** Any file this app writes must open sensibly in Obsidian, VS Code,
   and GitHub. Custom syntax dialects are forbidden. Where Markdown lacks a feature (e.g. text
   colour), use inline HTML — valid CommonMark — never an invented delimiter.

5. **All visual values are CSS custom properties.** No hardcoded hex, no hardcoded
   border-radius, no hardcoded box-shadow anywhere in component code. Each reads a token from
   the renderer's theme layer; colours are `R G B` channel triples swapped via `[data-theme]`.
   The token layer is `src/renderer/src/theme.css` (ramps, density, bundled fonts); `app.css`
   and the editor read only those tokens — no hardcoded hex for themeable surfaces.

6. **The renderer never touches `fs` directly.** All disk access goes through Electron IPC to
   the main process (`src/main/vault.ts` is the only fs-touching code). The vault root is the
   boundary: main resolves every incoming path and rejects anything that escapes it.

7. **Windows and macOS are both first-class.** A vault written on one must open cleanly on the
   other. Build paths with `path.join`/`resolve`, never string concatenation with `/`. Compare
   paths with `path.relative`, never `===` / `startsWith` (a `startsWith(vaultRoot)` check
   passes review and fails on Windows). Never assume a dot-prefixed folder is hidden on Windows,
   or that the filesystem is case-sensitive. See **Cross-platform rules** below.

## Cross-platform rules

Ships on Windows + macOS; a vault must survive moving between them. All of this lives in main.

- **Paths:** internal paths are POSIX-style relative-to-vault; convert at the fs boundary
  (`toRel` / `resolveInVault` in `vault.ts`). Escape check is
  `rel = path.relative(root, abs); reject if rel.startsWith('..') || path.isAbsolute(rel)`.
- **Filename sanitisation** (`filenames.ts`, applied on both OSes): strip control chars; replace
  `< > : " / \ | ? *` with `-`; drop trailing dots/spaces; prefix reserved device names
  (`CON PRN AUX NUL COM1-9 LPT1-9`) with `_`. Surface the corrected name to the user; don't
  silently alter.
- **Case:** macOS + Windows are case-insensitive/case-preserving. Collision checks fold case; a
  case-only rename (`Note.md`→`note.md`) is done via a temp name (two moves).
- **Line endings:** detect dominant CRLF/LF on read, remember per file, restore on write — CM6
  normalises to LF, so without this every CRLF file shows as 100% changed in git.
- **Path length:** warn (throw a friendly error) before a create/rename exceeds Windows' 260.
- **Hidden config:** after creating `.mdnotes/`, set the Windows hidden attribute (`attrib +h`).
- **Watcher:** `awaitWriteFinish` (Windows fires mid-write → truncated reads); `usePolling` on
  UNC network drives.
- **Menus/shortcuts:** `CommandOrControl` in every accelerator; macOS app menu + stays running
  when the last window closes; Windows menu bar + quits.

## Stack

Electron · React · TypeScript · Vite (via **electron-vite**) · CodeMirror 6. File watching:
`chokidar`. Math rendering: `katex`. Reading-view markdown render: `marked` + `dompurify`
(sanitised — the only place note HTML is turned into DOM). Lint: `oxlint`.

**Ask before adding any dependency beyond the names above.**

## Folder structure

```
notes-app/
  electron.vite.config.ts   electron-vite build: main / preload / renderer
  tsconfig*.json            root refs + tsconfig.node.json (main+preload) / .web.json (renderer)
  package.json              scripts + deps ("main": out/main/index.js)
  src/
    main/                   MAIN PROCESS — the only code allowed to touch fs
      index.ts              app lifecycle + BrowserWindow (contextIsolation on, nodeIntegration off)
      config.ts             vault path persisted in userData/config.json (never inside the vault)
      vault.ts              path boundary + all fs ops (list/read/atomic-write/create/rename/trash)
      watcher.ts            chokidar → debounced (100ms) change events, echo-guarded
      ipc.ts                ipcMain handlers + vault activation (starts the watcher)
    preload/
      index.ts              contextBridge → window.api (typed VaultApi)
      index.d.ts            augments Window with `api`
    shared/                 contract imported by main, preload, renderer
      types.ts              TreeNode, VaultChange, VaultApi
      channels.ts           IPC channel names
    renderer/
      index.html            renderer entry
      src/                  React UI: App, TreeView, ContextMenu, editor/, settings/
        theme.css           tokens (R G B ramps + density) + bundled @font-face; app.css reads them
        assets/fonts/       bundled woff2 (Inter / Fraunces / JetBrains Mono) — no CDN
  legacy/                   pre-Electron browser app — reference only, NOT built (legacy/README.md)
  <vault>/.mdnotes/         created (hidden on Windows); holds settings.json (appearance) — vault path is in userData
```

## Commands

Node lives at `C:\Program Files\nodejs` and may not be on a fresh shell's PATH — prepend it.

```powershell
$env:Path = "C:\Program Files\nodejs;$env:Path"
npm --prefix ".\notes-app" run dev        # electron-vite dev — launches the Electron app window
npm --prefix ".\notes-app" run build      # electron-vite build -> out/
npm --prefix ".\notes-app" run start      # run the built app (electron-vite preview)
npm --prefix ".\notes-app" run typecheck  # tsc, node + web projects
npm --prefix ".\notes-app" run lint       # oxlint
```

`dev` opens a native **Electron window**, not a browser tab — there is no localhost URL.
There is **no test runner configured yet.** Do not assume `npm test` exists; adding one is a
new dependency — ask first.

## Current state vs target

The Electron foundation, vault layer, CM6 editor (live preview, colour/highlight, LaTeX,
autosave), the theme/token system, the sidebar (icons + drag-to-move into folders,
`TreeView.tsx`/`icons.tsx`), the note-title header (editable + word count), and the Edit/Read
**reading view** (`reader/ReadingView.tsx`, marked+dompurify+katex) are **built**.

**Spaces (built).** Top-level folders are "spaces" — an Arc-style rail at the bottom of the
sidebar shows one space's tree at a time; two-finger swipe or click switches, loose root notes
live in a synthetic **Home** space. Per-space colour/icon/order lives in `<vault>/.mdnotes/spaces.json`
keyed by folder name (never in the folder or notes; delete it and only colours are lost). A folder
with no entry gets a deterministic hash-derived colour. The active space's colour is injected as a
scoped `--space-accent` (R G B channels) on the `.app` wrapper, and the active-row / drop-target /
editor-selection rules read it with a brand fallback. Code: `shared/spaces.ts` (types+normalize),
`main/spaces.ts` (atomic+debounced writes, rename-with-rollback, delete), `renderer/src/spaces/`
(`model.ts` derive/palette/hash, `SpaceRail.tsx`, `SpacePopover.tsx`). Still pending:

- **`.mdnotes/` config (partial).** Holds `settings.json` (appearance: theme/density/accent).
  Window state and per-note placement still move in later.
- **Theme/token system — done, no Tailwind.** `theme.css` holds the `R G B` ramps (dark default +
  light via `[data-theme]`), density vars (`[data-density]`), and bundled `@font-face`; `app.css`
  and the editor read only tokens. Appearance is set in the Settings panel (gear in the sidebar
  header), persisted to `<vault>/.mdnotes/settings.json` (source of truth) with a theme/density
  mirror in userData for pre-paint. Accent generator ported from `legacy/src/settings.js` into
  `src/renderer/src/settings/model.ts`.
- **Organise features (Phase D, in progress).** Pins / archive / bin / custom drag-reorder /
  search — port from the legacy Sidebar (`legacy/src/App.jsx` L157–700). These need a per-vault
  metadata file `<vault>/.mdnotes/workspace.json` (order/pinned/archived, keyed by rel path),
  built like `settings.ts`; the filesystem alone is only alphabetical. Bin: relocate to
  `.mdnotes/trash/` (recoverable) vs. today's OS-trash `deleteEntry` — decide when building.
- **Remaining editor live-preview** (lists beyond the bullet, tables, fenced code, images,
  multi-line `$$`) — new decoration passes in `livePreview.ts` (see `docs/decorations.md`).

When you do work here, move *toward* the rules; never add code that deepens a gap (e.g. a
direct-`fs` call in the renderer, config written into the vault's notes, hardcoded style values).

## Gotchas (append as you learn)

- Node is not on a fresh shell's PATH — prepend `C:\Program Files\nodejs`.
- **Agent sessions only:** the harness sets `ELECTRON_RUN_AS_NODE=1`, which makes the Electron
  binary run as plain Node (symptom: `electron.app` is undefined, `process.version` is the
  system Node). Clear it before launching: `Remove-Item Env:ELECTRON_RUN_AS_NODE`. A normal user
  terminal does not have this set (VS Code itself is Electron), so `npm run dev` works for the
  user unchanged.
- In this environment, launch Electron via `node_modules/electron/dist/electron.exe` directly,
  not the `.bin/electron.cmd` shim (the shim's fallback ran the app under system Node).
- First `electron` run may download its binary (~100 MB) — let it finish.
- `out/` is the build dir (gitignored). `node_modules` lives under OneDrive — installs work but
  sync churn is possible; moving the project out of OneDrive is a later cleanup.
- Browser-era gotchas (File System Access API, `localhost` vs `file://`, Vite dev port) now
  apply only to `legacy/`. The **legacy app is the canonical look** the Electron UI is kept in
  sync with; the user runs it as a local live server. Launch it with `notes-app/run-legacy.bat`
  (double-click; uses `cmd`+`npm.cmd`, so no PowerShell exec-policy error, no admin) or
  `npm run dev:legacy` / `build:legacy` + `serve:legacy` (Vite on localhost:5173). See
  `legacy/README.md`.
