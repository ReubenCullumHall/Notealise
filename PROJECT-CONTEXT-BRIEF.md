# notes-app — Project Context Brief

> Purpose of this document: a complete, self-contained briefing on what you're building, so you can
> paste it into Claude Cowork (or any planning tool) and get a grounded plan for features, roadmap,
> differentiation, and go-to-market. This is descriptive context, not an implementation plan.

---

## 1. What this is, in one line

A **local-first desktop Markdown editor** where every note is a plain `.md` file in a folder you
choose on disk (the "vault"). It's a *better-feeling editor over your own files* — explicitly **not
a database that happens to export Markdown**. No accounts, no sync, no cloud.

The guiding test the project holds itself to: *delete this app and your notes are untouched and fully
usable in any other editor.*

## 2. The core product idea (the "why")

The bet is that the note-taking market splits into two unhappy camps:

- **Cloud/database apps** (Notion, Evernote, Craft): beautiful editing, but your notes live in
  *their* database. You're renting your own thinking. Export is a second-class escape hatch.
- **Plain-file apps** (Obsidian, plain VS Code): you own the files, but the editing experience is
  either power-user-complex (Obsidian) or developer-raw (VS Code).

This project aims at the gap: **the ownership and portability of plain files, with the polish and
"it just formats as I type" feel of a modern editor.** The differentiator isn't a feature — it's a
*constraint*: the files on disk are always the source of truth, and they must always degrade
gracefully into Obsidian, VS Code, and GitHub.

## 3. The headline feature — Live Preview

The signature experience is **Obsidian-style live preview** in the editor: Markdown syntax marks
(`**`, `#`, `` ` ``, `>`, `~~`, link punctuation) are *hidden* so text simply looks formatted as you
type — and the raw syntax reappears only on the line your cursor is on, so it stays editable. No
mode-switch between "write" and "preview"; formatting is ambient.

This is technically load-bearing and is why the editor choice (CodeMirror 6) is locked:
- Implemented as a CM6 `ViewPlugin` that walks the `@lezer/markdown` **syntax tree** (never regex —
  nested/escaped markdown breaks regex, the tree models it correctly).
- Styling (how bold/headings *look*) and hiding (removing the `**`) are deliberately separate
  concerns.
- Only the visible viewport is decorated, so a 10k-line note stays smooth.
- Hidden marks are registered as `atomicRanges` so arrow keys step over a hidden `**` as one unit.
- Extensible via a "passes" architecture — each Markdown construct (colour, math, etc.) is a pass
  appended to a list. (Reference: `docs/decorations.md`.)

## 4. Feature surface

**Built and working (Electron app):**
- Vault picker — choose any folder; notes stay as plain `.md` files inside it.
- File tree sidebar with folder nesting, icons, drag-to-move into folders, context menus
  (new note/folder, rename, delete-to-trash).
- CM6 editor with live preview, autosave (400ms after typing, on blur, before quit), word count.
- **Inline text colour + highlight** stored as valid CommonMark inline HTML
  (`<mark class="hl-amber">`, `<span class="tc-amber">`) — a floating selection toolbar; renders in
  Obsidian/GitHub too. Also conceals legacy `<span style="color:#hex">` forms so old notes render clean.
- **LaTeX math** via KaTeX — inline `$…$` and single-line block `$$…$$`.
- Editable note-title header that renames the underlying file (with cross-platform-safe sanitisation).
- **Edit/Read toggle** — a sanitised reading view (marked + DOMPurify + KaTeX).
- **Theme / density / accent system** — dark default + light, set in a Settings panel, persisted per
  vault. All visual values are CSS custom-property tokens (colours as `R G B` channel triples).
- Bundled fonts (Inter / Fraunces / JetBrains Mono) — no CDN dependency.
- Formatting toolbar + selection popover.

**In progress / pending (roadmap already scoped in the codebase):**
- `.mdnotes/` config maturation — window state, per-note placement (settings.json already lives here).
- **Organise features (Phase D):** pins / archive / bin / custom drag-reorder / search. Needs a
  per-vault `workspace.json` metadata sidecar (order/pinned/archived, keyed by relative path) because
  the filesystem alone only gives alphabetical order.
- **More live-preview passes:** lists beyond the bullet, tables, fenced code blocks, images,
  multi-line `$$` math (the last needs a `StateField`, not a `ViewPlugin`).
- **From the legacy prototype, not yet ported:** `/` **slash-command menu** (headings, lists, to-do,
  quote, code block, divider) and `[[wiki-link]]` autocomplete between notes; intl date/number
  formatting helpers.

## 5. Architecture & tech stack (for grounding technical plans)

**Stack:** Electron · React 19 · TypeScript · Vite (via electron-vite) · CodeMirror 6.
File watching: `chokidar`. Math: `katex`. Reading-view render: `marked` + `dompurify`. Lint: `oxlint`.
There is **no test runner configured yet** (adding one is an open decision). Dependencies are
deliberately kept minimal — new deps require explicit sign-off.

**Non-negotiable architectural rules (these shape what's easy vs. hard to build next):**
1. **Files are the source of truth.** No SQLite / IndexedDB note store / ORM / metadata DB.
2. **App config lives in `.mdnotes/` inside the vault** (mirrors Obsidian's `.obsidian/`); only the
   vault *path* lives in the OS userData. Config never goes into note frontmatter unless it's
   genuinely a property of that note.
3. **Editor is CodeMirror 6, locked** — the live-preview feature depends on its decoration system.
4. **Markdown must degrade** — anything written must open sensibly in Obsidian, VS Code, GitHub. No
   invented syntax dialects; where Markdown lacks a feature (e.g. colour), use valid inline HTML.
5. **All visual values are CSS custom properties** — no hardcoded hex/radius/shadow in components.
6. **The renderer never touches `fs`.** All disk access goes through Electron IPC to the main
   process; `src/main/vault.ts` is the only fs-touching code, and the vault root is a hard security
   boundary (every path is resolved and anything escaping the root is rejected).
7. **Windows and macOS are both first-class** — a vault written on one must open cleanly on the other.

**Cross-platform is a serious, already-solved concern** (a real engineering moat vs. a weekend clone):
POSIX-relative internal paths converted at the fs boundary; filename sanitisation for reserved
Windows device names and illegal chars; case-insensitive collision handling; CRLF/LF detection and
restoration (so files don't show as 100% changed in git); path-length warnings before Windows' 260
limit; hidden-attribute setting on `.mdnotes/`; watcher `awaitWriteFinish` + polling on UNC drives.

**Layout:** `src/main/` (process lifecycle, vault fs ops, watcher, IPC, menus) · `src/preload/`
(typed `window.api` contextBridge) · `src/shared/` (types + IPC channel contract) · `src/renderer/`
(React UI: App, TreeView, editor/, reader/, settings/, theme.css tokens).

## 6. Project history (important context)

There was a **prior browser prototype** (now in `legacy/`, reference-only, not built): Vite + React +
CM6 reaching disk via the browser File System Access API with a localStorage fallback. On
**2026-07-23** the project migrated to **Electron** to get real filesystem access, cross-platform
desktop distribution, and to escape browser sandbox limits. The legacy app holds substantial *already
designed and built* feature work (live preview, theme system, org sidebar, slash menu, wiki-links)
that is being **ported onto the new Electron/IPC foundation** — so the roadmap is partly "re-home
proven features correctly" rather than "invent from scratch."

## 7. What makes it different (positioning raw material)

- **True ownership without the raw edges.** Your notes are plain `.md` in your folder — but the app
  feels like a polished consumer product, not a developer tool.
- **Graceful degradation as a design law.** Files always stay readable in Obsidian/VS Code/GitHub.
  You're never locked in; interop is a guarantee, not a promise.
- **Ambient formatting (live preview)** without a preview/edit mode toggle — the Obsidian feel,
  without Obsidian's plugin-and-config learning curve.
- **No account, no cloud, no telemetry surface** — a privacy/simplicity story that Notion and
  Evernote structurally can't tell.
- **Cross-platform vault portability done properly** — a genuinely hard, mostly-invisible engineering
  investment (line endings, path safety, case handling) that cheap clones get wrong.

**Natural competitive framing:** Obsidian (owns files, but complex/plugin-driven and its "product"
is really the ecosystem) · Bear (beautiful, but Apple-only and its own format/sync) · Apple Notes
(easy, but locked in and Apple-only) · Notion (powerful, but a database that rents you your notes) ·
plain VS Code (owns files, but not a writing product). The wedge: *the only one that is simple,
cross-platform, beautiful, AND leaves you with a clean folder of Markdown.*

## 8. Open strategic questions worth planning around

These are decisions the codebase flags as not-yet-made — good candidates for a Cowork planning session:
- **Trash model:** OS-trash (current) vs. a recoverable in-vault `.mdnotes/trash/`.
- **Search:** scope and implementation, given the no-database constraint (filesystem-scan vs. an
  in-memory index that's rebuilt, never persisted as the source of truth).
- **Sync story:** the app takes no position on sync — but "put your vault in iCloud/Dropbox/Git" is
  the implicit answer. Is that the positioning, or is there a first-party angle later?
- **Testing:** no test runner yet — a quality/reliability decision before scaling features.
- **Monetisation / distribution:** open-source? one-time purchase? The local-first, no-cloud stance
  rules out subscription-for-sync as the obvious model, which is itself a positioning choice.
- **Extensibility:** the live-preview "passes" and the legacy slash-menu suggest a possible
  plugin/extension direction — or a deliberate anti-plugin, "curated and simple" stance vs. Obsidian.

---

## Verification / how to explore further

This is an analysis document, not a code change — nothing to test. To go deeper on any section, the
authoritative sources in the repo are:
- `notes-app/CLAUDE.md` — the full architectural contract and current-state-vs-target list.
- `notes-app/docs/decorations.md` — the live-preview engine design.
- `notes-app/legacy/README.md` + `legacy/src/` — the proven-but-unported feature backlog.
- `src/main/vault.ts` — the security/fs boundary and cross-platform handling.
- `src/renderer/src/App.tsx` — how the built features wire together today.
