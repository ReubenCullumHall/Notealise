# Editor features: format buttons, links, colours, tables

Custom format-bar buttons, the command registry, note links, entry colours, editable tables, and
the raw-view toggle.

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
  invented delimiter (CLAUDE.md rule 4). The parser/resolver is `shared/links.ts` — **shared because
  both processes parse**: main scans the vault for the backlink index, the renderer scans the buffer
  you are typing in, and two parsers would drift. It knows about code spans and fences itself, since
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
- **The links block and the path bar (built 2026-08-01; bottom placement added 2026-08-17).** Both
  are chrome; **nothing either shows is ever written into a note** (rule 1). The links strip sits at
  the top of each column by default — outgoing first, then backlinks — and **does not put the
  direction on the face of a link**: which way a connection runs is on the hover card, along with the
  line the link sits in, so the strip reads as names rather than badges. It scrolls sideways at a
  fixed height, because the chrome may not change height with what a note contains. At the top,
  Settings → Linking content pins it; unpinned (the default) it scrolls away with the text
  (translated against the CodeMirror scroller, whose top padding follows `--links-inset` — CM keeps
  its own scroller, which is not worth restructuring for this).
  **`linksPosition` ('top' | 'bottom') moves the whole strip to a fixed bar under the editor
  instead** — for a space whose header is already busy with tabs, the path bar and the title. It is
  always a static row there (no floating/scroll-away variant, and pinning is meaningless once the
  strip can't scroll away in the first place — `pinLinks` is greyed out in `SpaceForm` whenever
  position is 'bottom'). Implemented as an ordinary sibling row after `.pane-body` in `NotePane.tsx`,
  the same trick the top-pinned row already uses before it — flex-column layout shrinks `.pane-body`
  from whichever side the row sits on, so no absolute-positioning or padding hack was needed for the
  new side. `LinksBlock` takes an `edge: 'top' | 'bottom'` prop purely to flip which side gets the
  border (`border-b` when the note text sits below the strip, `border-t` when it sits above).
  **There is no separate "backlinks" panel to relocate independently** — outgoing and incoming links
  render as one combined strip (see below), so "put the backlinks at the bottom" reads on this
  strip as a whole, not on a filtered subset of it.
  The path bar is one row for the whole editor area, following the focused column, and is
  **navigation, not a label**: clicking a folder opens it in the sidebar, closes every other folder,
  and scrolls it into view — switching space first if the note lives in another one.
  **Two settings pages, and they are not the same job.** `Settings → Linking content` holds the
  switches; `Settings → Tutorials → Linking your notes` explains the five forms, what an alias is
  for and how the space scoping works. Keep the guide in step when link behaviour changes — it is
  the only place the rules are written for someone who isn't reading this file. The nav says
  "Linking content" rather than "Links" on purpose: a link here is a relation between two things
  the user wrote, and the short word kept reading as a URL.
  **`showLinks` / `pinLinks` / `linksPosition` / `showPath` / `showNoteInfo` belong to a SPACE**, not the app: how a set of notes reads
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
  Per-space (so Customisation sets it for all, per the settings rule):
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
  specificity would be settled by source order, which is exactly the drift the Tailwind-vs-global
  rule in CLAUDE.md warns about.
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
  math are done as of 2026-07-28; images (`imagePass`) as of 2026-08-07; video (`videoPass`) as of
  2026-08-18.
- **Photo/video attachments + drag-to-reorder (built 2026-08-18).** Paste, drag a file in from
  Finder, or the "Photo or video" command (`editor/attachInput.ts`) write the file beside the note
  (`writeAssetUnique` in `main/vault.ts`, reached over a NEW `vault:writeAsset`/`vault:pickAttachment`
  IPC pair — nothing let the renderer write into the vault before this) and insert `![](name)` for
  an image or `<video controls src="name"></video>` for video — the latter is deliberately inline
  HTML, the same trade rule 4 already accepts for colour, since Markdown has no video syntax of its
  own. `videoPass.ts`/`videoAssets.ts` mirror `imagePass.ts`/`imageAssets.ts` node for node.
  Hovering either widget reveals a six-dot grip (`attachMove.ts`, `gripIcon` shared with
  `blockTable.ts`'s column handle rather than redrawn) that drags the embed's own line to a
  different point in the note in one transaction — the document never changes mid-drag, so the
  widget stays a rendered picture/player throughout instead of flipping into raw markdown.
  A command that waits on the native file picker can't insert anything synchronously, unlike every
  other entry in the registry — `EditorCommand.deferred` says so explicitly so
  `commands.test.ts`'s "every command produces text on an empty note" check knows to skip it,
  rather than special-casing the id by name.
- **Selecting an attachment and deleting it (built 2026-08-21).** Clicking the grip without
  dragging selects the WHOLE embed (`attachSelect.ts`) — an ordinary document selection covering
  the embed's range exactly, deliberately not a StateField of its own, because livePreview already
  recomputes on `selectionSet` and CodeMirror already draws and clears a selection. That exact
  cover is the one thing the passes have to be taught: `selectionCovers` beats their usual
  `overlapsSelection` check, so a selected picture keeps rendering as a picture with a ring round
  it instead of flipping to raw markdown — you cannot confirm deleting something you cannot see.
  Backspace/Delete then cuts it (whole line if it sits alone on one, the embed only if it is
  written mid-sentence) and asks afterwards. Delete-then-confirm, not confirm-then-delete, is what
  makes Cancel a faithful undo: nothing else can reach the document while the dialog is up, so
  putting the exact text back at the exact offset re-renders the embed from the text it was.
  Three things worth knowing here too:
  - **The FILE is deleted as well, and only on confirm.** `.mdnotes/trash` — the same bin a
    deleted note goes to, with the same 7-day recovery net under it, never the OS trash. The
    editor resolves which file (`embedTarget` + `resolveVaultPath`, done BEFORE the cut while the
    embed is still in the document) and hands it over as `MediaDelete.file`; App does the binning.
    Because binning waits for the confirm, Cancel never has to un-bin anything.
  - **`MediaDelete.file` is null unless the target really is a photo or a video.** Remote URLs
    and paths climbing out of the vault are refused by `resolveVaultPath`; on top of that
    `attachmentFileOf` checks the extension against `shared/attachments.ts`, because an embed's
    target is whatever somebody typed and `![](Some note.md)` is a writable line — without the
    check, confirming would bin a NOTE, silently. Null makes the delete text-only and the dialog
    says so ("Nothing on your computer changes") rather than promising a bin it won't use.
    `attachSelect.test.ts` exists for this one function: everything else about the feature is
    recoverable from the bin, and this is the only way it could remove something nobody asked for.
  - **A selected embed shows a ring and nothing else.** `embedSelectionAttr` puts
    `cm-embed-picked` on the EDITOR whenever `selectionIsEmbed` holds, and the CSS hides
    `.cm-selectionBackground` and the caret from there. It has to hang off the editor rather than
    the widget: `drawSelection()` renders into `.cm-selectionLayer`, a *sibling* of `.cm-content`,
    so nothing scoped to the picture can reach the rectangle drawn across it. The first attempt
    styled `.cm-attach-selected ::selection` — the native browser selection, a different mechanism
    that is inert while `drawSelection` is on. It looked right in the stylesheet and never once
    applied, which is the failure mode worth remembering: a CSS rule that cannot match is
    indistinguishable from one that does, in the source.
  - **A restore aims at the TEXT AROUND the picture, not at a line number.** `MediaOrigin` records
    `before`/`after` — up to `ANCHOR` (40) characters of the note either side of the cut, taken
    BEFORE the dispatch that removes it, the same as `text` and `line` already were. Removing the
    embed is exactly what joins those two strings, so from that moment the note verbatim contains
    `before + after`, and the seam between them is the spot. That survives any edit elsewhere in
    the note; a line and column do not, and a bin item can sit for seven days. The bug that forced
    it: delete a photo on line 5, type two paragraphs at the top, restore — the picture landed
    above the note's own heading while the notice said "back where it was". `spliceMediaBack` tries
    both neighbours at full length, then at 14 characters, then one neighbour alone when the other
    is empty (the picture was at the very top or bottom), then — only for records written before
    anchors existed — the old line/column, then the end of the note. It deliberately does NOT fall
    back to the coordinate when anchors were recorded and missed: if the neighbours are gone the
    note was rewritten around that spot, which is precisely when the coordinate aims at something
    unrelated. `MediaLanding` (`anchored` / `aimed` / `appended`) is what the notice reads, so
    "back where it was" is only printed when both neighbours matched.
  - **With the asking off, the notice carries an Undo.** That is not a courtesy: with the
    confirmation off, a stray Backspace on a selected embed is the only thing in the app that
    removes a file with no dialog in front of it. `Notice.action` in `App.tsx` exists for this one
    case, and the undo restores the text and the file together (`restoreEntries` on the bin id
    `trashEntries` just returned).
  The dialog's two ticks — "Always ask" / "Never ask again" — are ONE switch (`keepAsking`), not
  two booleans, so they cannot drift into both-on or both-off. Neither bites on Cancel: quietly
  switching off a safety net while someone backs out of using it is what the net is for.
  **Cancel restores by document OFFSET, which is why three separate things guard it.** The dialog's
  backdrop only stops the MOUSE: the editor still has focus when it opens (`selectEmbed` called
  `view.focus()`), and App's shortcut handler listens in the capture phase, so without these,
  typing lands in the note behind the dialog and Ctrl+Tab / Cmd+W moves that note away entirely —
  either of which makes `cut.from` point at the wrong place by the time Cancel runs.
  1. Cancel is `autoFocus`ed, so keystrokes stop reaching the editor.
  2. `mediaConfirmRef` makes the global shortcut handler stand down while the dialog is up.
  3. `restore` re-checks `linkEnv.path` against the note the embed came out of and says
     "Couldn't put that back — you moved to another note" rather than writing into a stranger.
  **Restoring a photo puts it back in the NOTE, not just the vault** (built 2026-08-21).
  `MediaOrigin` in shared/workspace.ts rides along on the bin row — the note, the exact text that
  was cut, and the line/column it was cut from — and follows the file down into recovery, so a
  restore seven days later behaves the same as one seven seconds later. Three things worth knowing:
  - **Line AND column.** An embed alone on its line is cut with its line; one written mid-sentence
    is cut on its own. Line alone would put the second kind back at the start of its line, which
    moves it. `spliceMediaBack` is pure and lives beside the type in shared/, tested directly in
    `workspace.test.ts` — it is the one part of Restore that can produce a plausible-looking WRONG
    note rather than an obvious failure, and an off-by-one on either coordinate splices an embed
    into the middle of a word with nothing downstream to notice.
  - **The renderer does the writing, not main.** App's `putMediaBack` flushes the open buffers
    first, then reads/splices/writes and calls `loadDoc` to re-seed whichever pane is showing it.
    Main writing the note behind the renderer's back would be clobbered by the next autosave.
  - **It says which of three things happened** — back where it was, added at the end because the
    note changed, or the note is gone entirely. Someone who restores a picture and then can't find
    it is worse off than someone who is told where it went.
  **The app knows which notes hold which photos** (built 2026-08-21). `LinkRow.embeds` rides on the
  same scan that feeds the backlinks (`indexEmbeds` in shared/attachments.ts), `liveIndex` fills it
  for open buffers too, and `media/usage.ts` turns it into `file -> notes`. Two things to know:
  - **It is the answer to "how is a photo IN a note, not just linked to one".** Before it, the only
    record of that relationship was `MediaOrigin` — a breadcrumb written at delete time — so a
    photo shared by two notes could be deleted from one and silently break the other, and anything
    that lost the breadcrumb lost the connection completely.
  - **A buffer overlay is not a substitute for rescanning, and this cost a real photo.**
    `liveIndex` lays open notes over the last vault scan, which makes a picture dragged in two
    seconds ago instantly visible to the index — and hides the fact that nothing ever writes that
    knowledge back. The moment a note's buffer is dropped (`dropDoc`, when its tab is replaced) the
    index silently reverts to whatever the scan said, which for a note edited since startup is
    wrong. So: add a photo to note B, switch away, delete that photo from note A — no warning, B
    loses its picture, and because B's loaded copy is still in memory the damage only appears after
    a restart. `dropDoc` now rescans the note it is letting go of, after its pending write settles.
    The second half of the same bug: only `[[links]]` counted as a change worth re-indexing, so an
    embed pasted as TEXT — the only way to make two notes share one file — never triggered one at
    all. `indexFingerprint` (links/model.ts) covers both kinds now and is tested for it, because
    the failure is invisible until someone has already lost a picture.
  - **`otherNotesUsing` excludes the note being deleted from, deliberately.** The delete has already
    happened when the dialog opens and the index has not necessarily caught up, so counting rows
    would be wrong half the time; excluding the one note in question is right either way.
  Enter is deliberately unbound. It used to mean Delete — the destructive answer on the key people
  press to dismiss a dialog, and it now bins a file. With focus on Cancel, Enter still does the
  obvious thing; it just does the safe one.
  Three things worth knowing if you touch this again:
  - **`<video controls src="…"></video>` on one line parses as two plain `HTMLTag` nodes in a
    paragraph, not an `HTMLBlock`** — verified against the real `@lezer/markdown` tree, not
    guessed (a direct `parser.parse()` check, the same discipline `imagePass`'s own node-shape
    comment asks for). CommonMark's block-HTML rule 7 needs the *whole line* to be just one tag;
    an open+close pair on the same line fails that, so it degrades to inline HTML. That's why
    `videoPass` is a plain `Pass` like `imagePass`, not a `StateField` like `blockMath`/`blockTable`
    — nothing here spans a line break.
  - **A `drop` handler alone does nothing.** The browser refuses to fire `drop` at all unless
    `dragover` calls `preventDefault()` first — miss it and every dragged file just shows a
    "not allowed" cursor, silently, for both a photo and a video alike, with nothing in either path
    to say why. `attachInput.ts` gates its `dragover` handler on `dataTransfer.types.includes('Files')`
    so it doesn't swallow CodeMirror's own drag handling for text/wiki-links.
  - **`ReadingView.tsx` is not wired into the app.** `NotePane.tsx` says so outright ("there is no
    Edit/Read toggle"); nothing imports `ReadingView` anywhere. The live-preview editor is the only
    surface a note actually renders on. `PROJECT-CONTEXT-BRIEF.md`'s "Edit/Read toggle" line is
    stale — noted here rather than fixed there, since that file is an external planning snapshot,
    not a read-for-current-state doc.
  Separately, **not part of this build**: `shared/links.ts` exports `rewriteLinks()` to fix up a
  `[[wikilink]]` when its target note is renamed, but it has **zero call sites** anywhere in `main`
  or the renderer (confirmed by grep) — renaming a note today does not update links elsewhere in
  the vault. Found while scoping whether an attachment's own link should survive a rename; out of
  scope for this build, but real and worth its own pass.
  Also pre-existing, not introduced here but now inherited by `videoAssets.ts` too: `imageAssets.ts`
  exports `clearImageCache()` specifically to drop every blob URL on a vault switch (a relative path
  means a different file in a different vault), but nothing calls it — same zero-call-site shape as
  `rewriteLinks()` above. Flagging rather than quietly fixing or quietly ignoring, per rule 9.
  **Half-corrected 2026-08-20** (see the hardening pass below): `clearImageCache()` did in fact have
  one call site, in `App.tsx`'s vault switch — it was `clearVideoCache()` that had none. Both now go
  through a single `clearAssetCaches()`. Recording the correction rather than editing the claim
  away, because "I grepped and found nothing" is exactly the check that missed a call here.

## Attachment hardening pass (2026-08-20)

Fixes to the paste/drop/attach and drag-to-move work above, from a review of the whole feature.
None of it had shipped, so none of it reached a user — but three of the lessons generalise.

**1. A captured document position is not a position.** Every attach path wrote its asset to disk
and *then* dispatched an insert at a number captured before that `await`. A large video's IPC
round-trip is long enough for the document to move underneath it: the embed lands in the wrong
place, or `dispatch` throws a RangeError into a silent `catch {}` — the asset on disk, no embed,
nothing said. Positions are now held in a `StateField` (`attachTargets`) that maps them through
every transaction, which is what CodeMirror already does for the selection. **Reach for a
StateField whenever a position has to survive an `await`.**

**2. The view outlives the note in it, and mapping alone cannot tell.** The sharp edge of (1):
`CodeEditor.tsx` creates its `EditorView` **once** and swaps the document in place when you switch
notes (`changes: {from: 0, to: doc.length, insert: next}`) rather than rebuilding it. A tracked
position maps straight through that replacement into a perfectly valid position in *somebody
else's note* — so switching notes mid-write would have inserted the embed into the wrong file,
against a relative path that doesn't resolve from there. `insertAtTarget` therefore pins
`linkEnv.path` at the start and refuses if a different note is on screen. **Any editor code that
resumes after an `await` must check WHICH NOTE it is in, not just whether the offsets still fit.**
`attachMove.ts` gets this for free by comparing document identity (`view.state.doc !== doc`), which
is the cheaper version of the same test when the whole gesture is synchronous.

**3. Drop boundaries come from rendered blocks, not source lines.** Walking `doc.line(n)` produced
drop targets inside a table's raw markdown, because a table is one block widget standing in for
several source lines whose interiors have no height. `view.viewportLineBlocks` only ever names
positions *between* blocks. It also re-measures on scroll now — boundaries captured once at
mousedown desync from the screen the moment a wheel or an edge-autoscroll moves the lines.

Also in this pass: paste and the "Photo or video" command now **replace the selection** like every
other paste path; the drag's `window` listeners are torn down from one `cleanup` reachable from
mouseup, window blur and Escape (mouseup outside the window used to leak both listeners, so the
next drag ran two of them); a drag whose note was reloaded mid-gesture is abandoned rather than
dispatched at a guess; moving an embed off the note's last line no longer leaves a blank line
behind; `<img draggable=false>` (the grip is the drag affordance — a native image drag carried the
`blob:` URL as text); and `shared/attachments.ts` now holds the one image/video catalogue, keyed
both ways, so main's extension filters and the renderer's MIME classification can't disagree —
same problem `shared/fonts.ts` already solved. `CH.writeAsset` validates against it, which also
stops a filename like `.png` landing as a hidden, extensionless file.

**The editor can talk to the user now.** `LinkHandlers` gained `notify`, and
`linkHandlersFacet`/`notifyUser`/`notifyError` in `linkEnv.ts` make it reachable from any module
with a state — `attachFiles` is invoked from the command registry with nothing but a view, so a
closure captured at construction can't reach it. `notifyError` strips Electron's
`Error invoking remote method '…': Error: ` wrapper, deliberately keeping what's behind it: main's
own messages are written for people, and the one `renameWithRetry` raises ("this folder is still
syncing … wait a moment and try again") is the single most useful thing a OneDrive vault can be
told. Covered by `linkEnv.test.ts`.

- **A cursor at the edge of an embed is beside it, not in it (fixed 2026-08-23).** `livePreview`'s
  `overlapsSelection` is inclusive at both ends, which is right for `*italic*` — a cursor on the
  star should show the star — and wrong for a replaced photo. Three files dragged in at once land
  on consecutive lines, and deleting one left the caret on a neighbour's line, so the survivor
  flipped into raw `<video …>` source. There was no caret position that didn't: end of the line
  above, start of the line below, both counted as "inside" under an inclusive test.
  Two changes, and both are needed:
  - `insideEmbed` (attachSelect.ts) replaces `overlapsSelection` in `imagePass`/`videoPass`. An
    EMPTY cursor must be strictly between `from` and `to`; a non-empty selection touching the edge
    still counts, because dragging a selection across an embed is asking to edit the text.
  - `cutRange` now returns a `caret`, and it is the end of the line ABOVE rather than the start of
    whatever moved up into the gap. Restore uses it too: landing on the restored embed's own first
    character would bring it back as raw source, which is the opposite of what "put it back" should
    look like.
  `imageClick` had to move with them: `posAtDOM` returns the widget's own start, and with the edge
  no longer counting as inside, clicking a picture would have done nothing at all. It now places
  the cursor one character in — that gesture means "let me at the markdown", so it should be
  unambiguous. Video has no equivalent: `VideoWidget.ignoreEvent` returns true, so a click on a
  player never placed a cursor in the first place.
