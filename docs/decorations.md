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

## Not handled yet

Lists (beyond the bullet swap), tables, fenced code blocks, images, and multi-line `$$` math
source are deliberately left for later — each is a new `Pass` (or, for line-crossing math, a
`StateField`).
