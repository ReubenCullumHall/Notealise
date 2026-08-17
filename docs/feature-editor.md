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
  math are done as of 2026-07-28; images (`imagePass`) as of 2026-08-07.
