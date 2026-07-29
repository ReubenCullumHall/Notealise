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
   keyframes. Component-internal CSS for things legacy has no counterpart for (the settings modal,
   the Spaces tab strip) also stays as CSS — there is nothing to match it against.

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
      settings.ts           .mdnotes/settings.json (spaces + globals) + userData pre-paint mirror
      watcher.ts            chokidar → debounced (100ms) change events, echo-guarded
      ipc.ts                ipcMain handlers + vault activation (starts the watcher)
      support.ts            bug-report mailto: link (fixed destination is still a placeholder)
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
        settings/           Settings.tsx (genie window, nav, General/Formatting/Updates/ReportBug)
                            Spaces.tsx (the 5 presets + everything per-space), Collection.tsx,
                            primitives.tsx (SettingRow/Select/Switch/ToggleRow), model.ts (applySettings)
        editor/             CM6 setup, format bar + its assignable slots (toolbarActions.tsx)
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
`editor/formatModel`, `editor/formatCommands`, `organise/model`, `shared/workspace`,
`shared/settings`, `shared/update`, `main/filenames`. No React and no Electron — those need a
different kind of harness and are not worth the weight yet. Adding any *other* dependency still
needs asking.

**A green suite is not evidence the feature works — a test can canonise the bug.** Worked example,
2026-07-29: `formatModel.test.ts` carried `it('does nothing to an all-blank selection')`, asserting
that `toggleMarker` left a blank line untouched. It passed. It had always passed. And it was the
bug: with the cursor on an empty line — a new note, or straight after Enter, which is *precisely*
when you reach for a list — every block command (lists, headings, quote) silently did nothing. The
model was tested, the coverage was real, and the expectation was simply wrong. So: **when a test
asserts that something does nothing, make it say why "nothing" is what the user wants.** If the
answer is "because that's what the code does", it is not a test, it's a transcript. The same test
file now spells the reasoning out in both directions — a blank line *beside text* is a paragraph
gap and stays untouched; a selection that is *entirely* blank is the target.

The corollary for the pure-logic suite generally: it proves the model, and the model is often not
where the user's problem is. Nothing in it can see that an accent's inline `--ink-*` cancels a CSS
theme rule, that a dev-server HMR left the main process on old code, or that a button's click
handler never reaches the command. Those need the live app (see **Gotchas**).

`formatCommands.test.ts` is the one that looks like an exception and isn't: **CodeMirror's
`EditorState` is pure — only `EditorView` needs a DOM** — so the commands run against a real state
via a stub view exposing just `state` / `dispatch` / `focus`. That covers the selection arithmetic
(where an off-by-one leaves the cursor inside a marker) with no jsdom. It relies on
`formatCommands.ts` importing `EditorView` as a **type only**; make it a value import and the test
file pulls in the DOM build and dies. Run these with `npm test` from `notes-app/` — a bare
`npx --prefix … vitest` resolves a different copy and fails on import with a bogus
`Cannot read properties of undefined (reading 'config')`.

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

**Spaces (rebuilt 2026-07-29) — read this before "removing Spaces" again.** Spaces are **the layer
of the hierarchy between the vault and the sidebar**:

```
<vault>/          the folder picked at onboarding
  Revision/       a SPACE — a top-level folder
    Physics/      an ordinary folder, a row in the sidebar
      waves.md
  Journal/        another space
```

**The folders on disk ARE the spaces** (rule 1). `settings.json` only decorates them — emoji, theme,
accent, density, arranging, the four format-bar buttons — so a maths-revision space can carry the
formula shortcut while a journal space doesn't. Make a folder in Explorer and it becomes a space;
delete one there and it stops being one (`reconcileSpaces`, run on every tree load). Switching space
re-scopes the sidebar to that folder's subtree, and **new notes and folders land inside the active
space, not at the vault root** (`inSpace()` in `App.tsx`). Cap is **7**, so the switcher stays a
glanceable row. The switcher itself is a horizontal strip in the sidebar footer, above "Switch
folder".

**History, and what is actually banned.** An earlier version (removed 2026-07-25) hoisted top-level
folders into an **Arc-style vertical rail beside the tree**. That was pulled because the surrounding
pieces — organise, pins, the bin, the theme system — didn't exist yet, so it read as chrome that
broke the sidebar's match with `legacy/` for no gain. It was rebuilt on 2026-07-29 once those
landed, by the user's explicit decision. **The banned thing is the rail, not the hierarchy**: legacy
governs how *rows look*, not how many levels the vault has — `legacy/` is a browser app with no
vault and no spaces, so it has nothing to say about this layer. Don't "restore" top-level folders to
the tree; they're spaces, and showing them as rows too would double them up.

The old `renderer/src/spaces/` and its `spaces.json` are gone and are *not* read — a stale
`spaces.json` in an old vault stays inert, and this feature deliberately does not reuse that
filename (its shape was a map keyed by folder name, which a lax loader would misread).

*The model* (`shared/settings.ts`): `AppSettings = { spaces: Space[], activeSpaceFolder, …globals }`.
Per-space: `folder` (the identity **and** the display name), emoji, theme, textTone,
buttonDefinition, density, accent, accentMode, freeArrange, compactNav, toolbarSlots, and the inert
`pageLook`/`font`/`tint`.
**Global on purpose:** startup, `lastNotePath`, dateFormat, numberFormat, timezone — `lastNotePath`
especially, because it's written on *every* note open, and nesting it would make each one rewrite
the whole spaces array. Things to know before editing it:

- **A vault always settles on at least one REAL, folder-backed space** (2026-07-29, reversing
  earlier guidance here that said the opposite — read this before "fixing" it back). `spaces` can be
  momentarily empty inside `reconcileSpaces`'s own arithmetic, and `AppSettings.spaces` can hold a
  lone *unbound* placeholder (`folder: ''`, standing for "the whole vault") for one reconcile pass —
  but `App.tsx`'s `syncSpaces` auto-creates a folder (the same "New folder" convention as everywhere
  else) and binds it the moment reconcile would otherwise leave zero bound spaces. This runs on every
  tree load, so it covers a brand-new/flat vault, switching to one, and deleting your last space back
  down to none — one mechanism, not three. `withNewSpace` already special-cases "the only space is
  the unbound placeholder" by *rebinding* it rather than appending, so the created folder inherits
  whatever theme/density the placeholder was carrying rather than resetting to defaults. The reason
  this matters: a hidden switcher with no real space meant every new note/folder silently landed at
  the vault root ("Not in a space") — this is a bug fix, not a preference.
- **`pick()` ("Switch folder") must call `syncSpaces` too**, not just the boot `useEffect` — the file
  watcher is started with `ignoreInitial: true` (`main/watcher.ts`), so an existing vault's
  pre-existing top-level folders never self-announce as spaces; nothing reconciles them otherwise
  until some later fs event happens to fire.
- **Notes loose at the vault root are never moved.** They render in a "Not in a space" group, in
  every space. Moving a user's files to tidy the hierarchy is exactly what rule 1 forbids.
- **Migration is inside `normalizeSettings`, not a separate pass.** A flat pre-Spaces file *is* a
  valid raw space (the keys have the same names at top level), so `[wholeRawFile]` goes through the
  same `normalizeSpace` the new shape does. One code path, so the two can't drift. It is idempotent,
  and that's tested — the test that catches a migration which re-migrates its own output.
- **A space with `folder: ''` is "unbound", and that's load-bearing.** `reconcileSpaces` binds
  unbound spaces to unclaimed folders in order, which is what (a) carries a migrated pre-Spaces
  user's theme and density onto their first real folder instead of resetting it, and (b) keeps a
  space's look when its folder is renamed *outside* the app.
- **Create / rename are real fs operations** going through the existing `createFolder` /
  `renameEntry` IPC. Settings is only updated with the path **main actually used**, because names
  get sanitised and de-duplicated.
- **Deleting a space goes straight to the OS trash** (`main/vault.ts:trashEntryToOS`, IPC
  `deleteSpace`) — deliberately **not** `trashEntries`, the app's own recoverable bin. A space is a
  different level of the hierarchy from the notes and folders trashed individually inside one;
  putting a deleted space in the same bin list as an individually-trashed note conflated the two.
  Still recoverable, just from the OS's own Recycle Bin/Trash rather than in-app — the two-step
  "click again to delete" button is the confirmation, and is trusted as sufficient on its own.
- **The pre-paint cache mirrors the ACTIVE space**, flat, and holds exactly **the values
  `renderer/index.html` writes onto `<html>` before React exists** — now `{theme, density, textTone,
  buttonDefinition}`. That rule is the whole reason it's a separate shape from `AppSettings`: adding
  a *paint* value means adding a key here (plus the mapping in `index.html` and the type in
  `preload/index.ts`); adding any other setting must not. Old cache files still work — every key is
  independently defaulted. It has its own validator (`normalizeThemeCache`) — running it through
  `normalizeSettings` reads keys that don't exist there and silently paints the default theme on
  every launch.
- **Edits go through the pure helpers** `withSpacePatch` / `withNewSpace` / `withoutSpace`, which
  return a `Partial<AppSettings>` for the existing `setSettings`. No `setSpace` IPC channel — main
  stays unaware that spaces exist beyond resolving the active one for the cache.

**Organise (built).** Pins, archive, a recoverable bin, custom drag-reorder, multi-select and
Organize mode — ported from the legacy Sidebar. State lives in `<vault>/.mdnotes/workspace.json`
keyed by vault-relative POSIX path (`main/workspace.ts` — debounced + atomic writes, root captured
at schedule time, key re-mapping on rename). **Archive is a flag; the `.md` file never moves**, and
a folder carries its subtree by inheritance. **The bin is real:** deleting moves the entry to
`<vault>/.mdnotes/trash/<id>-<name>` and records it in `workspace.trash`; Restore puts it back
(collision-suffixed if the name was retaken), and **"Empty recycle bin" is the only path that
reaches the OS trash**. This one flat folder holds everything regardless of which space (if any) an
item came from — the random `id` prefix is what lets same-named notes from different spaces sit in
the bin at once — and `TrashItem.from` remembers the item's original space-qualified path, so
Restore recreates that folder if it's gone (which then reappears as an ordinary new space on the
next reconcile, per the Spaces section above — self-healing, not orphaned). Emptying the bin has no
confirmation prompt: the bin view itself is one click away, and every item in it already passed its
own delete confirmation on the way in. `.mdnotes/` is already skipped by the tree walk and the
watcher, so binned entries leave the tree for free. Still pending:

- **`.mdnotes/` config (partial).** Holds `settings.json` (appearance) and `workspace.json`
  (organisation). Window state and per-note placement still move in later.
- **Theme/token system — done.** `theme.css` holds the `R G B` ramps (dark default + light and
  **black ("Extra dark")** via `[data-theme]`), density vars (`[data-density]`, legacy's values verbatim, including
  `--row-sub` / `--row-sub-display`), and bundled `@font-face`; Tailwind and the editor read only
  tokens. Appearance is set in the Settings panel (gear in the sidebar header), persisted to
  `<vault>/.mdnotes/settings.json` (source of truth) with a paint-value mirror in userData for
  pre-paint. Accent generator ported from `legacy/src/settings.js` into
  `src/renderer/src/settings/model.ts`.
  Three appearance knobs past legacy's theme+density, all per-space, all `data-*` on `<html>`:
  - **`black` — "Extra dark"** is a *variant* of dark, not a third palette. `:root` in the dark rule
    still matches a `[data-theme='black']` root, so its block overrides only the surfaces
    (`--surface`, the low `--brand-*`, `--code-bg`) and everything else — the ink ramp, `--wash`,
    the `hl`/`tc` palette, `--ed-*` — inherits. Add a token to dark and black gets it for free.
    `--surface` stays a hair above `--paper` on purpose: shadows are invisible black-on-black, so
    that 4% and the border are all that separate a popover from the page.
  - **`textTone` (`data-text-tone`)** — grey (the long-standing ramp) or white, on the dark themes
    only; the light theme has no white to give, and its buttons say so rather than no-op silently.
    A **Text-mode accent writes `--ink-*` inline, which beats any selector**, so `model.ts` folds
    the tone into the accent ramp (`WHITE_LIFT`) rather than letting one silently cancel the other.
  - **`buttonDefinition` (`data-button-def`)** — opt-in stronger button edges, every theme, painted
    from `--btn-edge` (per theme: lighter on dark, light grey on black, darker on light). Buttons
    **opt in** — `.btn-edge`, or by class name for the settings window's own controls — because a
    blanket `button` rule outranks `hover:border-*` and would kill every hover state, and would
    repaint the accent borders that mark active states. It only strengthens edges that already
    exist: `border-none` buttons (the Note / Folder nav) are deliberately left alone.
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
  scale-from-the-gear animation (`.genie` in `app.css`, ported verbatim). The nav is **General**
  (startup) · **Spaces** · **Formatting** (date/number/timezone, `legacy/src/intl.js`) · **Your
  collection** · **Updates** · **Report a bug** (a `mailto:` link opened by main,
  `src/main/support.ts` — no account or API key needed, but the destination address is a
  placeholder pending branding/support-inbox decisions).
  **Legacy's Appearance and Arranging sections no longer exist at the top level** — they belong to
  a space and live inside collapsible sections on the Spaces page, along with Shortcuts. Don't
  "restore" them to the nav; per-space is the point.
  **Your collection** is a shell: three empty states for page looks / fonts / tints, the future
  features whose `pageLook` / `font` / `tint` fields a `Space` already persists (so they land
  without a second migration). It invents **no** storage format — no `collection.json` — on purpose.
  **"Paper", "page look", "font" and "tint" are reserved words in this UI** — they name those
  planned features, so no other control may borrow them. The Light theme's card was briefly
  subtitled "Warm paper"; it is neither (`--paper` is `247 247 246`, a neutral white) and it stole a
  term the collection needs. Describe what the tokens actually are — "Plain white" — and don't coin
  product vocabulary that collides with the roadmap.
  Accent *scope*, and persisting `archiveSort` (Sidebar-local state, lost on relaunch), are still
  to come.
- **Custom format-bar buttons (built).** Two programmable slots sit each side of the built-in
  B/I/U/S + colour group. A slot has **two modes and no overlap**: empty, it shows a "?" and opens
  the picker; programmed, it is an ordinary format button and clicking runs the command. Changing an
  assigned one is **Settings → Spaces → Shortcuts** only (all four against a preview of the bar,
  with "Clear this button" per slot). The old right-click-to-reprogram gesture was **removed
  2026-07-29** — it made a live command button double as its own settings control, on a gesture
  nothing else in the app uses; don't reinstate it.
  **They belong to the active space**, so the bar's own picker writes to whichever space you're in.
  Persisted as `toolbarSlots` on a Space — four ids from `editor/toolbarActions.tsx`, with
  `''` for empty. **Those ids are a file format:** rename one and every vault using it silently
  empties that slot. Unknown ids read as empty rather than throwing, the same loose validation
  `accent` gets, because the catalogue is renderer-side and `shared/settings.ts` can't see it.
  The **LaTeX/formula button was removed from the permanent group** (2026-07-29) — not every user
  writes maths — and is now one of the assignable actions. `Ctrl/Cmd+Shift+L` still inserts one
  regardless of whether any slot holds it.
  **Block commands must act on an empty line** (`toggleMarker`, `formatModel.ts`). Blank lines are
  skipped only when there is other text in the selection, where they are paragraph gaps; a selection
  that is entirely blank IS the target. Skipping it unconditionally — the original behaviour, fixed
  2026-07-29 — meant every list, heading and quote button did nothing at all on a new note or right
  after Enter, which is the single most common moment to press one. The bug was invisible from the
  bar: the button was wired correctly and the command ran, it just declined to change anything.
- **Remaining editor live-preview** (lists beyond the bullet, tables, images) — new decoration
  passes in `livePreview.ts` (see `docs/decorations.md`). Fenced code blocks and multi-line `$$`
  math are done as of 2026-07-28.

When you do work here, move *toward* the rules; never add code that deepens a gap (e.g. a
direct-`fs` call in the renderer, config written into the vault's notes, hardcoded style values).

## Gotchas (append as you learn)

- Node is not on a fresh shell's PATH — prepend `C:\Program Files\nodejs`.
- **`npm run dev` hot-reloads the RENDERER ONLY. A change under `shared/` or `main/` or `preload/`
  needs the app restarted, and the failure is silent, not loud.** Observed 2026-07-29: after editing
  `shared/settings.ts` + `main/settings.ts` + `preload/index.ts`, the dev server logged fourteen
  renderer HMR updates and **never re-logged "electron main process built successfully"** — so main
  was still running the *previous* bundle. That matters because `shared/settings.ts` is compiled into
  all three: main's stale `normalizeSettings` would have rejected the new `theme: 'black'` as
  out-of-range and written `'dark'` back, so picking the new theme would flick on and snap straight
  back, with nothing in any log to say why. The renderer looking correct is not evidence main agrees.
  **After touching `shared/`, restart the dev app before believing anything you see** (kill it, relaunch
  — the fresh boot re-logs both "main process built" and "preload scripts built"; check for both).
- **The working directory persists across Bash *and* PowerShell tool calls, including a `cd` from a
  different tool.** A `cd .../notes-app/legacy` in one call left `npm --prefix ".\notes-app" run dev`
  resolving to `notes-app/legacy/notes-app/package.json` (ENOENT, exit 38). The relative `--prefix`
  in the Commands section above assumes cwd is the projects root. **In an agent session, pass an
  absolute `--prefix`.**

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

### The theme layer's precedence chain (read before adding an appearance setting)

Colour is written in three places that override each other in a fixed order, and getting this wrong
produces a control that silently does nothing — the worst kind of bug here, because it typechecks,
it tests green, and it looks implemented:

**`[data-theme]` block  <  `[data-text-tone]` block  <  inline `--ink-*` from the accent.**

- Inline always wins. `settings/model.ts` writes the accent ramp with `el.style.setProperty`, so any
  token the accent touches CANNOT be overridden by a stylesheet rule, however specific. This is why
  `textTone` is folded into the accent ramp (`WHITE_LIFT`) instead of living only in `theme.css`:
  without that, "white text" worked until you picked an accent, then quietly stopped.
- Anything you add that the accent also writes has the same problem. Check `ALL_KEYS` first.
- `--btn-edge` is deliberately *outside* the accent — a tinted accent leaves button edges neutral.
  Accepted, not overlooked: `RAMP`'s ink tint is 8% saturation, invisible on a hairline border.
- The aliases (`--ed-muted: rgb(var(--ink-500))`) track the tone only because **every one of these
  blocks targets `:root`**. A custom property's `var()` is substituted at computed-value time *on the
  element that declares it*, so `--ed-muted` computes on `:root` from whichever `--ink-500` won the
  cascade there, and inherits down already resolved. The consequence to remember: override an ink
  token on a **descendant** and the `--ed-*` aliases will NOT follow it. Keep ramp overrides on
  `:root`.

### Tailwind utilities vs. a global attribute-scoped rule

An `:root[data-x] …` rule in `app.css` outranks a Tailwind utility (0,2,1 vs 0,1,0) — **including
the `hover:` / `focus:` variants**, which are only 0,2,0. A blanket `:root[data-button-def='on']
button { border-color: … }` therefore repaints every button's hover and focus state too, killing the
feedback. Two rules follow, both learned the hard way on that feature:

1. **Guard state variants explicitly**: `:not(:hover):not(:focus-visible):not(:focus-within)`. The
   `:focus-within` one is not optional — the search pill's `focus-within:border-brand-300` is how it
   shows focus, and it was already broken before that `:not()` went in.
2. **`.on` is an app.css convention, not an app-wide one.** Components styled in `app.css`
   (`.theme-card`, `.mode-btn`, `.space-tab`) mark "active" with a literal `on` class, so a
   `:not(.on)` guard covers them. Components styled with Tailwind express active as a *different
   set of utilities* — the sidebar's space switcher uses `border-brand-400/60` with no `on` class at
   all, so `:not(.on)` sails straight past it and the accent border marking which space you are in
   gets repainted. **Tailwind components must opt out in JS**, by only adding the marker class on the
   inactive branch. Prefer opt-in markers (`.btn-edge`) over matching elements globally.

Also note Tailwind's ring utilities are box-shadow, not border: firm up a `ring-1` control by setting
**`--tw-ring-color`**, which is why the button-definition rule sets both properties.

### Where the last few bugs actually lived (pattern, not history)

Four features shipped on 2026-07-29; the defects in them clustered in three places, none of which a
typecheck or the pure-logic suite can see. Check these before declaring an appearance or editor
feature done:

1. **A control that writes state nothing reads** — or that something later overrides. Trace the value
   from the click to the pixel: settings → IPC → `normalizeSettings` (does main's copy know the new
   value?) → `applySettings` → the CSS that consumes it → what else writes that same token.
2. **A command that runs and declines to act.** `toggleMarker` on a blank line was wired perfectly and
   did nothing. "The handler fired" is not "the feature works" — exercise it in the state a user is
   actually in (empty note, empty line, no selection), not the state that makes the code path obvious.
3. **A stale process.** See the dev-server gotcha above. If behaviour contradicts the source you just
   read, suspect the running bundle before you suspect the logic.
