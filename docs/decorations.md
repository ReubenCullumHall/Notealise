# Live-preview decoration engine

The editor shows Obsidian-style **Live Preview**: markdown syntax marks (`**`, `#`, `` ` ``,
`>`, `~~`, link punctuation) are hidden so text just *looks* formatted, and reappear on the line
your cursor is on so you can edit them. This is implemented as a CodeMirror 6 `ViewPlugin` in
[`src/renderer/src/editor/livePreview.ts`](../src/renderer/src/editor/livePreview.ts).

## How it works

1. **Styling vs. hiding are separate.** The *look* of formatted text (bold weight, heading size,
   link colour) comes from the `HighlightStyle` in `highlight.ts`. This plugin only **hides the
   syntax marks** and swaps `-` for a bullet. Keeping them separate means the plugin never has to
   know what a heading looks like — only where its `#` is.

2. **Syntax tree, never regex.** We locate marks by walking the `@lezer/markdown` syntax tree
   (`syntaxTree(state).iterate`), not by matching text. Nested and escaped markdown break regex;
   the tree already models it correctly.

3. **Cursor reveal.** `activeLineSet(view)` collects every line touched by any selection range.
   Nodes on those lines are skipped (marks stay visible); everywhere else the marks are hidden
   with `Decoration.replace({})`.

4. **Only the visible viewport.** We iterate `view.visibleRanges`, so a 10k-line note stays
   smooth. Decorations recompute in `update()` **only** when
   `docChanged || selectionSet || viewportChanged`.

5. **Two range sets.** `build()` returns `decorations` (everything) and `hidden` (just the
   replaced ranges). `hidden` is registered via `EditorView.atomicRanges`, so arrow keys step
   over a hidden `**` as one unit instead of snagging in a zero-width gap — while visible styled
   text (which is *not* in `hidden`) stays normally navigable.

## Adding a new syntax type — the extension point

Decoration work is a list of **passes**:

```ts
export type Pass = (view: EditorView, active: Set<number>, push: Push) => void
export const PASSES: Pass[] = [markdownPass]
```

A pass receives the view, the active-line set, and a `push(from, to, deco, atomic)` callback.
To add support for a new construct, write a pass and append it to `PASSES`:

- Push `Decoration.replace({})` with `atomic: true` for text you want **hidden** (and stepped
  over by the cursor).
- Push `Decoration.mark({ class })` with `atomic: false` to **style** a visible range.
- Respect `active` — skip nodes whose line is in the set so the cursor line stays editable.

`build()` sorts all pushed ranges and feeds two `RangeSetBuilder`s (all decorations, and the
atomic subset), so a pass never has to worry about ordering.

### Worked example: the colour/highlight pass (`colorPass`, implemented)

Text colour and highlight are stored as inline HTML — `<mark class="hl-amber">…</mark>` and
`<span class="tc-amber">…</span>` (valid CommonMark, so the file still opens in Obsidian/VS Code/
GitHub). `colorPass` in `livePreview.ts`:

1. Scans the syntax tree for `HTMLTag` nodes and pairs each opening `<mark class="hl-*">` /
   `<span class="tc-*">` (validated against the palette in `palette.ts`) with its closing tag.
2. `push`es a hidden (`atomic: true`) range over each tag, and a `Decoration.mark({ class })`
   (`atomic: false`) over the content between them — so the colour shows even while editing.
3. Skips hiding a tag whose line is in `active`, exactly like every other mark, so the raw HTML
   shows when the cursor is on that line.

The wrapping/unwrapping is separate: `colorModel.ts` holds the pure `recolor` (split, replace,
toggle, merge — unit tested), `colorCommands.ts` is the CodeMirror wrapper, and
`SelectionToolbar.tsx` is the floating popover.

### The math pass (`mathPass`, implemented)

`mathPass` renders LaTeX with KaTeX: `$$…$$` (block) and `$…$` (inline). It scans the visible
text for delimiters (skipping any `$` inside code via the syntax tree, and escaped `\$`), and off
the cursor line replaces the whole span with a KaTeX `MathWidget` (atomic); on the cursor line the
raw `$…$` shows for editing. **Limitation:** only single-line `$$…$$` is rendered — a ViewPlugin
can't replace across line breaks, so multi-line `$$` *source* stays raw. Multi-line display math
would need a `StateField` instead (future).

`colorPass` also conceals the legacy inline-style colour form (`<span style="color:#hex">` /
`background-color`), not just this app's palette classes, so old notes render clean here too.

### The fenced-code pass (`fencedCodePass`, implemented)

Walks `FencedCode` nodes (verified against the real `@lezer/markdown` tree: `CodeMark` ×2 +
`CodeInfo` + `CodeText`, all direct children — not guessed). The two `CodeMark` fences and the
`CodeInfo` language tag hide independently, exactly like every other mark (each reveals only when
*its own* line is active — there's no special whole-block reveal, matching how `colorPass` treats
its open/close tags). The `CodeText` content always gets `Decoration.mark({class:
'cm-fenced-code'})`, matching the reading view's `.prose-note pre` look (`--code-bg` background,
monospace) via `box-decoration-break: clone` since a mark spanning multiple lines renders as one
DOM fragment per line, not one box. **No per-language syntax token colouring** — that would need a
new dependency (a CodeMirror language package or a highlighter), which needs asking first; this
only gives fenced code the same "styled block" treatment the reading view already has.

### Multi-line `$$` math (`blockMath.ts`, implemented — a StateField, not a Pass)

`mathPass` still owns single-line `$$…$$` and inline `$…$`. A `$$` alone on its own line, with a
later line that's also just `$$`, is block math whose *source* spans multiple lines — CM6 requires
`block: true` for a decoration that replaces an actual line break, and a block replacement's range
must exactly cover whole lines (line-start to the start of the following line, or to the document
end). That's different enough from the atomic-range trick the rest of this file uses that it lives
in its own `StateField` (`editor/blockMath.ts`), rebuilding on `docChanged`/selection change and
providing decorations via `.provide(f => EditorView.decorations.from(f))` — kept separate from
`PASSES` so it can't interact with `atomicRanges`. Reveal is whole-block (cursor anywhere inside
the `$$…$$` range shows raw source), unlike the per-line reveal everywhere else, since editing LaTeX
is naturally a whole-block operation. Verified via a CDP smoke test (dispatch transactions directly
against the `EditorView`, inspect the resulting DOM): renders correctly, reveals/re-conceals on
cursor movement, and — importantly — an *unclosed* fence or `$$` (the normal state while actively
typing) never throws; it's simply left raw until closed.

### `[[wiki links]]` (`wikiPass.ts`, implemented)

A hand scanner like `mathPass`, because `@lezer/markdown` does not model this: `[[Waves]]` has no
`(destination)`, so the parser sees an ordinary bracketed span and produces no node to walk. Links
inside code are skipped via `inCode()`, which is **exported from `mathPass.ts`** rather than copied —
two subtly different code-node lists would be a bug waiting to happen.

**Marks, not a widget**, which is the one place this pass differs in kind from the three widget
passes above. Every other replaced construct swaps text for something that isn't text (a bullet, a
KaTeX box); a link's label *is* text — it's the note's name — and replacing it would take selection,
copy, in-note search and undo with it. So the brackets are hidden exactly like a `**`, and what's
left is marked. Reveal is per-construct (`overlapsSelection`), so the cursor entering a link shows
the raw `[[…]]` for editing.

What ends up visible, by form:

| source | rendered |
|---|---|
| `[[Waves]]` | Waves |
| `[[Physics/Waves]]` | Waves (the folder is hidden) |
| `[[Waves\|the waves chapter]]` | the waves chapter (the target is hidden) |
| `[[Waves#Interference]]` | Waves#Interference (the `#` dimmed, not hidden) |

Two things it needs that a pass normally doesn't:

1. **The vault.** Whether a link resolves depends on what notes exist, which is not in this
   document. That arrives through the `linkEnv` **StateField** (`editor/linkEnv.ts`), pushed by a
   `setLinkEnv` StateEffect from `CodeEditor`. It is a StateField and not a ref precisely because
   the ViewPlugin only recomputes on `docChanged || selectionSet || viewportChanged` — a ref would
   change the answer with no transaction to repaint it, so creating the note a link points at would
   leave that link dashed until you happened to type. `livePreview.ts`'s update condition has a
   fourth clause for that effect; keep it narrow, or every cursor blink recomputes the viewport.
2. **The cross-space emoji**, which is a CSS `::before` off a `data-space` attribute rather than a
   decoration. `push()` drops zero-length ranges, so a point widget would be **silently thrown
   away** — and a pseudo-element is not in the file, not selectable, and not a range the builder has
   to order. The *class* `cm-wikilink-cross` carries the fact that the link crosses spaces; the
   emoji only says which one, because a space is not obliged to have one.

Clicking and dragging live in `editor/linkGestures.ts` — the first and only
`EditorView.domEventHandlers` in the app. It hooks **mousedown**, not click, because CodeMirror
places the cursor on mousedown and a cursor landing inside the link would reveal its raw source at
the same moment the note changed underneath it.

Three more things the pass draws, all of them CSS rather than decorations:

- **The kind of thing a link points at** — a page for a note, a folder for a folder — as a
  `mask-image` on `::before`, so the glyph takes `currentColor` and follows the theme and the hover
  state for free. The two masks are `--icon-doc` / `--icon-folder` in `theme.css`, traced from
  `icons.tsx`; keep them in step.
- **One pill, not several boxes.** A link can be two or three marks (target, the `#`, the heading),
  so only the first gets `cm-wikilink-lead` (left radius, icon, cross-space edge) and only the last
  gets `cm-wikilink-tail` (right radius). Without this a heading link rendered as two separate grey
  boxes with a stray `#` between them.
- **The `›` before a heading.** The `#` is *replaced*, not dimmed, and `.cm-wikilink-heading::before`
  supplies the separator — so `[[Waves#Interference]]` reads "Waves › Interference".

### Tables (`blockTable.ts` + `tableModel.ts`, implemented — a StateField, and EDITABLE)

A `StateField` for the same reason `blockMath.ts` is one: a table spans line breaks, replacing those
needs `block: true`, and a ViewPlugin cannot provide block decorations.

**The table is always drawn — there is no reveal.** It used to bail out whenever the selection
touched it, which handed you raw `| --- |` the instant you tried to change anything; that was the
complaint the feature was rebuilt to answer. Clicking a cell opens a `<textarea>` in place instead.
Commit on Enter, Tab (next cell), Shift+Tab (previous) or clicking away; Escape discards. Each
commit rewrites the whole block from the model in ONE transaction — writing the change and moving
to the next cell separately would put a frame on screen with the table rewritten and no cell open.

Two consequences of always drawing it:

- `ignoreEvent()` returns **true** for everything. CodeMirror placing a cursor inside the widget is
  exactly what used to put the source back on screen.
- The field rebuilds on `docChanged` or the `setEditCell` effect — **not** on selection changes any
  more, since the table looks the same wherever the cursor is.

Which cell is open lives in its own `StateField`, not in the widget's DOM: Tab has to open the
*next* cell after the edit it just committed has been written, and by then the widget has been
rebuilt and the old input is gone.

**Cells are read by slicing the line, never from `TableCell` nodes** — verified against the real
parser, and this is the trap. An **empty cell produces no `TableCell` node at all**, only the
delimiter pipes either side, so collecting `TableCell` children reads `| a |  | c |` back as two
cells and shifts `c` into column 2. Harmless while the table was read-only; once a cell edit
rewrites the block it deletes a column from the user's file. `splitRow` in `tableModel.ts` splits on
unescaped pipes instead (`\|` is a literal pipe, which is why the tree was used in the first place).

`tableModel.ts` is pure and unit-tested, because it is the only thing in the app that rewrites a
block of a note from a structure held in memory: alignment is preserved exactly (`---` and `:---`
are different bytes and only one of them was written by the user), pipes are escaped, newlines
pasted into a cell are flattened rather than ending the table mid-row, and rows shorter than the
header are padded rather than swallowing an edit. Columns are re-padded on write so the raw source
stays readable — the one thing it does change about a file it was given.

**Adding** is a `+` bar down the **right** edge and along the **bottom**, pinned to the table's own
edges with `top/bottom: 0` / `left/right: 0` so neither can be longer than the table. It lives inside
`.cm-table`'s padding, with matching negative margins, because that box clips (see above).

**Removing a row has no control at all — it is Backspace on an already-empty row**, the same
two-step "clear it, then backspace" gesture Notion uses for an empty block. `buildCell`'s Backspace
handler checks the CURRENT model's whole row (`this.model.rows[row].every(c => !c.trim())`), not
just the cell being edited, so an empty cell next to real data can never take that data with it.
Removing that control entirely — no permanent grab bar sitting on every row — was the point: a
control that exists only to be clicked once is exactly the kind of chrome a table full of them reads
as "junky".

**Removing a column is select-then-Backspace.** Click the six-dot handle above a column (the same
grip glyph the sidebar's draggable rows use, rebuilt in raw DOM since this widget is outside React)
to outline it; Backspace or Delete removes it, Escape or a click elsewhere deselects. The handle ALSO
drags to **reorder columns** — `moveColumn` in `tableModel.ts` takes `(from, insertBefore)`, where
`insertBefore` is an index into the column order as the user still sees it (the drop boundary
nearest the pointer), not one that already accounts for the column being removed first; the function
does that correction internally. The drag never calls `apply()` mid-gesture (unlike the row/column
COUNT resizer above, which does and needs `liveTo`): column rects are captured once at mousedown,
`this.model` never changes until drop, so there is nothing to re-measure and no staleness to track.

Two earlier versions of the remove control were wrong in ways worth not repeating. **Flex strips
floating beside the table** came apart the moment cells began to wrap — `flex: 1` gives every
segment an equal share while rows are as tall as their contents, so a short row's grip sat beside a
tall one. **Real grip cells inside the table** then wrecked the column widths: under
`table-layout: fixed` the FIRST ROW sets every column's width, the grip row was that first row, and
all the leftover width collected in the grip column — a long grey gutter down the left of every
table. Nothing decorative may be added to a fixed-layout table as a leading row or column — an
**overlay**, positioned absolutely with no footprint in the flow, is the only shape that survives
contact with `table-layout: fixed`. The drag reports an absolute size to `resizeColumns`/`resizeRows`, never a
delta — a pointermove fires many times a second and replaying it as increments would add a column
per frame the pointer sat still. Dragging back past the start really does undo the drag, because
every frame is measured from the model as it was when the drag began. The minimum is one column and
zero body rows: a header on its own is a valid table, and that is the 1×1.

**Every cell has a floor height**, filled or empty, sized to one line of text plus the padding —
otherwise a freshly dragged-out empty row is a sliver next to a row that happened to wrap. It is
`height`, not `min-height`, **and that is not a typo**: `min-height` looked right, compiled fine,
and was silently a no-op. Confirmed with a headless Electron repro (`webContents.executeJavaScript`
+ `getBoundingClientRect`, no dev tools, no window ever shown) after it visibly failed in the running
app twice — **Chromium does not enforce `min-height` as a floor on `display: table-cell`**, in any
combination of `table-layout: fixed/auto` or `border-collapse: collapse/separate` tried; a `td`
measured shorter than its own computed `min-height` in every one. Plain `height` on a table cell
behaves as that floor instead (a table-specific CSS quirk, not how `height` works on a block
element) — also confirmed: a cell with several wrapped lines still grows well past it, and the short
cell beside it in that row stretches to match, so nothing about the "cells wrap and the row grows"
behaviour above is lost.

This rule was ALSO dropped by accident once, 2026-08-07, in the very next edit after it first
landed — a later change fixed a clipping bug by rewriting the whole `.cm-table th, .cm-table td`
block from scratch, and the line wasn't carried into the new version. Re-added the same day, this
time with the property fixed too. Two lessons stack here: a full-block CSS rewrite has to diff
against what it's replacing, not just against what it's adding — and "the CSS looks correct and
compiles" is not evidence it does anything, for exactly the kind of property/element combination
browsers have quietly never supported.

**A `<th>` with two `position: absolute` children roughly DOUBLES its own rendered height in this
Chromium build.** Content-independent, offset-independent, order-independent — confirmed with a
headless Electron repro (`webContents.executeJavaScript` + `getBoundingClientRect`, no window ever
shown): a bare cell and a cell with exactly ONE absolutely-positioned child both measure correctly;
the moment a SECOND one joins it as a sibling, the cell's own auto height roughly doubles, and this
still partially reproduces even nested one level through a single positioned wrapper. This is what
made the header row visibly shorter than the body — `buildCell` was appending BOTH the alignment
mark and the column handle straight into the `<th>` they belong to. The fix: **`alignControl` and
`columnHandle` are not children of the `<th>` any more.** They live as siblings of `<table>`, inside
`.cm-table-grid`, each positioned with `left`/`top` computed in JS from that header cell's measured
`getBoundingClientRect()` (`positionChrome`, re-run via `requestAnimationFrame` on mount and via a
`ResizeObserver` on `grid` for a pane/window resize afterward — `TableWidget.destroy()` disconnects
it). This is the exact pattern `HoverCard`/`ColorPopover` already use elsewhere in this app for a
different reason (escaping a scrolling/blurred container); here it's escaping an undiagnosed
table-cell layout quirk instead, but the shape of the fix is the same: **when a browser's own
internals won't cooperate with an element nested where it visually belongs, position it from outside
instead of fighting the nesting.**

One consequence: hover-reveal for these two controls can no longer be a CSS descendant selector
(`th:hover .handle`), because they are no longer descendants of anything. `positionChrome`'s sibling
loop also wires a `mouseenter`/`mouseleave` pair per header cell that toggles `.cm-table-chrome-show`
on that column's own overlay pair — JS doing what CSS did before, for the same reason the
positioning itself moved to JS.

**Every control reveals only on hovering ITS OWN area** — `.cm-table-chrome-show` (set by
`positionChrome`'s per-header-cell `mouseenter`/`mouseleave` pair), `.cm-table-add-col:hover`, and so
on — never `.cm-table-grid:hover`. That broader version was tried
first and reads, in practice, as "always visible": the pointer is near a table for most of the time
you're working with one, so revealing every handle and every + bar together the instant it enters the
table's bounding box is barely different from them just being there. Scoping to the specific element
means a handle needs its own header cell hovered, and a + bar needs the pointer directly over its own
strip along the table's edge.

**Cells wrap, and the row grows.** `table-layout: fixed` is not optional here: under the default
`auto` layout a `max-width` on a `td` is **ignored** (the spec treats width properties on cells as
minimums), so one long sentence widened its column until the table ran off the note. Fixed shares
the width evenly and text flows downwards; `width: 100%` goes with it, because a fixed-layout table
with an auto width sizes itself from its column widths alone. The open cell is a **`<textarea>`**
that regrows to `scrollHeight` on every keystroke — a single-line `<input>` can only ever grow
sideways, which was the same bug from the other end. Enter commits rather than inserting a break: a
GFM cell cannot contain a newline at all.

`apply()` tracks its own `liveTo`. A drag rewrites the block on every step, so after the first one
the widget's `to` is the end of a table that no longer exists — replacing `[from, this.to]` again
would write over whatever now follows it.

**A line written directly under a table is part of the table.** GFM continues a table until a blank
line, so `after` on the very next line parses as a one-cell row (verified — GitHub renders it as a
row too). The widget draws it as a row and writing back makes it an explicit `| after |  |`. That is
why `/table` inserts a **blank line** after itself: with only one line break, the first word typed
after inserting a table silently joined it.

### Markdown pro / raw view (`rawView.ts`)

A `Facet`, not a StateField: nothing inside the editor ever changes it. The value comes from React
(the note's `workspace.json` flag), is pushed in by reconfiguring a `Compartment`, and is read by
every decoration producer. Reconfiguring rather than recreating the view keeps the cursor, scroll,
undo history and open document exactly as they were.

The whole implementation is three guards: `livePreview`'s `build` skips **all** of `PASSES` (which
is why one guard covers `markdownPass`, `colorPass`, `mathPass`, `fencedCodePass`, `imagePass`,
`inlineHtmlPass`, `taskPass`, `webLinkPass` and `wikiPass` at once), and `blockMath` and
`blockTable` each return `Decoration.none`. **`highlight.ts` is deliberately untouched** — bold
still looks bold and headings stay large, only the marks stop being hidden. That was the user's call
over a flat monospace view, and it means there is no second set of styles to keep in step.

Each of the three must also rebuild on a reconfiguration, or the old rendering lingers until the
next keystroke. `reconfigured` lives on **`Transaction`, not on `ViewUpdate`** — checked against the
installed `.d.ts` — so the ViewPlugin tests `u.transactions.some(tr => tr.reconfigured)`.

## Not handled yet

Lists (beyond the bullet swap) are deliberately left for later — a new `Pass`.
