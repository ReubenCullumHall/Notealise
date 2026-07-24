import { RangeSetBuilder } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from '@codemirror/view'
import { syntaxTree } from '@codemirror/language'
import { COLOR_NAMES } from './palette'
import { mathPass } from './mathPass'

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

const hideDeco = Decoration.replace({})
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

/** Lines touched by any selection range — their syntax is revealed for editing. */
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

// Leaf mark nodes whose text is concealed on inactive lines.
const HIDE = new Set(['HeaderMark', 'EmphasisMark', 'StrikethroughMark', 'QuoteMark'])

// Pass 1: standard markdown marks, located in the syntax tree.
const markdownPass: Pass = (view, active, push) => {
  const doc = view.state.doc
  const tree = syntaxTree(view.state)
  for (const { from, to } of view.visibleRanges) {
    tree.iterate({
      from,
      to,
      enter: (node) => {
        if (active.has(doc.lineAt(node.from).number)) return // reveal active line(s)
        const name = node.name

        if (name === 'ListMark') {
          if (/^[-*+]$/.test(doc.sliceString(node.from, node.to))) {
            push(node.from, node.to, bulletDeco, true)
          }
          return
        }
        if (name === 'CodeMark') {
          // inline-code backticks only, never fenced-code fences
          const parent = node.node.parent
          if (parent && parent.name === 'InlineCode') push(node.from, node.to, hideDeco, true)
          return
        }
        if (name === 'LinkMark') {
          push(node.from, node.to, hideDeco, true) // [ ] ( )
          return
        }
        if (name === 'URL') {
          const parent = node.node.parent
          if (parent && parent.name === 'Link') push(node.from, node.to, hideDeco, true)
          return
        }
        if (HIDE.has(name)) {
          let end = node.to
          // also swallow the single space after "# " and "> "
          if ((name === 'HeaderMark' || name === 'QuoteMark') && doc.sliceString(end, end + 1) === ' ') {
            end++
          }
          push(node.from, end, hideDeco, true)
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

const colorPass: Pass = (view, active, push) => {
  const doc = view.state.doc
  const tree = syntaxTree(view.state)
  const lineActive = (pos: number): boolean => active.has(doc.lineAt(pos).number)
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
            if (!lineActive(o.openStart)) push(o.openStart, o.contentStart, hideDeco, true) // hide open tag
            if (!lineActive(node.from)) push(node.from, node.to, hideDeco, true) // hide close tag
          }
          break
        }
      }
    })
  }
}

/** The ordered list of decoration passes. Append to extend the engine. */
export const PASSES: Pass[] = [markdownPass, colorPass, mathPass]

function build(view: EditorView): { decorations: DecorationSet; hidden: DecorationSet } {
  const active = activeLineSet(view)
  const items: Deco[] = []
  const push: Push = (from, to, deco, atomic) => {
    if (to > from) items.push({ from, to, deco, atomic })
  }
  for (const pass of PASSES) pass(view, active, push)

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
      if (u.docChanged || u.selectionSet || u.viewportChanged) {
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
