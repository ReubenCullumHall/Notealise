import { Prec, RangeSetBuilder } from '@codemirror/state'
import { isRaw } from './rawView'
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from '@codemirror/view'
import { syntaxTree } from '@codemirror/language'
import { colorPairs, isEmptyPair } from './colorTags'
import { mathPass } from './mathPass'
import { setLinkEnv } from './linkEnv'
import { wikiPass } from './wikiPass'
import { imagePass } from './imagePass'
import { videoPass } from './videoPass'
import { inlineHtmlPass } from './inlineHtmlPass'
import { webLinkPass } from './webLinkPass'
import { taskPass } from './taskPass'

// ---------------------------------------------------------------------------
// Live preview: hide markdown syntax marks on every line EXCEPT the one(s) the
// cursor/selection touches, so text just *looks* formatted while staying plain
// markdown underneath. Styling itself comes from the HighlightStyle in
// highlight.ts; this file only hides marks and swaps list bullets.
//
// Everything is driven off the @lezer/markdown SYNTAX TREE — never a regex over
// the document (nested/escaped markdown breaks regex; the tree already solves
// it). We iterate view.visibleRanges only, so a 10k-line note stays smooth.
//
// EXTENSION POINT: add new syntax by pushing a Pass into PASSES (see
// docs/decorations.md). Phase 3's colour/highlight handler plugs in there.
// ---------------------------------------------------------------------------

class BulletWidget extends WidgetType {
  eq(): boolean {
    return true
  }
  toDOM(): HTMLElement {
    const s = document.createElement('span')
    s.className = 'cm-bullet'
    s.textContent = '•'
    return s
  }
  ignoreEvent(): boolean {
    return false
  }
}

/** Exported for `wikiPass`, which hides `[[` / `]]` exactly as this file hides a
 *  `**` — one definition, so "hidden" can't come to mean two different things. */
export const hideDeco = Decoration.replace({})
const bulletDeco = Decoration.replace({ widget: new BulletWidget() })
/** What a hidden mark becomes in raw view instead of disappearing. The two looks
 *  — faded, or highlighted like code — are `[data-raw-marks]` rules in app.css,
 *  so one class covers both and switching is a stylesheet concern. */
const rawMarkDeco = Decoration.mark({ class: 'cm-raw-mark' })

/** A collected decoration. `atomic` marks a hidden/replaced range so the cursor
 *  steps over it as one unit (fed to EditorView.atomicRanges); visible styling
 *  marks are not atomic. */
export interface Deco {
  from: number
  to: number
  deco: Decoration
  atomic: boolean
  /** provide this mark at HIGHEST precedence, which in CM6 makes it the
   *  INNERMOST element — so the syntax highlighter's own marks wrap outside it
   *  and it inherits their font size. See `colorInner` below. */
  inner?: boolean
}
export type Push = (
  from: number,
  to: number,
  deco: Decoration,
  atomic: boolean,
  inner?: boolean
) => void
export type Pass = (view: EditorView, active: Set<number>, push: Push) => void

/** Lines touched by any selection range — their syntax is revealed for editing.
 *  Only right for constructs that consume a whole line on their own (a heading
 *  or a list/quote marker never has unrelated text following it after the
 *  construct ends) — see `overlapsSelection` for anything that can share a
 *  line with other text, like emphasis or a link. */
function activeLineSet(view: EditorView): Set<number> {
  const doc = view.state.doc
  const set = new Set<number>()
  for (const r of view.state.selection.ranges) {
    const a = doc.lineAt(r.from).number
    const b = doc.lineAt(r.to).number
    for (let l = a; l <= b; l++) set.add(l)
  }
  return set
}

/** Whether any selection range overlaps [from, to) — used for marks whose
 *  construct can share a line with unrelated text (emphasis, inline code,
 *  links, colour tags, inline math): finishing "*italic*" and typing on past
 *  it should re-conceal the asterisks even though the cursor is still on that
 *  line, which a same-line check alone can't tell apart. */
export function overlapsSelection(view: EditorView, from: number, to: number): boolean {
  for (const r of view.state.selection.ranges) {
    if (r.from <= to && r.to >= from) return true
  }
  return false
}

// Pass 1: standard markdown marks, located in the syntax tree.
const markdownPass: Pass = (view, active, push) => {
  const doc = view.state.doc
  const tree = syntaxTree(view.state)
  for (const { from, to } of view.visibleRanges) {
    tree.iterate({
      from,
      to,
      enter: (node) => {
        const name = node.name

        if (name === 'ListMark') {
          if (active.has(doc.lineAt(node.from).number)) return
          if (/^[-*+]$/.test(doc.sliceString(node.from, node.to))) {
            push(node.from, node.to, bulletDeco, true)
          }
          return
        }
        if (name === 'HeaderMark' || name === 'QuoteMark') {
          if (active.has(doc.lineAt(node.from).number)) return
          let end = node.to
          // also swallow the single space after "# " and "> "
          if (doc.sliceString(end, end + 1) === ' ') end++
          push(node.from, end, hideDeco, true)
          return
        }
        if (name === 'EmphasisMark' || name === 'StrikethroughMark') {
          // the enclosing Emphasis/StrongEmphasis/Strikethrough span, not the
          // mark's own (single-line) range or the whole line
          const parent = node.node.parent
          if (parent && overlapsSelection(view, parent.from, parent.to)) return
          push(node.from, node.to, hideDeco, true)
          return
        }
        if (name === 'CodeMark') {
          // inline-code backticks only, never fenced-code fences
          const parent = node.node.parent
          if (parent && parent.name === 'InlineCode') {
            if (overlapsSelection(view, parent.from, parent.to)) return
            push(node.from, node.to, hideDeco, true)
          }
          return
        }
        if (name === 'LinkMark') {
          // `[[wiki link]]` is wikiPass's, not ours. @lezer/markdown sees the
          // inner `[Optics]` of `[[Optics]]` as a bracketed link and emits
          // LinkMarks for those brackets — so without this, BOTH passes hide the
          // same characters and the "ranges from the passes are disjoint"
          // contract in build() quietly stops holding. A wiki link's brackets
          // are always doubled, which is enough to tell them apart.
          const ch = doc.sliceString(node.from, node.to)
          if (ch === '[' && doc.sliceString(node.from - 1, node.from) === '[') return
          if (ch === '[' && doc.sliceString(node.to, node.to + 1) === '[') return
          if (ch === ']' && doc.sliceString(node.to, node.to + 1) === ']') return
          if (ch === ']' && doc.sliceString(node.from - 1, node.from) === ']') return
          const parent = node.node.parent
          // An Image's marks belong to imagePass, which replaces the WHOLE
          // `![alt](src)` with the picture. Hiding them here too would push a
          // range inside one imagePass already claimed, breaking build()'s
          // "ranges from the passes are disjoint" contract — the same trap the
          // wiki-link guard above exists for. It also fixes what the cursor
          // reveals: with these hidden, an image being edited showed its alt
          // text and URL run together with no brackets.
          if (parent && parent.name === 'Image') return
          // A `[1]` citation parses as a Link too — a shortcut reference with
          // no definition — and hiding ITS brackets turns "citation [1]." into
          // "citation 1.", quietly deleting punctuation the author wrote. Only
          // a link that actually points somewhere (has a URL child) earns
          // hidden brackets; anything else is literal text and stays as typed.
          if (parent && parent.name === 'Link') {
            let hasUrl = false
            for (let c = parent.firstChild; c; c = c.nextSibling) {
              if (c.name === 'URL') hasUrl = true
            }
            if (!hasUrl) return
          }
          if (parent && overlapsSelection(view, parent.from, parent.to)) return
          push(node.from, node.to, hideDeco, true) // [ ] ( )
          return
        }
        if (name === 'URL') {
          const parent = node.node.parent
          if (parent && parent.name === 'Link') {
            if (overlapsSelection(view, parent.from, parent.to)) return
            push(node.from, node.to, hideDeco, true)
          }
        }
      }
    })
  }
}

// Pass 2: text colour + highlight, stored as inline HTML tag pairs. Finding
// and pairing the tags lives in `colorTags.ts`, shared with the Backspace and
// empty-pair behaviours in `colorCommands.ts` — the editor must never conceal
// something the keyboard cannot act on.
const colorPass: Pass = (view, _active, push) => {
  for (const { from, to } of view.visibleRanges) {
    for (const p of colorPairs(view.state, from, to)) {
      if (isEmptyPair(p)) continue // nothing to style; colorCommands sweeps these away
      push(p.openTo, p.closeFrom, p.deco, false, true) // style the content (not atomic)
      // ALWAYS hidden — no cursor reveal, unlike every other pass here.
      // Reuben's call, 2026-08-29: `<mark class="hl-amber">` is not markdown you
      // would ever hand-edit, it is the storage format, and having twenty-odd
      // characters of HTML appear around a phrase the moment you click into it
      // made colour "look so janky" to use. A reveal earns its place for `**` or
      // a link's `(url)`, which you do fix by hand; it earns nothing here.
      //
      // Nothing is lost with it gone. "Remove colour" takes a colour off without
      // touching the tags by hand, Backspace at either edge does the same
      // (colorCommands.ts), the tags are `atomic` so the cursor steps over a
      // whole one rather than landing inside it, and **Markdown pro** still
      // shows the real source — `build()` skips every pass in raw view, so that
      // switch remains the one way to see the file as it is on disk.
      //
      // `inner: true` is load-bearing, not a tidy-up. Two mark decorations over
      // the same text nest by the ORDER their providers sit in the
      // `EditorView.decorations` facet — and it is the LAST input that ends up
      // outermost (see `outerDecorations` in @codemirror/view, documented as
      // sitting "at the very bottom of the precedence stack" and wrapping around
      // everything else). At default precedence this span wrapped the heading
      // span rather than sitting inside it:
      //
      //   <span class="hl-rose">          16px, box 21.4px tall  <- background
      //     <span class="hi">TEXT</span>  27.2px, 33px tall      <- the glyphs
      //
      // A background paints on its own element's inline box, and that box takes
      // its height from THAT element's font metrics — so on a heading the
      // highlight was drawn at body size around text half again as large, and
      // the caps and descenders sat outside it. Measured 2026-08-29 across every
      // heading level; reported by Reuben on an H1. Provided at `Prec.highest`
      // the nesting reverses — highest precedence means FIRST in the facet,
      // which means innermost — so the highlight inherits the heading's own
      // font-size and the box fits the text at every size for free, with no
      // magic padding number to maintain. Only the COLOUR marks move; everything
      // else this file pushes keeps its existing precedence, because link pills,
      // fenced code and wiki links all depend on nesting outside the highlighter
      // (see app.css's wiki-link note).
      push(p.openFrom, p.openTo, hideDeco, true) // hide open tag
      push(p.closeFrom, p.closeTo, hideDeco, true) // hide close tag
    }
  }
}

// Pass 3: fenced code blocks. The fences (```lang / ```) hide off the cursor
// line, same as every other mark; the content between them is always styled
// as a block (styling never hides anything, so it's safe to show while
// editing too — same principle as colorPass's content mark). Only the fence
// TEXT is hidden, not its trailing newline: CM6 requires a block-level
// decoration to replace an actual line break, and that's a bigger mechanism
// than a single mark warrants here — so the fence's line shows as a blank
// line rather than collapsing away entirely. `CodeMark`/`CodeInfo`/`CodeText`
// are FencedCode's own children (verified against the real @lezer/markdown
// tree, not guessed), so this never touches inline-code's CodeMark.
const fencedCodeMark = Decoration.mark({ class: 'cm-fenced-code' })
const fencedCodePass: Pass = (view, active, push) => {
  const doc = view.state.doc
  const tree = syntaxTree(view.state)
  const lineActive = (pos: number): boolean => active.has(doc.lineAt(pos).number)
  for (const { from, to } of view.visibleRanges) {
    tree.iterate({
      from,
      to,
      enter: (node) => {
        if (node.name !== 'FencedCode') return
        let contentFrom = -1
        let contentTo = -1
        for (let c = node.node.firstChild; c; c = c.nextSibling) {
          if (c.name === 'CodeMark' || c.name === 'CodeInfo') {
            if (!lineActive(c.from)) push(c.from, c.to, hideDeco, true)
          } else if (c.name === 'CodeText') {
            contentFrom = c.from
            contentTo = c.to
          }
        }
        if (contentFrom !== -1) push(contentFrom, contentTo, fencedCodeMark, false)
      }
    })
  }
}

/** The ordered list of decoration passes. Append to extend the engine. */
export const PASSES: Pass[] = [
  markdownPass,
  colorPass,
  mathPass,
  fencedCodePass,
  // Tables are NOT here: they span line breaks, which needs a block
  // decoration, which a ViewPlugin may not provide — see blockTable.ts.
  imagePass,
  videoPass,
  inlineHtmlPass,
  taskPass,
  webLinkPass,
  wikiPass
]

function build(view: EditorView): {
  decorations: DecorationSet
  hidden: DecorationSet
  inner: DecorationSet
} {
  const active = activeLineSet(view)
  const items: Deco[] = []
  const push: Push = (from, to, deco, atomic, inner) => {
    if (to > from) items.push({ from, to, deco, atomic, inner })
  }
  // Markdown pro. `highlight.ts` is untouched either way, so bold is still bold
  // and a heading is still large — the user's call over a flat monospace view,
  // and it means there is no second set of styles to keep in step with the first.
  const raw = isRaw(view.state)
  for (const pass of PASSES) pass(view, active, push)

  // RangeSetBuilder requires ascending order; ranges from the passes are disjoint.
  items.sort((a, b) => a.from - b.from || a.to - b.to)
  const all = new RangeSetBuilder<Decoration>()
  const atomic = new RangeSetBuilder<Decoration>()
  const inner = new RangeSetBuilder<Decoration>()
  for (const it of items) {
    // RAW VIEW. The passes still run, but nothing they produce may hide or
    // replace anything — the whole point of the mode is that the source is what
    // you see. What survives is exactly the ranges that would have been HIDDEN,
    // re-cast as a plain style mark: those ranges ARE the syntax marks, already
    // located by the syntax tree, so `rawMarkStyle` gets to fade or highlight
    // them without a second parser to keep in step (Reuben, 2026-08-29).
    //
    // `deco === hideDeco` is the whole test, and it is exact rather than a
    // guess: `hideDeco` is one shared instance (exported for wikiPass precisely
    // so "hidden" cannot come to mean two things). Everything else a pass
    // pushes is either a widget replacement — a bullet, a KaTeX box, a picture,
    // a checkbox — or a styling mark, and in raw view both are dropped, which
    // keeps this mode looking exactly as it did before apart from the marks.
    if (raw) {
      if (it.deco === hideDeco) all.add(it.from, it.to, rawMarkDeco)
      continue // never atomic here: these are characters you are editing
    }
    // An `inner` mark goes to its OWN set and not to `all` — adding it to both
    // would render the span twice, nested inside itself, doubling the
    // highlight's padding and its rounded ends.
    if (it.inner) inner.add(it.from, it.to, it.deco)
    else all.add(it.from, it.to, it.deco)
    if (it.atomic) atomic.add(it.from, it.to, it.deco)
  }
  return { decorations: all.finish(), hidden: atomic.finish(), inner: inner.finish() }
}

const livePreviewPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    hidden: DecorationSet
    inner: DecorationSet
    constructor(view: EditorView) {
      const r = build(view)
      this.decorations = r.decorations
      this.hidden = r.hidden
      this.inner = r.inner
    }
    update(u: ViewUpdate): void {
      // The last clause is `wikiPass`'s: whether a `[[link]]` resolves depends on
      // what is in the vault, not on this document, so creating the note a link
      // points at has to repaint it. Kept narrow on purpose — rebuilding on ANY
      // transaction would recompute the whole viewport on every cursor blink.
      if (
        u.docChanged ||
        u.selectionSet ||
        u.viewportChanged ||
        // Markdown pro toggled: rebuild with nothing hidden. `reconfigured`
        // lives on Transaction, NOT on ViewUpdate — checked against the
        // installed .d.ts rather than assumed.
        u.transactions.some((tr) => tr.reconfigured) ||
        u.transactions.some((tr) => tr.effects.some((e) => e.is(setLinkEnv)))
      ) {
        const r = build(u.view)
        this.decorations = r.decorations
        this.hidden = r.hidden
        this.inner = r.inner
      }
    }
  },
  { decorations: (v) => v.decorations }
)

// Hidden ranges are atomic so arrow keys step over them cleanly; visible styled
// text is NOT atomic (it lives in the HighlightStyle, not here).
const atomicHidden = EditorView.atomicRanges.of(
  (view) => view.plugin(livePreviewPlugin)?.hidden ?? Decoration.none
)

// The colour/highlight content marks, provided separately at the HIGHEST
// precedence so the syntax highlighter's marks wrap OUTSIDE them — which is what
// makes a highlight on a heading size itself to the heading rather than to the
// body text. `Prec.highest` rather than a position in extensions.ts's array, so
// reordering that array can't silently put the box back to body size.
//
// Verified by measurement, not by reading the facet docs — the first attempt
// used `Prec.lowest` on exactly this reasoning and changed nothing at all.
const colorInner = Prec.highest(
  EditorView.decorations.of((view) => view.plugin(livePreviewPlugin)?.inner ?? Decoration.none)
)

export const livePreview = [livePreviewPlugin, atomicHidden, colorInner]
