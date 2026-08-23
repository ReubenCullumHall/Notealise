import { RangeSetBuilder } from '@codemirror/state'
import { isRaw } from './rawView'
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from '@codemirror/view'
import { syntaxTree } from '@codemirror/language'
import { COLOR_NAMES } from './palette'
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

/** A collected decoration. `atomic` marks a hidden/replaced range so the cursor
 *  steps over it as one unit (fed to EditorView.atomicRanges); visible styling
 *  marks are not atomic. */
export interface Deco {
  from: number
  to: number
  deco: Decoration
  atomic: boolean
}
export type Push = (from: number, to: number, deco: Decoration, atomic: boolean) => void
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

// Pass 2: text colour + highlight, stored as inline HTML tag pairs. We recognise
// both this app's palette classes (<mark class="hl-NAME">, <span class="tc-NAME">)
// AND the legacy inline-style form (<span style="color:#hex">, background-color),
// so notes written by the old app render clean here too. Tags are located as
// HTMLTag nodes in the syntax tree (never a doc regex), paired open→close; the
// content between them is styled and the tags hidden off the cursor line.
const decoCache = new Map<string, Decoration>()
const classMark = (cls: string): Decoration => {
  const key = 'c:' + cls
  let d = decoCache.get(key)
  if (!d) {
    d = Decoration.mark({ class: cls })
    decoCache.set(key, d)
  }
  return d
}
const styleMark = (style: string): Decoration => {
  const key = 's:' + style
  let d = decoCache.get(key)
  if (!d) {
    // hex-pinned upstream, so nothing arbitrary reaches the DOM as CSS
    d = Decoration.mark({ attributes: { style } })
    decoCache.set(key, d)
  }
  return d
}
const OPEN_CLASS = /^<(mark|span) class="(hl|tc)-([a-z]+)">$/
const OPEN_COLOR = /^<span style="color: *(#[0-9a-fA-F]{3,8}) *;?">$/
const OPEN_BG = /^<span style="background-color: *(#[0-9a-fA-F]{3,8}) *;?">$/

/** Recognise a colour opening tag → the tag name + the decoration for its content. */
function detectColorOpen(text: string): { tag: 'mark' | 'span'; deco: Decoration } | null {
  let m = OPEN_CLASS.exec(text)
  if (m) {
    const [, tag, variant, colour] = m
    const ok = ((tag === 'mark' && variant === 'hl') || (tag === 'span' && variant === 'tc')) && COLOR_NAMES.has(colour)
    return ok ? { tag: tag as 'mark' | 'span', deco: classMark(`${variant}-${colour}`) } : null
  }
  m = OPEN_COLOR.exec(text)
  if (m) return { tag: 'span', deco: styleMark(`color:${m[1]}`) }
  m = OPEN_BG.exec(text)
  if (m) return { tag: 'span', deco: styleMark(`background-color:${m[1]}`) }
  return null
}

const colorPass: Pass = (view, _active, push) => {
  const doc = view.state.doc
  const tree = syntaxTree(view.state)
  interface Open {
    tag: string
    deco: Decoration
    openStart: number
    contentStart: number
  }
  const stack: Open[] = []
  for (const { from, to } of view.visibleRanges) {
    tree.iterate({
      from,
      to,
      enter: (node) => {
        if (node.name !== 'HTMLTag') return
        const text = doc.sliceString(node.from, node.to)
        const open = detectColorOpen(text)
        if (open) {
          stack.push({ tag: open.tag, deco: open.deco, openStart: node.from, contentStart: node.to })
          return
        }
        if (text !== '</mark>' && text !== '</span>') return
        const tag = text === '</mark>' ? 'mark' : 'span'
        for (let i = stack.length - 1; i >= 0; i--) {
          if (stack[i].tag !== tag) continue
          const o = stack[i]
          stack.splice(i, 1)
          if (node.from > o.contentStart) {
            push(o.contentStart, node.from, o.deco, false) // style the content (not atomic)
            // one check over the whole tag pair, not per-tag-line: finishing a
            // coloured span and typing on past it (same line) should re-conceal
            // both tags, not just whichever one happens to share the cursor's line
            if (!overlapsSelection(view, o.openStart, node.to)) {
              push(o.openStart, o.contentStart, hideDeco, true) // hide open tag
              push(node.from, node.to, hideDeco, true) // hide close tag
            }
          }
          break
        }
      }
    })
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

function build(view: EditorView): { decorations: DecorationSet; hidden: DecorationSet } {
  const active = activeLineSet(view)
  const items: Deco[] = []
  const push: Push = (from, to, deco, atomic) => {
    if (to > from) items.push({ from, to, deco, atomic })
  }
  // Markdown pro. Skipping the passes wholesale is the entire implementation of
  // raw view: every mark this file hides simply stays visible. `highlight.ts` is
  // untouched, so bold is still bold and a heading is still large — the user's
  // call over a flat monospace view, and it means there is no second set of
  // styles to keep in step with the first.
  if (!isRaw(view.state)) for (const pass of PASSES) pass(view, active, push)

  // RangeSetBuilder requires ascending order; ranges from the passes are disjoint.
  items.sort((a, b) => a.from - b.from || a.to - b.to)
  const all = new RangeSetBuilder<Decoration>()
  const atomic = new RangeSetBuilder<Decoration>()
  for (const it of items) {
    all.add(it.from, it.to, it.deco)
    if (it.atomic) atomic.add(it.from, it.to, it.deco)
  }
  return { decorations: all.finish(), hidden: atomic.finish() }
}

const livePreviewPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    hidden: DecorationSet
    constructor(view: EditorView) {
      const r = build(view)
      this.decorations = r.decorations
      this.hidden = r.hidden
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

export const livePreview = [livePreviewPlugin, atomicHidden]
