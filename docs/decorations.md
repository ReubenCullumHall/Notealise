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

## Not handled yet

Lists (beyond the bullet swap), tables, and images are deliberately left for later — each is a new
`Pass`.
