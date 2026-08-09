# CLAUDE.md — notes-app

## Address the user by name — every single response

Begin every response with the user's name, **Reuben** (e.g. "Reuben —" or "Sure, Reuben."). Every
session, every turn, no exceptions, however long the conversation runs. This is a deliberate
canary: if the greeting disappears, Reuben takes it as a signal that this instruction has fallen
out of context, and therefore that the rest of the output may be unreliable.

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

**Ask before adding any dependency beyond the names above.** Added since: `turndown`
(HTML->Markdown, every importer), `mammoth` (.docx -> HTML).

## Importing notes

Six formats, one pipeline. **Every source is made to produce HTML, and one converter turns that
into Markdown** — which is why a format is ~150 lines rather than the ~1,500 Obsidian's Apple Notes
importer needs:

```
Notion .zip --ditto unzip--> .html --+
Markdown .md ---------- copied verbatim, never converted (it IS the target format)
HTML files/folder -------------------+
Word .docx --mammoth--> HTML --------+--> turndown (html/turndown.ts) --> one NEW space
Google Keep Takeout .json -----------+                                    + Import Report
Apple Notes --AppleScript--> HTML ---+
```

**Adding a format is a module + one `registerImporter` call + one entry in `ImportPanel`'s
`FORMATS`.** Nothing else. The dropdown asks main which formats are *registered* (`import:formats`),
so availability can't drift from reality — that is how Apple Notes is macOS-only without the
renderer knowing what platform it is on.

Rules learned the hard way here; breaking one has cost a rewrite each time:

- **Verify the real export against a real file before writing a parser.** Notion's "Markdown & CSV"
  export contains `.html`, not `.md`, and every source said otherwise. Apple's `account.folders()`
  returns subfolders flat as well as nested, so recursing imports them twice.
- **Child processes:** `stdio: ['ignore','pipe','pipe']`, drain BOTH pipes, always a timeout. An
  undrained stdout hung a 6-second unzip for 30+ minutes with no error. See `notionZip/extractZip.ts`.
- **macOS unzip is `ditto -x -k`, never `unzip`** — Apple's fork mangles non-ASCII filenames into
  invalid UTF-8 and then aborts the whole archive.
- **Never create-then-rename in the vault.** `syncSpaces` runs on every tree load, so a temporary
  "New folder" gets registered as a real space mid-import. `createFolder(dir, name)` /
  `createNote(dir, name)` create with the final name and auto-suffix; `renameEntry` THROWS on
  collision and one throw aborts everything.
- **An importer's writes are echo-guarded** (`markWrite`), so the watcher says nothing about them:
  after a run the renderer must explicitly reload the tree and switch to the new space
  (`SpaceActions.onOpenSpace`), or the notes are on disk and invisible.
- **turndown does not strip `<head>`/`<style>`** — an embedded print stylesheet lands in the note as
  literal CSS. `createConverter()` handles it.
- Everything lands in **one new space, never merged**; re-importing makes another space (warned
  about at preview) rather than merging. Imports preserve the source's modification time
  (`setNoteTimes`); a file's *creation* time can't be set from Node, so that still shows the import.

### What is verified, and what is not (as of 2026-08-05)

**Verified in the running app:** Notion (a real 400MB export), Word (a real .docx with images,
tables, lists), and the editor rendering — tables, inline images, clickable links, tick-boxes,
`<u>`/`<sup>`/`<mark>`, and `[1]` citations keeping their brackets.

**Built and tested only against fixtures, NOT against the user's real data:** Markdown folders,
HTML folders, Google Keep (fixture built from Google's documented Takeout schema — a real Takeout
has never been run through it), and Apple Notes (tested against notes created BY SCRIPT, which
Notes.app rewrites — it turned an injected `<a href>` into `<u>` and dropped an `<img>` — so
script-made notes are NOT representative of typed ones). Treat a first failure in any of these as
"the fixture was wrong", and go and look at the real file before changing code.

### Known limits — decided, not bugs

- **Word text colour is unrecoverable.** mammoth's run model exposes bold/italic/underline/strike/
  vertical-align/font/size/highlight and simply never parses `w:color`. Getting colour means
  parsing the .docx XML alongside mammoth.
- **Apple Notes attachments stay behind** (its scripting dictionary has no attachment-save command;
  only `open note location` and `show` exist) and **password-locked notes cannot be read** at all.
- **A file's creation time can't be set from Node**, so imports restore the *modified* time only —
  which is what the sidebar shows and sorts on. "Created" shows the import date.

### Flagged, not fixed (rule 9 — say so rather than silently leave or silently change)

- **`blockTable` re-scans the WHOLE syntax tree when the document changes**, unlike the
  viewport-scoped passes in `livePreview.ts`. A StateField can't see the viewport, and
  `blockMath.ts` already does the same, so this is inherent to block decorations rather than an
  oversight — but on a very large note it is a real cost, and it contradicts this file's own "only
  the visible viewport is decorated" claim. Narrowed 2026-08-07: it no longer rebuilds on selection
  changes at all (the table renders the same wherever the cursor is), which removed the most
  frequent trigger by a wide margin.
- **`inlineHtmlPass` keeps its tag stack across CodeMirror's disjoint visible ranges**, so an
  unclosed `<u>` could in principle pair with a `</u>` past a scroll gap. `colorPass` beside it has
  exactly the same shape; changing one of the two would be worse than leaving both consistent.
- **`ImportPanel` uses the `format` STATE for its API calls but `current` for display.** They can
  only diverge if the selected format stops being available mid-session, which can't happen today
  (the default, Notion, is always registered) — but it is a trap if a format ever becomes
  conditional.

**Apple Notes is AppleScript, not the SQLite/protobuf route** Obsidian uses. Notes.app's dictionary
gives a note's `body` as HTML, so the whole reverse-engineered-protobuf problem disappears, and it
needs only the ordinary Automation consent rather than Full Disk Access — which matters because this
app is unsigned, and TCC keys Full Disk Access on the code signature. Address Notes by **bundle id**
(`com.apple.Notes`): this app's own productName is "Notealise". macOS-only in two layers — the runtime
guard (never registered off darwin) and `__MAC_BUILD__` in `electron.vite.config.ts`, which lets
rollup drop the module from the Windows bundle. It IS dropped: verified by building with the flag
false and confirming the chunk is not emitted. The dynamic `import()` is load-bearing — a static one
would be hoisted and survive.

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
  docs/commands.md          the ONE editor-command registry — read before adding any command
  docs/decorations.md       the live-preview pass engine and its extension point
  .github/workflows/        verify.yml (every push) + release.yml (v* tags; verify gates packaging)
  src/
    main/                   MAIN PROCESS — the only code allowed to touch fs
      index.ts              app lifecycle + BrowserWindow (contextIsolation on, nodeIntegration off)
      config.ts             vault path + autoUpdate in userData/config.json (never inside the vault)
      updater.ts            the ONLY importer of electron-updater; dev + macOS guards, status push
      vault.ts              path boundary + all fs ops (list/read/atomic-write/create/rename/bin)
      workspace.ts          .mdnotes/workspace.json: order/pins/archive/bin (debounced, atomic)
      settings.ts           .mdnotes/settings.json (spaces + globals) + userData pre-paint mirror
      presets.ts            userData/presets.json — the saved-preset library, which is NOT in a
                            vault precisely because it outlives one (see "Space presets" below)
      watcher.ts            chokidar → debounced (100ms) change events, echo-guarded
      ipc.ts                ipcMain handlers + vault activation (starts the watcher)
      support.ts            bug-report mailto: link (fixed destination is still a placeholder)
      externalLinks.ts      shell.openExternal, guarded by SCHEME (http/https/mailto) not host
      importers/            note import — see "Importing notes" below
        types.ts            ImportRunner + registry + the cancel flag
        files.ts            expand a picked folder/files into a list, keeping folder paths
        space.ts            the one new space every import lands in
        report.ts           the Import Report note
        duplicates.ts       "these already exist in your vault" warning
        assets.ts           copy a local image next to its note
        html/turndown.ts    THE HTML->Markdown converter every format ends in
        notionZip/ markdown/ html/ word/ googleKeep/ appleNotes/   one folder per format
    preload/
      index.ts              contextBridge → window.api (typed VaultApi)
      index.d.ts            augments Window with `api`
    shared/                 contract imported by main, preload, renderer
      types.ts              TreeNode, VaultChange, VaultApi
      links.ts              [[wiki links]]: parse, resolve, index, rewrite (main AND renderer)
      color.ts              entry colours: hex validation (main) + hsv/contrast maths (renderer)
      workspace.ts          EntryMeta / TrashItem / Workspace + normalise + path re-keying
      presets.ts            SpacePreset / SpaceLook + normalise. Shared for the same reason
                            links.ts and color.ts are: main writes these files, the renderer
                            mirrors and applies them, and two definitions would drift
      update.ts             UpdateStatus / UpdatePrefs contract + normalise
      channels.ts           IPC channel names
    renderer/
      index.html            renderer entry
      src/                  React UI: App (tabs + panes) + Sidebar (the whole aside)
        Sidebar.tsx         header/archive toggle, nav bar, pinned, archive & bin views, bottom strip
        TreeView.tsx        the row renderers: 2-line rows, multi-select, drag-reorder
        tabs/               open notes as tabs + the 1–3 side-by-side panes
                            model.ts (pure layout arithmetic), TabStrip.tsx, NotePane.tsx
        dev/browserApi.ts   DEV ONLY: a localStorage stand-in for window.api so the real
                            renderer also runs at localhost:5173 in a browser (see rule 8)
        organise/model.ts   pure derivation: sorting, archive inheritance, pinned hoisting,
                            colorOf (nearest coloured ancestor) + siblingColors
        color/Picker.tsx    the sv square + hue slider + hex field, and the anchored popover
                            the sidebar opens (portalled — see the fixed-position gotcha)
        links/              the note graph: model.ts (outgoing/backlinks/crumbs) + LinksBlock.tsx
        PathBar.tsx         Space › Folder › Note above the tabs; clicking a crumb steers the tree
        settings/           Settings.tsx (genie window + nav; General = startup/formatting),
                            Customisation.tsx (every space at once), SpaceForm.tsx (THE per-space
                            form, rendered by both whole-app and one-space scope),
                            Spaces.tsx (the space tabs + that form),
                            Presets.tsx (the saved-preset library — the disclosure under a
                            space's emoji row, and the space tabs' drop target),
                            SourceFolder.tsx (the vault path + switch), Collection.tsx,
                            tutorials/ (an index one click deep: index.tsx + LinkingGuide.tsx),
                            SpaceColour.tsx (the Colour section inside SpaceForm),
                            primitives.tsx (SettingRow/Select/Switch/ToggleRow), model.ts (applySettings)
        Tooltip.tsx         the app's own `data-tip` tooltips — NOT the HTML `title` attribute
        HoverCard.tsx       the richer hover card (links, note timestamps), portalled to body
        editor/             CM6 setup, format bar + THE command registry (commands.tsx — see
                            docs/commands.md); wikiPass/linkEnv/linkGestures are the link layer
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

`dev` opens a native **Electron window**. It *also* serves the renderer at **localhost:5173**, and
since 2026-07-31 that URL boots: `renderer/src/dev/browserApi.ts` fakes `window.api` against
localStorage when there's no preload bridge, so the same UI can be looked at in a browser. It is a
**preview, not a target** — a production build drops it, it edits a fake vault, and no feature may
be built against it (rule 8's whole point). Anything touching real files, IPC or updates still has
to be judged in the Electron window.

**Tests are `vitest`, and cover pure logic only** (`*.test.ts` beside the module): `colorModel`,
`editor/formatModel`, `editor/formatCommands`, `organise/model`, `tabs/model`, `shared/workspace`,
`shared/settings`, `shared/presets`, `shared/update`, `main/filenames`. No React and no Electron — those need a
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

**"Log that" / "log that change" (or close wording) is a two-part default, not just the changelog
line.** Reuben says this right before clearing the chat, so treat it as the session-end ritual:

1. Append the one-line entry to `CHANGELOG.md`'s `Unreleased`, as above, for the feature/change just
   built and verified in the live Electron app.
2. **Scan the conversation for anything worth keeping that lives outside the diff** — a decision, a
   constraint, a "cost a rewrite" gotcha, a rule the user stated out loud — and fold anything that
   qualifies into this file before the context clears, since git history and the code itself won't
   carry the *why*. If nothing in the conversation clears that bar, say so rather than skipping the
   check silently.

Do both halves without being asked separately; that's the whole point of the shorthand.

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

**Renaming the product (`productName` and/or `appId` in `electron-builder.yml`) breaks
auto-update for already-installed copies, and is not a code bug.** Confirmed on v0.8.0's
Notes→Notealise rename (2026-08-09): electron-builder derives the Windows NSIS per-user registry
GUID from `appId`, so a build with a new `appId` is NOT recognized as an upgrade of the old
install — it silently adds a **second** Add/Remove Programs entry alongside the old one, and both
entries' uninstallers point at the SAME shared install folder (the folder name tracked the npm
`name` field, not `productName`, so it didn't change). Left alone, uninstalling the stale old entry
deletes that shared folder and takes the new install down with it. After any rename release: check
`HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*` for a stale entry with the old
`DisplayName`, delete that key and its `Uninstall <old name>.exe` stub, and leave the new entry
alone. Also: installs on OTHER machines will not silently update themselves across a rename — they
need a manual reinstall of the new installer. Auto-update resumes normally on the release after
that, once `appId` is stable again.

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

**Tabs and split panes (built 2026-07-31).** Several notes are open at once: a strip of tabs
across the top of the editor area, and **1–3 panes side by side** below it. Drag a tab onto a
pane's left/right edge to split, onto its middle to replace what that pane shows.

**The gestures, and why they are what they are** (revised 2026-07-31 after first use):
- **A plain sidebar click replaces what's open** (`replaceActive`), exactly as it did before tabs
  existed. Tabs do not accumulate behind your back, and **the strip only appears at the second
  tab** — one open note is not a set of tabs, and a permanent one-tab strip would just repeat the
  title already in the pane header.
- **Cmd/Ctrl+click opens a note in another tab.** That gesture used to add a row to the sidebar
  *selection*. It no longer clears the selection either — see the mode below.
- **Selecting (for drag, archive, bin) is a MODE, entered by the six-dot grip** (revised
  2026-08-03). The grip click is the only one that has to hit the dots: **once anything is
  selected, a plain click anywhere on any row toggles that row in or out of the set** — rows and
  folders alike. Before this, every subsequent pick meant hitting a 16px target, which is the
  friction that made multi-select not worth reaching for.
  Two things fall out of it and both are deliberate:
  - **The folder chevron still expands** (it stops propagation) — you frequently have to open a
    folder to reach the subnotes you are selecting. The folder's *name* selects, like the rest of
    the row.
  - **The mode ends on Escape or the Clear button only.** Clicking the sidebar background does
    NOT clear any more: in this mode a click on a row selects, so the background is one slip away
    from every row, and losing a set built over a dozen clicks to a near-miss is the exact failure
    this mode exists to remove. Completing an action (a drag-move, bin, archive) still ends it —
    finishing the job is not the same as backing out of it.
  The selection bar (`Sidebar.tsx`) therefore appears at **one** item, not two: it is what tells you
  the sidebar has changed mode, and it carries the only exit besides Escape.
`tabs/model.ts` holds all of it as pure functions over `{ tabs, panes, focus }` and enforces two
invariants the UI leans on: every pane shows an open tab, and **no note is in two panes at once**
— one file must never have two CodeMirrors and two autosave buffers. Everything else follows from
that (cycling skips notes already on screen; dropping a visible tab onto another pane *moves* it
and collapses the pane it left; `MAX_PANES = 3`).
**The chrome is two fixed rows, and they never appear or disappear** (2026-07-31, by the user's
call): the tab strip — shown even with one tab, or none, held open by an invisible tab so an empty
strip is exactly as tall as a full one — and below it ONE row per pane carrying the note's name,
the format commands and, at the right, the word count and the **split button**. Splitting is a
control now, not only `Cmd/Ctrl+\` and the drag (**all three work** — dragging a tab to an edge
puts *that* note in a new column; the button and the shortcut open an empty one and ask). With nothing open, App renders the same
row shell inert (`ROW_CLASS`, shared with `NotePane` precisely so the two can't drift in height).
The rule to keep: **nothing in the editor chrome may be conditional on state in a way that changes
its height** — reserve the space, fill it later. That is why the focused-pane accent line is a
transparent `border-t-2` in every state, and why the row's layout flips which element is elastic
instead of dropping one: wide, the title grows and the commands centre; narrow, the title is fixed
at 5.5rem and the commands take the rest and scroll (`compact`). What a narrow column *does* drop
is anything that can't act: empty "?" slots, the word count, and a split button with no second
note to split to.

**Two ways to rearrange, and they are different things.** Dragging a **tab** out of the strip
opens/moves a note (edge = split, middle = replace). Dragging a **column by its own row** only
rearranges what is already on screen: onto an edge it moves there (`movePane`), onto the middle of
another column the two swap (`swapPanes`) — nothing opens, nothing closes, the strip doesn't
change. `Drag` (kind `'tab' | 'pane'`) is what tells the drop handler which of the two it is; the
row guards its `dragStart` against the title input and the buttons so a drag that starts there
stays theirs.

**The blank column, and why "+" and split are the same thing.** `BLANK` is the empty path, and a
blank tab is genuinely just a tab whose path is `''` — it closes, drags, takes the focused pane and
is *replaced in place* by the next note you click, all through the same functions as any other tab,
with no parallel "pending" state to keep in step. **"+" opens one in the focused column**
(`openTab`, so the note that was there stays as a tab); **the split button and `Cmd/Ctrl+\` open
one in a NEW column** (`splitBlank`). Either way it says "Select a note", and any sidebar row, any
tab, a new note, `Ctrl+Tab` — every route that opens a note — fills it, because they all end in
`openTab`/`replaceActive` and the blank is what those replace.

Three rules make it behave, and each was a bug first:
- **Invariant 3** (`tidy`): a blank exists only while a pane shows it. Cycling or jumping away from
  an unfilled blank leaves no orphan placeholder in the strip.
- **A blank's column collapses when the blank goes** — it does NOT take the next open tab the way a
  real note's pane does (`closeTab`). Backfilling would drop a note you didn't ask for into a space
  you opened for one you did. The exception is the last pane, where collapsing would leave the
  strip pointing at an empty screen.
- **`replaceActive`**: pick a note that is *already on screen* and focus moves to that column while
  the blank closes — it was a standing request, and the request has been answered.

It never survives a quit (`normalizeSession` drops empty strings), only one can exist at a time
(invariant 2 gives that free), and `loadDoc`/`dropDoc` skip it; nothing else in App knows it exists.

**There is no Edit/Read toggle** — removed 2026-07-31. Live preview already renders as you type and
reveals the source on the line the cursor is on, so a reading *mode* was a second way to look at
the same thing. `reader/ReadingView.tsx` (marked + dompurify) is therefore **unimported**: left in
place, not deleted, because it is the app's only sanitised-HTML path and deleting it would also
strand `marked`/`dompurify` — say so before removing either. Nothing imports it, so it is not in
the bundle.

**The layout survives a quit.** `AppSettings.session` (`{ tabs, panes, focus }`, in
`.mdnotes/settings.json`) is written 400ms after any layout change and put back at boot — and on
"Switch folder" too, so each vault reopens its own tabs. **`session` replaced `lastNotePath`**,
which a pre-tabs settings.json is migrated from *inside `normalizeSettings`* (a remembered note is
a one-tab session), the same one-code-path rule the Spaces migration follows. Validation is split
deliberately: `shared/settings.ts` checks the **shape** (strings, an integer), and
`restoreLayout` checks the **meaning** against the tree — dropping notes renamed or binned since,
de-duplicating, capping panes — because only the renderer can see whether a path still exists.
Two things follow from that: an empty session must boot to the blank screen, and the persist
effect must not run until the restore has (`sessionReady`), or the first render would overwrite
the session it is restoring.
`startup` still governs it, and its default is now **`'last'`** ("Reopen your tabs"): with tabs,
"start empty" throws away an arrangement rather than one note.
Each pane owns its own title, format bar and CodeMirror (`NotePane.tsx`);
App owns the documents (`docsRef` keyed by path) and one autosave map keyed by path. **Every
layout change goes through `applyLayout`** — that is where a note that just left the strip gets
its unsaved buffer written and its loaded copy dropped, so "which notes are loaded" can't drift
from "which notes are open"; it also keeps `layoutRef` correct for the handler that runs next,
before React has re-rendered. **The
keyboard is the renderer's**, not the menu's — `Ctrl+Tab` cycles (Cmd+Tab is the macOS app
switcher), `Cmd/Ctrl+1…9` jumps, `Cmd/Ctrl+\` opens an empty column, `Cmd/Ctrl+W` closes a tab. That last one
cost a change in `main/menu.ts`: a menu accelerator is consumed before the renderer sees the key,
so macOS's stock Cmd+W ("Close Window", in both File and the Window menu) had to move to
Shift+Cmd+W. If a tab shortcut ever stops firing, suspect a menu item took the key.

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
space, not at the vault root** (`inSpace()` in `App.tsx`). Cap is **10**, so the switcher stays
glanceable rather than a crowded strip. It wraps like ordinary text — same-size emoji buttons,
however many fit the sidebar's current width per row — rather than a fixed count per row; a wider
sidebar fits more on one line, a narrower one wraps sooner. The switcher itself is a horizontal
strip in the sidebar footer, above "Switch folder".

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

**Space presets — the saved-preset library (built 2026-08-06).** `spaces` lives in
`<vault>/.mdnotes/settings.json`, per vault. That is right by rule 2 and it had one bad
consequence: **changing source folder wiped every space you had set up**, because the new folder's
settings.json has no spaces and `reconcileSpaces` adopts its top-level folders as fresh defaults.
The library is the fix. `shared/presets.ts` · `main/presets.ts` · `settings/Presets.tsx`.

- **It is stored IN THE APP — `userData/presets.json` — never in a vault**, and that is the whole
  design, not a storage detail. Rule 2's userData exceptions are the things that are properties of
  *this install*; a library whose entire purpose is to outlive the open vault is the sharpest case
  there is. A library kept in a vault is lost the moment you point the app elsewhere, which is the
  bug it exists to fix.
- **Do not reinstate the "master vault" version.** For a few hours the library was
  `<master>/.mdnotes/presets/*.json` with the master nominated in `config.json`, plus a "bring these
  with you?" prompt on switching folders. It failed on its first real folder switch, and the reason
  is worth keeping: **with no master pinned yet, the master defaulted to whichever vault was open**,
  so switching folders silently moved it too — `here` was always true, the prompt never fired, and
  nothing followed the user anywhere. The feature was inert until an explicit action that nothing
  ever prompted for. There is no such state now: one library, one place, always. Gone with it:
  `presetsVault`, `presetsDeclined`, `adoptPresets`, `leavePresets`, `PresetsInfo`, `PresetMovePrompt`.
- **The trade, accepted deliberately:** the library no longer travels with a vault, so it does not
  sync between two machines through OneDrive the way the vault does. "Survives a folder switch" is
  what was asked for, and a library that can be left behind survives nothing. An export/import is
  the answer if cross-machine ever matters — not a second storage location.
- **There is no "save preset" button, by decision.** Every space mirrors itself into the library —
  written when the space is created, rewritten (debounced 800ms) whenever anything about it changes.
  So a preset is never stale and there is nothing to remember to press. The mirror **only ever
  writes**: a preset whose space is gone is the feature working, not litter. Deleting one is
  explicit.
- **A preset is a MIRROR, not a source of truth** — the same relationship `theme-cache.json` has
  with the theme. settings.json remains the answer for the open vault.
- **Identity is (name, origin), never name alone.** Two vaults can each hold a "Revision" space and
  those are different looks. `origin` is the vault's **folder name**, never its path — the same
  OneDrive vault is `D:\Notes` on Windows and `/Users/…/Notes` on the Mac. `id` is a random handle
  for the UI and is deliberately NOT the identity: matching on it would make each sync append a
  second row for a space that already has one.
- **Where it sits in the UI, and why:** a `Disclosure` labelled **Saved presets**, directly under
  that space's Name and Representational-emoji rows in Settings → Spaces. It was briefly a section
  at the top of the page; that put a list of looks above the settings you actually opened the page
  to change. Folded under the identity rows it is one click away and out of the way. It is the one
  SHARED thing in a per-space section, so that section's intro says so out loud — a heading reading
  "everything below belongs to this space alone" directly above a shared library is the kind of
  small lie that gets reported as a bug later.
- **The list is grouped by folder**: the open folder's spaces first, then "From other folders". The
  library gains a row per space per vault ever opened, so a flat list buries what is relevant now.
- **Pouring a look onto a space never touches the folder:** drag a preset row onto a space tab, or
  use its "Use on…" menu — which is not a nicety, since drag-only is unusable from a keyboard, and
  it carries the two things a drag can't express ("All N spaces", and "new space called X").
  `withSpacePatch` re-pins `folder` last, which is what makes "only the look moves" true rather than
  merely intended. **Apply-to-all is ONE settings write**, not a loop: each `setSettings` is a full
  read-modify-write of settings.json, so a loop would rewrite the file once per space and repaint
  between each.
- **Applying is selective** (`pickLook`): tick boxes for Appearance / Colour / Arranging / Note
  chrome / Format buttons, remembered for the session in a module-scope `lastParts` — deliberately
  not persisted, because it is the shape of the action you are about to take, like a selection, and
  the settings rule has no home for it. **A DRAG copies the whole look** regardless: there are no
  tick boxes on a drag, so it must mean one predictable thing rather than inheriting whatever was
  last ticked in a menu the user may never have opened.
  `presets.test.ts` pins that the five groups cover `SpaceLook` **exactly once each** — a field in
  no group could never be copied by any combination of ticks, and a field in two couldn't be
  excluded. Adding a key to `Space` fails that test rather than silently going missing.
- **Deleting a space offers to take its preset with it** — a tick box that appears only once the
  two-step delete is armed, and only when there is one, unticked by default. The library outliving a
  folder is the point of it, so throwing a look away has to be asked for. The preset is removed only
  after the folder actually went.
- **Presets are shareable files** (`.mdpreset`, JSON inside, `{kind, version, presets: []}`): export
  one from its row, or the whole library, and import by picker **or by dropping the file on the
  library**. One file shape covers both, because it always holds a list — so import never has to
  know which button wrote it.
  **Export strips `origin`, `id` and `savedAt`**: `origin` is a folder name off the exporter's own
  disk and must not travel to whoever they send it to. An import lands with `origin: ''` and reads
  as "Imported", which also makes it **frozen** — the mirror matches on (name, origin) with origin
  always a real folder name, so a space that happens to share its name can never overwrite it.
  **Imports always ADD, never overwrite**, and same-named arrivals are suffixed: a look someone sent
  you must not be able to silently replace one of yours.
  The drop reads the file in the RENDERER (`File.text()`) and passes the text to main — Electron
  removed `File.path`, and `webUtils` is a whole extra bridge surface for something the drop event
  already hands over.
  `PresetImportResult.cancelled` is separate from `added: 0` on purpose: "nothing in that file" and
  "you closed the picker" are different messages.
- **`SpaceLook = Omit<Space, 'folder'>`**, and `normalizeLook` runs it through the same
  `normalizeSpace` settings.json uses — a new key on `Space` must not validate in one place and not
  the other. A preset can never fail to load: unknown keys dropped, missing ones defaulted.
- Two traps already paid for, both invisible to a typecheck: the mirror must **wait for `vault` and
  `settings` to agree** (`settingsVault`), since `vault` is set at the start of a switch and the
  settings land several awaits later — mirroring in that window files the old vault's spaces under
  the new vault's name; and both sides of "has this look changed?" must compare with **`lookKey`**,
  not a raw `JSON.stringify`, or a key-order difference between a look rebuilt on read and one built
  in the renderer rewrites the whole library on every sync.

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
- **One command registry (built 2026-08-01).** `editor/commands.tsx` is the ONLY list of editor
  commands. The programmable format-bar buttons, the picker in Settings → Spaces → Shortcuts, and
  the `/` menu all read it, so **a command added there appears in all three with no second edit**.
  Before this there were two catalogues that reimplemented the same nine commands with different
  code and no shared ids; four commands existed on a button but not under `/`, and nothing said so.
  **Read `docs/commands.md` before adding a command** — it covers the `run(view, slash?)` contract
  (a `/` invocation must delete its own typed query, and *sets* a marker where a button *toggles*
  one), why ids are a file format, and why `commands.test.ts` pins them.
- **Note links (built 2026-08-01).** `[[Note name]]`, `[[Folder/Note]]`, `[[Note|alias]]`,
  `[[Note#Heading]]` and `[[#Heading]]`. Plain Markdown that other editors render as text, never an
  invented delimiter (rule 4). The parser/resolver is `shared/links.ts` — **shared because both
  processes parse**: main scans the vault for the backlink index, the renderer scans the buffer you
  are typing in, and two parsers would drift. It knows about code spans and fences itself, since
  main has no syntax tree; the editor pass keeps `inCode()` as well.
  A bare `[[Waves]]` matching several notes resolves by a fixed ladder — sibling, then nearest
  common ancestor, then alphabetically — so the answer never depends on tree order, and the link is
  marked ambiguous rather than silently guessed at.
  **A folder is a link target too** (`[[Term 3]]`), and carries a folder icon where a note carries
  a page one — a vault you cannot reference a folder in is a filing system you cannot talk about. A
  folder has nothing to open, so clicking one SHOWS it: the sidebar opens it and closes the rest,
  exactly as the path bar's crumbs do. A note beats a folder of the same name; the folder is still
  reachable by its path.
  **Clicking a link opens it in a NEW TAB** — the opposite of the sidebar, and deliberately: following
  a link is reading onward from what you have, and losing the note that sent you there is exactly
  the wrong thing. Cmd/Ctrl+click replaces instead (inverted from the browser convention for the
  same reason), Alt+click opens a column, and a link can be dragged into any column (it carries the
  tab strip's own `application/x-notes-tab` type). Clicking one whose note doesn't exist **creates
  it**, beside the note that mentioned it, in one `createNote(dir, name)` call.
  **The `[[` picker is scoped to the space you're writing in**, and typing another space's name is
  the way out (`[[Physics/Wav`) — see `linkChoices`. A vault divided into spaces is divided for a
  reason, and a picker listing every note in every space undoes that the moment you go to link
  something. Scoping applies only to what is OFFERED: a link already written keeps resolving
  wherever it points, which is what the cross-space marking is for.
  Renaming a note rewrites the links that pointed at it — only notes the index says actually link
  there, only links that *resolved* to it, after a `flush()`, and through `onDocChange` for notes
  that are open so the autosave owns the write. Moving a note does NOT rewrite anything: links
  resolve by title, so a move leaves them all working.
- **The links block and the path bar (built 2026-08-01).** Both are chrome; **nothing either shows
  is ever written into a note** (rule 1). The links strip sits at the top of each column — outgoing
  first, then backlinks — and **does not put the direction on the face of a link**: which way a
  connection runs is on the hover card, along with the line the link sits in, so the strip reads as
  names rather than badges. It scrolls sideways at a fixed height, because the chrome may not change
  height with what a note contains. Settings → General pins it; by default it scrolls away with the
  text (translated against the CodeMirror scroller, whose top padding follows `--links-inset` — CM
  keeps its own scroller, which is not worth restructuring for this).
  The path bar is one row for the whole editor area, following the focused column, and is
  **navigation, not a label**: clicking a folder opens it in the sidebar, closes every other folder,
  and scrolls it into view — switching space first if the note lives in another one.
  **Two settings pages, and they are not the same job.** `Settings → Linking content` holds the
  switches; `Settings → Tutorials → Linking your notes` explains the five forms, what an alias is
  for and how the space scoping works. Keep the guide in step when link behaviour changes — it is
  the only place the rules are written for someone who isn't reading this file. The nav says
  "Linking content" rather than "Links" on purpose: a link here is a relation between two things
  the user wrote, and the short word kept reading as a URL.
  **`showLinks` / `pinLinks` / `showPath` / `showNoteInfo` belong to a SPACE**, not the app: how a set of notes reads
  is a property of that set. They were global until 2026-08-02 and `normalizeSettings` migrates an
  older file by handing the top-level value down to every space (see `LegacyChrome`). The "use this
  in every space" buttons are ACTIONS that write one value across all spaces — deliberately not a
  global layer that spaces then override, because that is a precedence chain, and this app already
  has one of those (the theme layer) to be careful about.
  **The chrome reads top to bottom as three different questions**: the tab strip is which notes are
  open, the path bar is where the one you're in lives, the format bar is what you can do to it, and
  the links strip is what it connects to. Running the path and the links together is what made this
  confusing the first time; they get separate rows.
  **One hover card, portalled to `document.body`.** `HoverCard.tsx` owns the placement — directly
  under whatever you are pointing at — and everything that shows detail on hover goes through it:
  the link inspector (a chip in the links strip OR a `[[link]]` in the text) and a note's
  timestamps. Native `title` tooltips are deliberately not used for any of it, because the OS parks
  them at the cursor after a delay it chooses, which is neither under the thing nor consistent
  between two places in the same window. The portal is NOT optional: the strip carries a `transform` (it slides
  away as you scroll) and a `backdrop-filter`, and **either makes that element the containing block
  for a `position: fixed` descendant** — which put the card hundreds of pixels from the link it
  described. Same trap as the settings modal and the sidebar; if you add another floating thing,
  portal it. In-text links carry no `title` attribute for the same reason a native tooltip was
  wrong: the OS puts it at the cursor after a delay it chooses.
  **`showNoteInfo` puts "Last edited <date> at <time>" beside the word count**, on the machine's own
  clock (the Formatting page's timezone, "system" by default). Only the edited time is on the row —
  it is the one that changes and the one you look for; **when the note was created is on the hover
  card**, with both dates spelled out in full rather than as "Today". The times come from a
  `fs.stat` per note in main's tree walk (`TreeNode.createdAt` / `updatedAt`, epoch ms, both
  optional — not every filesystem records a creation time, and `formatDate` returns null rather
  than 1970). They refresh with the tree, so an edit made in another app updates "last edited"
  without anything extra. Both are hidden in a split, where the word count goes too.
- **Entry colours (built 2026-08-03).** A note or folder can be tagged with a colour in the
  sidebar. **The colour is a property of the ENTRY, so it lives in `workspace.json`**
  (`EntryMeta.color`, a `#rrggbb`) beside its pin and its order — which is also what re-keys it for
  free when the entry is renamed or moved (`migrateKey`), and what makes it losable per rule 2. It
  reuses `updateEntries`; there is no new IPC channel, and clearing is `{ color: undefined }`, the
  same merge-drops-undefined trick un-archiving already uses for `archivedAt`.
  **A raw hex here is deliberate, and does NOT contradict rule 4.** Rule 4 governs what is written
  *into a note*, where a baked hex cannot follow the theme and would not survive Obsidian — hence
  `editor/palette.ts`'s named `hl`/`tc` classes. An entry colour is never written into a `.md` file;
  it is chrome, and the user picking the exact colour they mean is the whole feature. The contrast
  work that a named palette would otherwise do is in `shared/color.ts`'s `inkOn` instead.
  `shared/color.ts` is shared for the same reason `links.ts` is: **main validates with the code the
  renderer paints with**, so "what is a valid colour" has one definition.
  **Inheritance is NEAREST ancestor, not any** (`colorOf`) — the opposite of `isArchived` beside it,
  and on purpose: archive is a flag that can only be turned on, so any/nearest agree, but colouring
  `Revision` blue and `Revision/Physics` green has to mean the physics notes are green.
  Per-space (so Customisation sets it for all, per the settings rule below):
  `colorStyle` — `tag` (the six-dot grip becomes the chip) / `row` (a low-alpha wash + leading edge)
  / `solid` (the row IS the colour) — plus `colorInherit`, `colorAuto`, `colorPalette`.
  **`solid` is the only style that restates the row's text colours**, because at full strength the
  theme's ink ramp is meaningless — it was chosen against `--paper`, not against a colour the user
  picked — so everything switches to `--row-ink`. Its rules use the DIRECT-child combinator so the
  hover-action group, a floating panel with its own `bg-surface/95`, keeps the theme's colours
  without needing a `:not()` that names it.
  **Switching `colorAuto` ON also colours the folders you already have** (`autoColorPlan` →
  `SpaceActions.onColorExistingFolders`), scoped to the space, or to every space from Customisation.
  A setting whose promise is "folders look different from each other" that changed nothing visible
  read as broken. Folders with a colour of their own are never touched.
  **Two painted rows never share an edge.** A painted row's background stops
  `--row-gutter` short top and bottom (per-density, theme.css) so the sidebar shows between them —
  flush, a run of coloured rows reads as one striped block rather than as rows. It is a
  **transparent border + `background-clip: padding-box`, not a margin**: a margin would make a
  coloured row taller than an uncoloured one, so the density variables would stop describing one row
  height. The row gives the gutter out of padding it already has, which is why `--row-gutter` is
  capped below `--row-py` (a negative padding invalidates the declaration outright).
  Two consequences: an **inset** box-shadow is clipped to the padding box so the leading edge bar and
  the selection ring align for free, and **every ring on a painted row is an inset box-shadow, never
  `outline`** (fixed 2026-08-08). `outline` was tried first with a matching negative
  `outline-offset: calc(-1px - var(--row-gutter))` to sit inside the colour, and the offset alone
  looked right in isolation — but `outline` does not shrink its corner radius to match a negative
  offset, so on these stadium-rounded rows the ring's corners stayed at the *outer* radius while the
  ring itself moved inward, pulling away from the fill at the rounded ends and leaving a visible
  crescent of colour there (worse at higher density, where `--row-radius` is larger relative to
  `--row-gutter`). An inset box-shadow's corners shrink together with its offset, so it stays flush at
  every density with no extra math. Every combination of `.tint-row`/`.tint-solid` with `.is-open`
  and/or `.row-picked` therefore needs its own rule spelling out the full `box-shadow` value — the
  property doesn't merge across separate selectors of equal specificity the way `outline` (a distinct
  property from `box-shadow`) could sit alongside `row-picked`'s box-shadow for free. And every painted
  rule sets `background-color`, **never the `background` shorthand — the shorthand resets
  `background-clip` to `border-box`** and silently undoes the whole thing from a line that looks like
  it only picks a colour. That one cost a debugging pass: the border and padding were right in the
  computed styles and the gap just wasn't there.
  The paint is `.tint-tag` / `.tint-row` / `.tint-solid` in `app.css`,
  fed by two inline custom properties — `--row-rgb` and `--row-ink` — because the value is user
  data while the styling stays in the stylesheet (rule 5). **`rowClass` opts out of
  `hover:bg-surface/70` in JS when a row is washed**: a utility and an app.css rule at equal
  specificity would be settled by source order, which is exactly the drift the Tailwind section
  below warns about.
  `colorAuto` colours a **folder** on creation and never a note — notes inherit, and colouring each
  one individually makes the sidebar louder, not clearer. `pickAutoColor` picks among the
  *least-used* sibling colours rather than uniformly at random, because uniform random repeats the
  neighbour often enough to defeat the point of the feature.
  Two ways in, matching the pin/bin precedent: the swatch in a row's hover actions, and
  **right-click → Colour…**. Both open the one `ColorPopover`, which App owns and portals to
  `document.body` — four TreeViews are on screen and the sidebar's `backdrop-blur` would otherwise
  become its containing block. Not painted in the archive/bin shelf views or in search results.
- **Editable tables (built 2026-08-07).** A table is drawn as a table *always* — it used to revert
  to `| --- |` source whenever the selection touched it, which is the complaint the feature was
  rebuilt to answer. Click a cell to edit it, Tab between cells, hover for the strips that add and
  remove rows/columns (drag the `+` for several), and set a column's alignment from its heading.
  `tableModel.ts` is pure and unit-tested because it is **the only code in the app that rewrites a
  block of a note from a structure held in memory**. Three things it must never get wrong, each a
  file-corrupting bug otherwise: an empty cell produces **no `TableCell` node at all**, so rows are
  read by slicing the line rather than walking the tree; `---` and `:---` are different bytes and
  only one of them is something the user wrote; and a line written directly under a table **is a row
  of that table** per GFM, which is why `/table` leaves a blank line after itself. See
  `docs/decorations.md`.
- **Markdown pro / raw view (built 2026-08-07).** A per-space setting puts a button in the
  bottom-right of a note that shows the file as it really is. Implemented as a `Facet` read by every
  decoration producer, swapped through a `Compartment` so toggling keeps the cursor, scroll and undo
  history. **Which notes are raw is per-note state in `workspace.json`** (`EntryMeta.rawView`),
  beside the pin and the colour — re-keyed on rename for free, and losable like the rest of it.
  Styling is deliberately untouched: bold stays bold, only the marks come back.
- **Remaining editor live-preview** (lists beyond the bullet) — a new decoration
  pass in `livePreview.ts` (see `docs/decorations.md`). Fenced code blocks and multi-line `$$`
  math are done as of 2026-07-28; images (`imagePass`) as of 2026-08-07.

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
- **Sidebar folder expansion is one `Set<string>` owned by `Sidebar.tsx`**, passed to all four
  `TreeView`s through `commonTreeProps`. It used to be per-instance state XOR'd against
  `workspace.json`'s `collapsed` flag, which meant membership in the set did NOT mean "expanded" and
  the same folder toggled independently in the pinned tree and the main one. Neither survives the
  path bar's "open this folder and close every other one", which needs one answer for the whole
  sidebar. Still not persisted — that is unchanged, only the representation moved.
  **`EntryMeta.collapsed` in `workspace.json` is now read by nothing** (it was only ever read by
  that XOR, and has never been written by anything). Flagged, not removed — see rule 9.
- **CDP mouse and keyboard input do not reach this Electron renderer.** `page.mouse.click` /
  `page.keyboard.type` produce no events at all — not even at `document` in the capture phase — so a
  gesture that "does nothing" under puppeteer may be perfectly fine. Drive the UI with synthetic
  events from `page.evaluate` instead: `new MouseEvent('mousedown', {bubbles, cancelable, composed,
  clientX, clientY, metaKey…})` for the editor, `element.click()` for React buttons, and
  `document.execCommand('insertText', …)` to type into CodeMirror (it handles `beforeinput`).
  React delegates `onMouseEnter`/`onBlur` from **`mouseover`/`focusout`**, so dispatching
  `mouseenter`/`blur` silently does nothing.
- **The working directory persists across Bash *and* PowerShell tool calls, including a `cd` from a
  different tool.** A `cd .../notes-app/legacy` in one call left `npm --prefix ".\notes-app" run dev`
  resolving to `notes-app/legacy/notes-app/package.json` (ENOENT, exit 38). The relative `--prefix`
  in the Commands section above assumes cwd is the projects root. **In an agent session, pass an
  absolute `--prefix`.**

- **`grep` treats `App.tsx` as a binary file, and silently reports nothing.** It contains a real
  NUL character — `.join('\0')`, the separator for the open-note link-target signature — and one
  NUL is all `grep` needs to switch to "Binary file matches" mode, which with a plain `grep -n`
  prints *no lines at all* and exits 1. So `grep -n "window.api" src/renderer/src/App.tsx` looks
  exactly like "App.tsx doesn't call the API", which is the opposite of true. **Use `grep -a`** on
  this file (`rg` is unaffected).
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
- **Running it on the MacBook: there are deliberately TWO copies.** The project is in OneDrive and
  so is `node_modules`, and that install is **Windows** (`electron.exe`, `@rollup/rollup-win32-*`,
  `@typescript/typescript-win32-x64`). `npm install` in there swaps them for darwin binaries,
  OneDrive syncs that to the Windows machine, and `npm run dev` breaks over there until it is
  reinstalled — every platform switch, in both directions. So the Mac builds from
  **`~/notes-app-mac`**, a copy with its own macOS `node_modules`, and the OneDrive copy stays the
  source of truth for editing and committing. `~/notes-app-mac/run-mac.sh` rsyncs the source across
  (excluding `node_modules`/`out`/`release`/`.git`) and starts the app; **run it again after any
  change**, because the dev server is watching the copy, not the original. Node itself is a
  no-admin tarball at `~/.local/opt/node` and is not on `PATH` — the script prepends it. Verified
  2026-08-06: typecheck clean, 340 tests pass, `src/` lints clean (the oxlint warnings are all in
  read-only `legacy/`).
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

### Tabs belong to a space

Each space keeps its own tab strip and split. Switching space stashes the current layout under the
space you're leaving and applies the one you're going to (`spaceTabs` in App) — the notes stay
open, they're just not on screen, because **a strip showing notes the sidebar beside it doesn't
have is the confusing part**. Two consequences worth knowing:

- The swap is **explicit**, in `switchSpace`, not an effect keyed on the active folder. Following a
  cross-space link both switches space and opens a note, and an effect-driven swap would race that
  — the note would land in the layout of the space it just left.
- **A restored session is filtered by space too** (`restoreSession`). A saved session can carry
  tabs from a space you left, and reopening them into whichever space is active reproduces exactly
  the confusion this avoids. Notes loose at the vault root belong to no space and come back in all
  of them.

`spaceTabs` is in memory only. `settings.session` remembers the space you were in, which is the one
you return to; the other spaces open empty and fill as you use them.

### Tooltips are `data-tip`, never `title`

Every hover label in the renderer uses a `data-tip` attribute, picked up by the single `<Tooltip/>`
mounted in App. **Do not reach for the HTML `title` attribute** — all three of its failures were
reported as bugs by the user on 2026-08-02:

1. **It goes stale.** The OS renders the text once and keeps showing it until the pointer leaves, so
   toggling a control while hovering it left the sentence describing the state you just left. The
   search bar's "Searching titles only" and the archive filter both read wrong for exactly this
   reason, though the strings in the source were correct all along.
2. **It doesn't always appear.** Split-screen and collapse-sidebar carried a `title` that never
   showed.
3. **It is a box the app can't style.** `Tooltip.tsx` renders plain text with a paper-coloured
   text-shadow instead — no border, background or panel.

The tooltip re-reads `data-tip` off the DOM on every hover *and* after a click, which is what fixes
(1). A component that takes a `title` **prop** (`TB`, `RowBtn`) keeps the prop name and emits
`data-tip` on its own button; `SettingRow`'s `title` is a heading, not a tooltip. Keep `aria-label`
wherever it already is — `data-tip` is presentation, not accessibility.

### EVERY customisation setting belongs to a space (the settings rule)

**Read this before adding any setting at all.** It decides which page the control goes on, and
getting it wrong is not cosmetic — it is the difference between a setting the user can scope and one
they can't.

**The test: is this about how the app LOOKS or what it SHOWS?** If yes, it belongs to a `Space`,
full stop — theme, accent, colour, density, arranging, a note's own chrome, the format-bar buttons.
How a *set of notes* reads is a property of that set: a revision space wants dark, dense and its
links in front of it; a journal wants none of that. **And every such setting must also be reachable
with an apply-to-all** — that half is not optional either, because "make my whole app look like
this" is the more common wish and a per-space-only control makes it seven jobs.

The two things that are NOT per-space, and the only kind of thing that may join them: **one app
launch, one locale.** Startup, `session`, dateFormat, numberFormat, timezone. `session` also has a
mechanical reason (it's written on every note open, so nesting it would rewrite the whole spaces
array each time).

The nav follows exactly that split — keep it:

- **General** — startup + formatting. App-general only. It carries a pointer to Customisation,
  because "where is the theme" is the question this page otherwise raises.
- **Customisation** (`Customisation.tsx`) — the whole-app scope: `onChange` writes the patch to
  *every* space, a "spaces differ" marker appears next to any control they disagree about (showing
  one space's answer as everyone's would be a lie), and a button jumps to Spaces.
- **Spaces → that space** — the same `SpaceForm`, `onChange` writing to that one.

`SpaceForm.tsx` is the only place a per-space setting is laid out, and it is rendered by both of the
last two — one component, so the two scopes can never offer different options or lay them out
differently.

These were one page called "Master settings" until 2026-08-03. It mixed the two categories, so
someone after the date format scrolled through the entire appearance system to reach it, and someone
after the theme had no reason to guess that "master" was where it lived.

Whole-app scope is deliberately **not** a global layer that spaces override. A value that wins over a
space's own is a precedence chain, and a control that silently does nothing because something further
down beat it is the worst bug this window can have — see the theme layer's version of that story
below.

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
