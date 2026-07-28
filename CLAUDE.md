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

2. **App config lives in `.mdnotes/` inside the vault** — theme/appearance (`settings.json`),
   organisation (`workspace.json`: order, pins, archive flags, the bin's index), the bin itself
   (`trash/`), and later window state. Mirrors how Obsidian uses `.obsidian/`. The exceptions live
   in `userData/config.json`, and both are properties of *this install* rather than of a vault:
   the chosen vault path (the app must know it *before* a vault is open) and the auto-update
   preference (per-vault would mean updates are on for one folder and off for another).
   Never write app config into note frontmatter unless it is genuinely a
   property of *that* note. Every sidecar must be *losable*: delete `workspace.json` and you
   lose ordering and pins, never a note (rule 1).

3. **The editor is CodeMirror 6.** Locked. Not Monaco, not a `<textarea>`, not
   `contenteditable`, not ProseMirror. The live-preview syntax-hiding feature depends on CM6's
   decoration system; changing the editor breaks the core feature.

4. **Markdown must degrade.** Any file this app writes must open sensibly in Obsidian, VS Code,
   and GitHub. Custom syntax dialects are forbidden. Where Markdown lacks a feature (e.g. text
   colour), use inline HTML — valid CommonMark — never an invented delimiter.
   **Colour is the one place this app deliberately diverges from legacy.** Legacy writes
   `<span style="color:#d0574a">`; this app writes `<mark class="hl-NAME">` /
   `<span class="tc-NAME">` against the named palette in `editor/palette.ts`. Class names are
   theme-aware — `--hl-NAME` / `--tc-NAME` have separate light and dark values, so a note stays
   legible on both themes, which a baked-in hex cannot do. The trade is that another editor
   renders `<mark>` but drops the text colour. Do not "restore" the hex form: it would break
   `colorModel.ts` and orphan the colours in every note already written.

5. **Colours are CSS custom properties; layout is Tailwind.** No hardcoded hex and no hardcoded
   box-shadow anywhere in component code. The token layer is `src/renderer/src/theme.css` (ramps,
   density, bundled fonts); colours are `R G B` channel triples swapped via `[data-theme]`.
   Tailwind's `brand` / `ink` / `paper` / `surface` scales and its `shadow-card` / `shadow-float`
   read those same variables (`tailwind.config.js`), so a utility class is still token-backed —
   `bg-surface/45` and `rgb(var(--surface) / 0.45)` are the same thing. Spacing, radius and
   typography come from Tailwind utilities on the components. See rule 8.

8. **The legacy app is the visual source of truth — and READ-ONLY.** `legacy/` (localhost:5173) is
   the canonical *look*; the Electron UI is kept in step with it. Legacy is styled with Tailwind v3
   utility classes, so this app is too — **copy the `className` string from `legacy/src/App.jsx`
   rather than re-deriving px values by eye.** That eyeballing is exactly what made the two apps
   drift apart before.
   **New features are built in the Electron app (`npm run dev`), never in legacy first.** Legacy is
   a *different program* — a browser app on `localStorage`, its own `.jsx`, no vault, no IPC, no
   updater. Building there and porting means implementing everything twice, and the second
   implementation drifts from the first; that drift is the "needed lots of tweaking" tax. Anything
   touching files, autosave, the bin, menus or updates can't be prototyped there at all. Consult
   legacy for *how something looks*; build in `npm run dev`, which is the real app with hot reload. Tailwind is a build-time dependency here (`postcss.config.js`); the CDN script
   legacy uses must never ship, since the app is offline-first.
   What deliberately stays in `app.css` is what `legacy/src/index.css` also keeps out of Tailwind:
   the sidebar row metrics (`.tree-row` / `.tree-title` / `.tree-sub` own the density variables
   outright so they can't lose to a utility), `.prose-note`, the CodeMirror `.cm-*` DOM, and the
   keyframes. Component-internal CSS for things legacy has no counterpart for (Spaces, the
   settings modal) also stays as CSS — there is nothing to match it against.

6. **The renderer never touches `fs` directly.** All disk access goes through Electron IPC to
   the main process (`src/main/vault.ts` is the only fs-touching code). The vault root is the
   boundary: main resolves every incoming path and rejects anything that escapes it.

7. **Windows and macOS are both first-class.** A vault written on one must open cleanly on the
   other. Build paths with `path.join`/`resolve`, never string concatenation with `/`. Compare
   paths with `path.relative`, never `===` / `startsWith` (a `startsWith(vaultRoot)` check
   passes review and fails on Windows). Never assume a dot-prefixed folder is hidden on Windows,
   or that the filesystem is case-sensitive. See **Cross-platform rules** below.

9. **Flag redundancy as it appears — don't quietly resolve it either way.** When a new capability
   supersedes or duplicates something already in the app — a UI shortcut that drag-and-drop, a
   context menu, or another feature already covers just as well — say so before moving on, and
   let the user decide whether the old path gets removed, kept, or replaced. Example: TreeView's
   Organize-mode rename/delete buttons on folder rows became dead weight once drag-and-drop was
   made unconditional and the right-click context menu already covered rename + move-to-bin for
   every node — that redundancy sat unflagged and unremoved until the user noticed it themselves.
   Don't silently leave a stale, now-redundant affordance in place "just in case," and don't
   silently delete it without saying why, either.

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

Electron · React · TypeScript · Vite (via **electron-vite**) · CodeMirror 6 · **Tailwind CSS v3**
(build-time, via `postcss` + `autoprefixer`). File watching: `chokidar`. Math rendering: `katex`.
Reading-view markdown render: `marked` + `dompurify` (sanitised — the only place note HTML is
turned into DOM). In-app updates: `electron-updater` (electron-builder's own companion — it reads
the `latest.yml` feed the release workflow already publishes). Lint: `oxlint`.

Tailwind is pinned to **v3** on purpose: `legacy/` runs the v3 Play CDN, and v4 changes what
several classes legacy uses actually mean (`outline-none`, the default `ring` width, the shadow
scale renames). Upgrading would silently break the visual match — don't, without redoing the
comparison.

**Ask before adding any dependency beyond the names above.**

## Folder structure

```
notes-app/
  electron.vite.config.ts   electron-vite build: main / preload / renderer
  tailwind.config.js        theme ported verbatim from legacy/index.html (brand/ink ramps → tokens)
  postcss.config.js         tailwind + autoprefixer; electron-vite picks it up automatically
  tsconfig*.json            root refs + tsconfig.node.json (main+preload) / .web.json (renderer)
  package.json              scripts + deps ("main": out/main/index.js)
  dev-app-update.yml        ONLY read by NOTES_TEST_UPDATER=1 npm run dev; never packaged
  docs/release-checklist.md the four gates, the release ritual, and how to recover a bad release
  .github/workflows/        verify.yml (every push) + release.yml (v* tags; verify gates packaging)
  src/
    main/                   MAIN PROCESS — the only code allowed to touch fs
      index.ts              app lifecycle + BrowserWindow (contextIsolation on, nodeIntegration off)
      config.ts             vault path + autoUpdate in userData/config.json (never inside the vault)
      updater.ts            the ONLY importer of electron-updater; dev + macOS guards, status push
      vault.ts              path boundary + all fs ops (list/read/atomic-write/create/rename/bin)
      workspace.ts          .mdnotes/workspace.json: order/pins/archive/bin (debounced, atomic)
      settings.ts           .mdnotes/settings.json (appearance) + userData pre-paint mirror
      watcher.ts            chokidar → debounced (100ms) change events, echo-guarded
      ipc.ts                ipcMain handlers + vault activation (starts the watcher)
    preload/
      index.ts              contextBridge → window.api (typed VaultApi)
      index.d.ts            augments Window with `api`
    shared/                 contract imported by main, preload, renderer
      types.ts              TreeNode, VaultChange, VaultApi
      workspace.ts          EntryMeta / TrashItem / Workspace + normalise + path re-keying
      update.ts             UpdateStatus / UpdatePrefs contract + normalise
      channels.ts           IPC channel names
    renderer/
      index.html            renderer entry
      src/                  React UI: App (editor pane) + Sidebar (the whole aside)
        Sidebar.tsx         header/archive toggle, nav bar, pinned, archive & bin views, bottom strip
        TreeView.tsx        the row renderers: 2-line rows, multi-select, drag-reorder
        organise/model.ts   pure derivation: sorting, archive inheritance, pinned hoisting
        update/             UpdateBanner: the quiet "update ready" strip in the sidebar footer
        theme.css           tokens (R G B ramps + density) + bundled @font-face; Tailwind reads them
        app.css             @tailwind directives + only what legacy keeps out of Tailwind (see rule 8)
        assets/fonts/       bundled woff2 (Inter / Fraunces / JetBrains Mono) — no CDN
  legacy/                   pre-Electron browser app — reference only, NOT built (legacy/README.md)
  <vault>/.mdnotes/         created (hidden on Windows); settings.json + workspace.json + trash/
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

```powershell
npm --prefix ".\notes-app" run test       # vitest, pure modules only
npm --prefix ".\notes-app" run package:dir  # REAL packaged app, no installer -> release/win-unpacked/
```

`dev` opens a native **Electron window**, not a browser tab — there is no localhost URL.

**Tests are `vitest`, and cover pure logic only** (`*.test.ts` beside the module): `colorModel`,
`organise/model`, `shared/workspace`, `shared/settings`, `shared/update`, `main/filenames`. No React
and no Electron — those need a different kind of harness and are not worth the weight yet. Adding
any *other* dependency still needs asking.

## Shipping a release ("push that update to Vercel")

**Read `docs/release-checklist.md` before releasing.** Short version below.

**Tracking pending changes (`CHANGELOG.md`).** Its `## [Unreleased]` section is the running list
of what's built and verified since the last tag — read *that* to answer "what would a release
include right now," never scan the codebase for it. It's populated incrementally: once a feature
is built AND the user has verified it works in the **live Electron app** (`npm run dev`) — not
`legacy/`, which never ships (rule 8) — ask whether to add it to the next update or scrap it. If
kept, append one line to `Unreleased` in the same terse, user-facing style as past tag messages
(e.g. "Add KaTeX inline math rendering in the editor"). Don't log automatically and don't log on
the strength of unit tests alone — this is specifically gated on the user's own live-app check.

When the user says "push the latest update" (or similar — see the ritual below), read
`Unreleased` first, sanity-check it against `git status` and `git log vX.Y.Z..HEAD --stat` (cheap
and targeted, not a full-repo scan), then run the gates. When tagging, move the `Unreleased`
bullets under a new `## [x.y.z] - YYYY-MM-DD` heading in the same commit that bumps
`package.json`'s version.

The Vercel page (`site/`) is **not** where a release lives. It always links at
`releases/latest/download/`, so redeploying it ships nothing — pushing `site/` alone produces a
byte-identical page. **The release is the git tag.** The ritual:

```powershell
# bump "version" in package.json, move CHANGELOG.md's Unreleased bullets under a new
# ## [x.y.z] - YYYY-MM-DD heading, then:
git commit -am "vX.Y.Z: <what changed>"
git tag vX.Y.Z
git push && git push --tags        # the v* tag is what triggers GitHub Actions
```

Actions builds the NSIS `.exe` + the `.dmg`, and — because `electron-builder.yml` sets
`publish: provider: github` — also publishes **`latest.yml`** (the update feed) and
**`Notes-Setup.exe.blockmap`** (so an installed app downloads only the changed chunks, not the
whole ~103 MB). Installed apps poll that feed; the download page keys off the same
`releases/latest`. One tag updates both.

**macOS cannot auto-update, and it is not a code bug.** `electron-builder.yml` sets
`identity: null`, and Squirrel.Mac *refuses to apply an unsigned update* — a signature check, not
a dismissible warning. There is also no `latest-mac.yml` and no `.zip` (mac updates need a zip;
`dmg: writeUpdateInfo: false`). Fixing it needs an Apple Developer ID (~$99/yr) + notarization —
deferred by decision, revisit at marketing time. Until then the Mac build shows the same UI, but
the button opens the releases page and Settings says why.

**Beta channel.** A tag containing `-` (`v0.2.0-beta.1`) is published as a GitHub **prerelease**.
CI must pass **both** `--config.publish.releaseType=prerelease` *and*
`--config.publish.channel=beta` — electron-builder does **not** infer the channel from the version
for the GitHub provider (it assumes you'll use the prerelease flag instead), so without the second
flag a beta ships `latest.yml`. electron-updater asks for `beta.yml` first and only falls back to
`latest.yml`, so it would limp along undetected; don't rely on that. With both set:
electron-builder writes `beta.yml` instead of `latest.yml`, GitHub excludes prereleases from
`releases/latest` (so the download page keeps serving stable with no change), and stable installs
have `allowPrerelease === false` and never see it. Testers opt in via **Settings → Updates →
Receive test builds**, or just by installing a beta once. Turning it off steps back down to stable —
which works only because setting `channel` also sets `allowDowngrade`.

**Testing updates without releasing.** `NOTES_TEST_UPDATER=1 npm run dev` sets
`forceDevUpdateConfig`, so electron-updater reads `dev-app-update.yml` and talks to the live feed
(`AppUpdater.js:278` enables on `isPackaged || forceDevUpdateConfig`). Lower `version` in
`package.json` to make it find something. `quitAndInstall` still needs a real install — dev covers
check → download → sha512 verify, and `installNow` says so plainly rather than failing inside
Squirrel.

## Current state vs target

The Electron foundation, vault layer, CM6 editor (live preview, colour/highlight, LaTeX,
autosave), the theme/token system, the sidebar (icons + drag-to-move into folders,
`TreeView.tsx`/`icons.tsx`), the note-title header (editable + word count), and the Edit/Read
**reading view** (`reader/ReadingView.tsx`, marked+dompurify+katex) are **built**.

**In-app updates (built).** Windows installs update themselves: a new version downloads quietly,
a strip appears above "Switch folder", and it applies on quit. Settings → Updates has the version,
an auto-update toggle, and a manual check; there's also File → Check for Updates…. See
**Shipping a release** above for the tag ritual and the macOS caveat.

**Spaces — removed (2026-07-25), do not reintroduce.** Top-level folders were briefly hoisted out
of the tree into an Arc-style rail. That is *precisely* what stopped the app matching the legacy
reference: the folders localhost shows as tree rows were the ones Spaces took out of the tree. The
rail, `spaces.json` and `renderer/src/spaces/` are gone; folders are ordinary tree rows again. A
stale `spaces.json` in an old vault is inert and can be ignored.

**Organise (built).** Pins, archive, a recoverable bin, custom drag-reorder, multi-select and
Organize mode — ported from the legacy Sidebar. State lives in `<vault>/.mdnotes/workspace.json`
keyed by vault-relative POSIX path (`main/workspace.ts` — debounced + atomic writes, root captured
at schedule time, key re-mapping on rename). **Archive is a flag; the `.md` file never moves**, and
a folder carries its subtree by inheritance. **The bin is real:** deleting moves the entry to
`<vault>/.mdnotes/trash/<id>-<name>` and records it in `workspace.trash`; Restore puts it back
(collision-suffixed if the name was retaken), and **"Empty recycle bin" is the only path that
reaches the OS trash**. `.mdnotes/` is already skipped by the tree walk and the watcher, so binned
entries leave the tree for free. Still pending:

- **`.mdnotes/` config (partial).** Holds `settings.json` (appearance) and `workspace.json`
  (organisation). Window state and per-note placement still move in later.
- **Theme/token system — done.** `theme.css` holds the `R G B` ramps (dark default + light via
  `[data-theme]`), density vars (`[data-density]`, legacy's values verbatim, including
  `--row-sub` / `--row-sub-display`), and bundled `@font-face`; Tailwind and the editor read only
  tokens. Appearance is set in the Settings panel (gear in the sidebar header), persisted to
  `<vault>/.mdnotes/settings.json` (source of truth) with a theme/density mirror in userData for
  pre-paint. Accent generator ported from `legacy/src/settings.js` into
  `src/renderer/src/settings/model.ts`.
- **Visual match to legacy — chrome and structure done.** Sidebar chrome, search pill, two-line
  tree rows (`TreeNode.preview` is filled from the head of each file in `vault.ts`), nav bar,
  Pinned/Notes headers, archive and bin views, editor header, format bar, reading column and empty
  states all use legacy's own class strings. **Remaining gap:** the editor header's
  "· Edited &lt;date&gt; · &lt;save status&gt;", which needs `updatedAt` and a save-state string
  surfaced to the renderer.
  *When comparing against localhost, open the same folder there* — in browser-storage mode legacy
  says "Local notes" / "Saved in this browser", which are its storage-mode strings, not a mismatch.
- **Settings (partial).** The **shell is now legacy's genie window** — centred 720×600, faded
  `bg-paper/50 backdrop-blur-[5px]` backdrop, left section nav, scrollable content pane, and the
  scale-from-the-gear animation (`.genie` in `app.css`, ported verbatim). Two of legacy's four
  sections exist: **Appearance** (theme, accent, accent mode, density) and **Updates**.
  **General** (startup) and **Formatting** (date/number/timezone, `legacy/src/intl.js`) are absent
  rather than empty — they arrive with the settings behind them. Accent *scope*, and persisting
  `freeArrange` / `archiveSort` (both exist in code, neither is saved), are also still to come.
- **Remaining editor live-preview** (lists beyond the bullet, tables, images) — new decoration
  passes in `livePreview.ts` (see `docs/decorations.md`). Fenced code blocks and multi-line `$$`
  math are done as of 2026-07-28.

When you do work here, move *toward* the rules; never add code that deepens a gap (e.g. a
direct-`fs` call in the renderer, config written into the vault's notes, hardcoded style values).

## Gotchas (append as you learn)

- Node is not on a fresh shell's PATH — prepend `C:\Program Files\nodejs`.
- **`position: fixed` does not escape the sidebar.** The `<aside>` carries `backdrop-blur`, and
  **`backdrop-filter` makes an element a containing block for fixed-position descendants** — so a
  `fixed inset-0` overlay rendered anywhere inside it is pinned to the 288px sidebar, not the
  viewport. The bottom strip is additionally `pointer-events-none`, which such an overlay inherits.
  This is what made the settings modal open as an unclickable side panel. **Any full-window overlay
  must `createPortal` to `document.body`** (see `settings/Settings.tsx`). Legacy dodges it by
  rendering `SettingsPanel` at the App root instead — either is fine, in-place is not.
- **A vault inside OneDrive (or Dropbox/iCloud) breaks a bare `fs.rename`.** The sync client
  briefly holds a handle on the file, so the atomic write's final rename fails with `EPERM`
  (also seen: `EACCES`, `EBUSY`) and the user's edit is lost. Every rename in `vault.ts` and
  `workspace.ts` goes through **`renameWithRetry`** (30/60/120/240/480ms backoff); a failed
  `writeNote` also unlinks its scratch file so orphan `.<name>.<hex>.tmp` dotfiles don't pile up
  in the vault. Never call `fs.rename` directly here — synced vaults are a normal setup, not an
  edge case.
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
- **`npm run package:dir` can fail with `EPERM ... rename 'win-unpacked.tmp' -> 'win-unpacked'`.**
  Same OneDrive cause as the vault's rename problem, but on electron-builder's own output: it drops
  a ~215 MB tree into `release/`, OneDrive starts syncing it, and the final rename hits a held
  handle. `release/` is gitignored but **gitignore means nothing to OneDrive.** Fix: delete
  `release/` and re-run (`Remove-Item release -Recurse -Force`). Proper fix: exclude `release/` and
  `node_modules/` from OneDrive sync, or move the project off OneDrive.
- Browser-era gotchas (File System Access API, `localhost` vs `file://`, Vite dev port) now
  apply only to `legacy/`. The **legacy app is the canonical look** the Electron UI is kept in
  sync with; the user runs it as a local live server. Launch it with `notes-app/run-legacy.bat`
  (double-click; uses `cmd`+`npm.cmd`, so no PowerShell exec-policy error, no admin) or
  `npm run dev:legacy` / `build:legacy` + `serve:legacy` (Vite on localhost:5173). See
  `legacy/README.md`.
