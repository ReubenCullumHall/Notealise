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

**This file holds what's relevant to almost any task here — architecture, cross-platform rules,
the settings/theme system, general gotchas.** Feature-specific build history, the release ritual,
the import pipeline, and one-off product decisions live in `docs/` instead, read on demand rather
than loaded every session — see "Where the rest of it lives" near the end of this file.

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

Six formats, one pipeline (Notion, Markdown, HTML, Word, Google Keep, Apple Notes), all converted
through one HTML→Markdown path. **Read `docs/importing-notes.md` before touching an importer** —
the pipeline diagram, the hard-won rules (child-process draining, macOS unzip, never
create-then-rename in the vault), what's verified against real user data vs. fixtures only, and
the known, decided limits (Word colour, Apple Notes attachments).

## Folder structure

```
notes-app/
  electron.vite.config.ts   electron-vite build: main / preload / renderer
  tailwind.config.js        theme ported verbatim from legacy/index.html (brand/ink ramps → tokens)
  postcss.config.js         tailwind + autoprefixer; electron-vite picks it up automatically
  tsconfig*.json            root refs + tsconfig.node.json (main+preload) / .web.json (renderer)
  package.json              scripts + deps ("main": out/main/index.js)
  dev-app-update.yml        ONLY read by NOTES_TEST_UPDATER=1 npm run dev; never packaged
  docs/
    release-checklist.md    the four gates, the release ritual, and how to recover a bad release
    commands.md             the ONE editor-command registry — read before adding any command
    decorations.md          the live-preview pass engine and its extension point
    importing-notes.md      the import pipeline, its rules, and what's verified vs. fixture-only
    feature-tabs-spaces.md  tabs/panes, Spaces, space presets — build history and decisions
    feature-organise.md     pins/archive/bin, the theme/token system's build state
    feature-editor.md       format buttons, command registry, note links, entry colours, tables
    product-rulings.md      decisions from the 2026-08-09 interview that the code has to honour
    onboarding-plan.md      the first-run onboarding plan — READ THE FLAGGED CONFLICT AT ITS TOP
    voice.md                the locked UI-copy voice rules
    appearance-research-brief.md
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
                            vault precisely because it outlives one (see docs/feature-tabs-spaces.md)
      watcher.ts            chokidar → debounced (100ms) change events, echo-guarded
      ipc.ts                ipcMain handlers + vault activation (starts the watcher)
      support.ts            bug-report mailto: link (fixed destination is still a placeholder)
      externalLinks.ts      shell.openExternal, guarded by SCHEME (http/https/mailto) not host
      importers/            note import — see docs/importing-notes.md
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
        tabs/               open notes as tabs + the 1–3 side-by-side panes — docs/feature-tabs-spaces.md
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
  site/                     the Vercel download page. site/DESIGN.md is its design directive and
                            decision log — read it before any visual change here
  tools/wordmark/           GENERATOR for the wordmark animation in site/index.html, plus its
                            verification harness and its own gotchas doc. Not shipped, not an
                            app dependency. See tools/wordmark/README.md
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

## Tracking pending changes, and the "log it" / "log that" ritual

**`CHANGELOG.md`'s `## [Unreleased]` section is the running list of what's built and verified
since the last tag** — read *that* to answer "what would a release include right now," never scan
the codebase for it. It's populated incrementally: once a feature is built AND the user has
verified it works in the **live Electron app** (`npm run dev`) — not `legacy/`, which never ships
(rule 8) — ask whether to add it to the next update or scrap it. If kept, append one line to
`Unreleased` in the same terse, user-facing style as past tag messages (e.g. "Add KaTeX inline
math rendering in the editor"). Don't log automatically and don't log on the strength of unit
tests alone — this is specifically gated on the user's own live-app check.

**When Reuben says "log it" about a feature just built, that means three things, in order — not
just the changelog line:**

1. **Append the CHANGELOG line**, as above.
2. **Work out where in the files a lesson belongs, don't just default to this file.** Ask: is this
   a rule that should change how *any* future task here is approached (→ this file, CLAUDE.md
   itself)? Is it specific to one feature area (→ that feature's `docs/*.md`, e.g.
   `feature-editor.md` for an editor bug)? Or is it a *process* lesson about how the build itself
   went, not about the code (→ memory, not a repo file at all — repo docs are for the codebase,
   memory is for how we work together)? Don't default to appending everything here just because
   it's the file already open.
3. **Name the lesson, not just the fact.** Beyond "what got built," ask what would have made this
   build faster or avoided a wrong turn — a question that should have been asked earlier, an
   assumption that cost a rewrite, a pattern in this codebase that made something easy or hard.
   If nothing clears that bar, say so rather than inventing one.

"Log that" (session-end wording) does all of the above **plus**:

4. **Scan the whole conversation for anything else worth keeping that lives outside the diff** — a
   decision, a constraint, a rule the user stated out loud — beyond just the one feature "log it"
   was about.
5. **Commit the session's work**, pathspec-scoped (2026-08-14). Reuben's default is to batch
   commits at the end of a session rather than as each piece is verified, so "log that" is also
   the commit signal. Leave genuinely undecided artefacts out (e.g. large binaries whose home
   hasn't been settled) and say what you excluded.

Do this without being asked to break it into steps separately; that's the whole point of the
shorthand. The projects-root `CLAUDE.md` carries the cross-project versions of these defaults,
plus the rule about offering an artifact when a complex task hasn't landed in 1–2 prompts.

**Shipping a release is a separate, much longer ritual — read `docs/release-checklist.md` in
full before running it.** Short version: when Reuben says "push the latest update," read
`Unreleased` first, sanity-check it against `git status` and `git log vX.Y.Z..HEAD --stat`, run the
four gates in the checklist, then bump `package.json`'s version, move `Unreleased`'s bullets under
a new `## [x.y.z] - YYYY-MM-DD` heading, and tag. The release checklist doc covers the beta
channel, the "renaming the product breaks auto-update" trap, macOS's auto-update limitation, and
how to pull back a bad release — none of that is repeated here.

## Where the rest of it lives

Everything below this point is a rule or a gotcha relevant to nearly any task in this codebase.
Deeper, narrower material moved to `docs/` on 2026-08-16 so it's read on demand instead of loaded
every session — see the table in **Folder structure** above for the full list. In particular:

- Touching **tabs, panes, or Spaces** → `docs/feature-tabs-spaces.md`
- Touching **organise (pins/archive/bin) or the theme/token system** → `docs/feature-organise.md`
- Touching **format buttons, commands, links, entry colours, or tables** → `docs/feature-editor.md`
- Touching **an importer** → `docs/importing-notes.md`
- Touching **the wordmark generator** (`tools/wordmark/`) → `tools/wordmark/README.md`, which now
  also carries the implementation-level gotchas (routing, slice geometry, retrace) that used to be
  duplicated here
- Planning **onboarding** → `docs/onboarding-plan.md` — read the flagged conflict at its top first
- A **product decision that isn't in the code** → `docs/product-rulings.md`
- **UI copy** → `docs/voice.md`

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
- **A background `npm run dev` from an earlier agent turn can outlive that turn.** Launching the
  app again later starts a *second* `electron-vite dev`, which logs "Port 5173 is in use, trying
  another one" and opens on 5174 instead — two live windows, one on stale code, with nothing in
  either log calling that out as wrong. Before trusting what a freshly-launched window shows,
  `pgrep -fl "electron-vite dev"` and kill any leftover instance (and its Electron child) rather
  than assuming the newest one is the only one.
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

When you do work here, move *toward* the rules above; never add code that deepens a gap (e.g. a
direct-`fs` call in the renderer, config written into the vault's notes, hardcoded style values).
