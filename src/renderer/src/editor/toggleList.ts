import {
  ChangeSet,
  EditorState,
  Prec,
  StateField,
  Transaction,
  type ChangeSpec,
  type Extension,
  type Range
} from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView, keymap, ViewPlugin, type ViewUpdate, WidgetType } from '@codemirror/view'
import { syntaxTree } from '@codemirror/language'
import type { SyntaxNode } from '@lezer/common'
import { completionStatus } from '@codemirror/autocomplete'
import { isolateHistory } from '@codemirror/commands'
import { isRaw } from './rawView'
import { hiddenRunEnd } from './livePreview'
import { BOUNCE_MS, motionOn } from '../tabs/tabStyles'
import {
  afterPos,
  atNoteEnd,
  findToggles,
  flipChange,
  guarded,
  OPEN_PREFIX,
  ownsTailBlank,
  SHUT_PREFIX,
  snapHead,
  SUFFIX,
  toggleAtTitle,
  toggleHolding,
  toggleText,
  unwrapSpec,
  visibleEnd,
  wrapSpec,
  zones,
  type Toggle,
  type Zone
} from './toggleModel'

// Toggle lists on screen: the arrow, the indent, the hidden lines, and the keys
// that keep the markup whole while you type round it. The storage format and
// the arithmetic live in toggleModel.ts.
//
// A StateField rather than a pass in livePreview.ts, for the reason blockMath.ts
// gives: hiding whole lines needs `block: true` decorations, which a ViewPlugin
// may not provide. Everything INSIDE a toggle is ordinary note text, so every
// other pass — headings, colour, maths, tables, pictures — works there
// unchanged; this file only indents it and hides it.
//
// Never revealed: the `<details>` markup is storage, like a colour tag, and
// Markdown pro is the one way to see it.

interface Built {
  toggles: Toggle[]
  zones: Zone[]
  decorations: DecorationSet
  atoms: DecorationSet
}

// --- the pieces drawn -------------------------------------------------------

const CHEVRON = 'M9 6l6 6-6 6'

class ArrowWidget extends WidgetType {
  constructor(readonly open: boolean) {
    super()
  }
  eq(other: ArrowWidget): boolean {
    return other.open === this.open
  }
  toDOM(view: EditorView): HTMLElement {
    const dom = document.createElement('span')
    dom.className = 'cm-toggle-arrow'
    dom.setAttribute('role', 'button')
    const NS = 'http://www.w3.org/2000/svg'
    const svg = document.createElementNS(NS, 'svg')
    svg.setAttribute('viewBox', '0 0 24 24')
    svg.setAttribute('aria-hidden', 'true')
    const path = document.createElementNS(NS, 'path')
    path.setAttribute('d', CHEVRON)
    svg.appendChild(path)
    dom.appendChild(svg)
    this.paint(dom)
    // mousedown, not click: CodeMirror places the cursor on mousedown.
    dom.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return
      e.preventDefault()
      e.stopPropagation()
      let pos: number
      try {
        pos = view.posAtDOM(dom)
      } catch {
        return
      }
      const t = toggleAtTitle(built(view.state).toggles, view.state.doc.lineAt(pos).number)
      if (t) flip(view, t)
    })
    return dom
  }
  /** Reused rather than rebuilt when a toggle opens or shuts, so the turn of
   *  the arrow can be a transition. */
  updateDOM(dom: HTMLElement): boolean {
    this.paint(dom)
    return true
  }
  private paint(dom: HTMLElement): void {
    dom.classList.toggle('cm-toggle-open', this.open)
    dom.setAttribute('aria-expanded', String(this.open))
    dom.setAttribute('aria-label', this.open ? 'Hide what is inside' : 'Show what is inside')
  }
  ignoreEvent(): boolean {
    return true
  }
}

class HintWidget extends WidgetType {
  constructor(readonly text: string) {
    super()
  }
  eq(other: HintWidget): boolean {
    return other.text === this.text
  }
  toDOM(): HTMLElement {
    const s = document.createElement('span')
    s.className = 'cm-toggle-hint'
    s.textContent = this.text
    return s
  }
  ignoreEvent(): boolean {
    return false
  }
}

const TITLE_HINT = 'Toggle'
const BODY_HINT = 'Empty toggle'

const arrowOpenDeco = Decoration.replace({ widget: new ArrowWidget(true) })
const arrowShutDeco = Decoration.replace({ widget: new ArrowWidget(false) })
const hideSuffix = Decoration.replace({})
const suffixHint = Decoration.replace({ widget: new HintWidget(TITLE_HINT) })
const bodyHint = Decoration.widget({ widget: new HintWidget(BODY_HINT), side: 1 })
// Not inclusive at its end: a block replacement is by default, which put the
// line decoration on the next line's start INSIDE it — the first line of an
// open toggle lost its indent (measured, 2026-09-27).
const hiddenLines = Decoration.replace({ block: true, inclusiveEnd: false })
const rawMark = Decoration.mark({ class: 'cm-raw-mark' })
const ATOM = Decoration.mark({})

/** A line's indent: one `--toggle-indent` per toggle it sits in — the arrow's
 *  width plus a gap, so what is inside starts clearly to the right of the
 *  title's first letter (Reuben, 2026-09-27: at least two spaces in). 28px is
 *  `.cm-line`'s gutter (highlight.ts). */
const lineDecos = new Map<string, Decoration>()
function lineDeco(depth: number, title: boolean): Decoration {
  const key = depth + (title ? 't' : 'b')
  let d = lineDecos.get(key)
  if (!d) {
    d = Decoration.line({
      class: title ? 'cm-toggle-line cm-toggle-title' : 'cm-toggle-line',
      attributes: { style: `padding-left: calc(28px + ${depth} * var(--toggle-indent))` }
    })
    lineDecos.set(key, d)
  }
  return d
}

function build(state: EditorState): Built {
  const toggles = findToggles(state)
  const doc = state.doc
  if (!toggles.length) return { toggles, zones: [], decorations: Decoration.none, atoms: Decoration.none }

  // Markdown pro: nothing hidden, the markup styled like every other mark.
  if (isRaw(state)) {
    const marks: Range<Decoration>[] = []
    for (const t of toggles) {
      marks.push(rawMark.range(t.from, t.prefixEnd), rawMark.range(t.titleEnd, t.lineEnd))
      const end = doc.line(t.endLine)
      marks.push(rawMark.range(end.from, end.to))
    }
    return { toggles, zones: [], decorations: Decoration.set(marks, true), atoms: Decoration.none }
  }

  const out: Range<Decoration>[] = []
  const atoms: Range<Decoration>[] = []
  const hidden = new Set<number>()
  // Deepest wins: outer toggles are listed first, so an inner one overwrites.
  const lines = new Map<number, { depth: number; title: boolean }>()

  for (const t of toggles) {
    if (t.hidden) continue
    out.push((t.open ? arrowOpenDeco : arrowShutDeco).range(t.from, t.prefixEnd))
    out.push((t.titleEnd === t.prefixEnd ? suffixHint : hideSuffix).range(t.titleEnd, t.lineEnd))
    lines.set(t.titleLine, { depth: t.depth, title: true })

    const after = afterPos(doc, t)
    atoms.push(ATOM.range(t.from, t.prefixEnd), ATOM.range(t.titleEnd, t.lineEnd))
    if (t.open && t.body) {
      for (let n = t.titleLine + 1; n < t.body.first; n++) hidden.add(n)
      for (let n = t.body.first; n <= t.body.last; n++) lines.set(n, { depth: t.depth + 1, title: false })
      for (let n = t.body.last + 1; n <= t.tailLine; n++) hidden.add(n)
      const first = doc.line(t.body.first)
      if (t.body.first === t.body.last && first.length === 0) out.push(bodyHint.range(first.from))
      if (first.from > t.lineEnd) atoms.push(ATOM.range(t.lineEnd, first.from))
      const last = doc.line(t.body.last).to
      if (after > last) atoms.push(ATOM.range(last, after))
    } else {
      for (let n = t.titleLine + 1; n <= t.tailLine; n++) hidden.add(n)
      if (after > t.lineEnd) atoms.push(ATOM.range(t.lineEnd, after))
    }
  }

  for (const [n, l] of lines) {
    if (!hidden.has(n)) out.push(lineDeco(l.depth, l.title).range(doc.line(n).from))
  }
  // Hidden lines go out as runs, one block per run: a nested toggle's end and
  // its parent's can share a line, and two block replacements over one line
  // is exactly what CodeMirror will not draw.
  const sorted = [...hidden].sort((a, b) => a - b)
  for (let i = 0; i < sorted.length; ) {
    let j = i
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++
    const a = sorted[i]
    const b = sorted[j]
    out.push(hiddenLines.range(doc.line(a).from, b < doc.lines ? doc.line(b + 1).from : doc.line(b).to))
    i = j + 1
  }
  return {
    toggles,
    zones: zones(doc, toggles),
    decorations: Decoration.set(out, true),
    atoms: Decoration.set(atoms, true)
  }
}

const toggleField = StateField.define<Built>({
  create: build,
  update(value, tr) {
    // The last clause: the parser caught up with a long note after it opened,
    // which is a transaction with no change in it.
    if (tr.docChanged || tr.reconfigured || syntaxTree(tr.startState) !== syntaxTree(tr.state)) return build(tr.state)
    return value
  },
  provide: (f) => [
    EditorView.decorations.from(f, (v) => v.decorations),
    EditorView.atomicRanges.of((view) => view.state.field(f, false)?.atoms ?? Decoration.none)
  ]
})

function built(state: EditorState): Built {
  return state.field(toggleField, false) ?? build(state)
}

// --- opening and shutting ---------------------------------------------------

/** Open or shut a toggle. Not an undo step — which toggles are open is how you
 *  are looking at the note, not something you wrote — but it IS in the file,
 *  so it saves like any edit. */
function flip(view: EditorView, t: Toggle): void {
  const { state } = view
  const change = flipChange(t)
  const shift = t.open ? -5 : 5
  // Shutting a toggle with the cursor inside: the cursor comes up to its title.
  const head = state.selection.main.head
  const inside = t.open && head > t.titleEnd && head <= state.doc.line(t.tailLine).to
  view.dispatch({
    changes: change,
    ...(inside && { selection: { anchor: t.titleEnd + shift } }),
    annotations: Transaction.addToHistory.of(false),
    filter: false
  })
  if (!t.open) settleIn(view, t.from)
}

/** The inside of a toggle drops into place as it opens, with a slight bounce
 *  (Reuben's ask). The tab strip's bounce length, but a 10px drop on a curve
 *  that overshoots by 18% — about 2px — because the tab strip's own 6.6% on
 *  the maths box's 6px drop measured 0.4px, which nobody can see. Each line
 *  is its own element, so they come in one after another. Nothing is left
 *  behind: `backwards` fill holds only the first frame, during the delay. */
const DROP_PX = 10
const DROP_EASE = 'cubic-bezier(0.34, 1.8, 0.64, 1)'
function settleIn(view: EditorView, from: number): void {
  if (!motionOn()) return
  const t = built(view.state).toggles.find((x) => x.from === from)
  if (!t?.body) return
  const doc = view.state.doc
  const a = doc.line(t.body.first).from
  const b = doc.line(t.body.last).to
  let i = 0
  for (const el of Array.from(view.contentDOM.children)) {
    if (!(el instanceof HTMLElement)) continue
    let pos: number
    try {
      pos = view.posAtDOM(el, 0)
    } catch {
      continue
    }
    if (pos < a || pos > b) continue
    const delay = Math.min(i++, 8) * 18
    el.animate([{ transform: `translateY(-${DROP_PX}px)` }, { transform: 'none' }], {
      duration: BOUNCE_MS,
      easing: DROP_EASE,
      delay,
      fill: 'backwards'
    })
    el.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: 160,
      easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
      delay,
      fill: 'backwards'
    })
  }
}

// --- keeping the cursor where you can see it --------------------------------

const snap = ViewPlugin.fromClass(
  class {
    update(u: ViewUpdate): void {
      if (!(u.selectionSet || u.docChanged) || isRaw(u.state)) return
      const list = built(u.state).zones
      if (!list.length) return
      const sel = u.state.selection
      if (sel.ranges.length !== 1 || !sel.main.empty) return
      const head = sel.main.head
      const was = u.changes.mapPos(u.startState.selection.main.head)
      const pointer = u.transactions.some((tr) => tr.isUserEvent('select.pointer'))
      const to = snapHead(list, head, was, pointer)
      if (to === head) return
      const view = u.view
      // An update may not dispatch; do it straight after.
      queueMicrotask(() => {
        const now = view.state.selection.main
        if (now.empty && now.head === head) view.dispatch({ selection: { anchor: to } })
      })
    }
  }
)

// --- keys -------------------------------------------------------------------

function cursorOnly(state: EditorState): number | null {
  const s = state.selection
  return s.ranges.length === 1 && s.main.empty ? s.main.head : null
}

/** The outermost block the line at `pos` belongs to ("Paragraph", a heading,
 *  a list…), or "Document" for a blank line. */
function blockKind(state: EditorState, pos: number): string {
  let n = syntaxTree(state).resolveInner(pos, 1)
  while (n.parent && n.parent.name !== 'Document') n = n.parent
  return n.name
}

/** Only plain paragraphs are joined onto the line before them: pulling a table
 *  row or a heading onto the end of a title would make nonsense of both. */
function joinable(state: EditorState, lineFrom: number): boolean {
  const k = blockKind(state, lineFrom)
  return k === 'Paragraph' || k === 'Document' || k === 'ToggleSummary'
}

/** Backspace at the start of line `n`, or Delete at `x`, where the two are
 *  separated only by hidden markup: bring `n`'s words up to `x`, the way
 *  Backspace joins two ordinary lines. An empty `n` just goes (unless `keep` —
 *  a toggle's only line inside stays, to type into). Anything that isn't a
 *  paragraph stays put and only the cursor moves. */
function join(view: EditorView, x: number, n: number, keep: boolean): void {
  const { state } = view
  const line = state.doc.line(n)
  const cut = keep ? { from: line.from, to: line.to } : { from: line.from - 1, to: line.to }
  let changes: ChangeSpec[] | null = null
  if (line.length === 0) {
    if (!keep) changes = [cut]
  } else if (blockKind(state, line.from) === 'Paragraph' && joinable(state, state.doc.lineAt(x).from)) {
    changes = [{ from: x, insert: line.text }, cut]
  }
  view.dispatch({
    ...(changes && { changes }),
    selection: { anchor: x },
    userEvent: 'delete',
    filter: false,
    scrollIntoView: true
  })
}

function backspace(view: EditorView): boolean {
  const { state } = view
  const head = cursorOnly(state)
  if (head === null || isRaw(state)) return false
  const { toggles, zones: list } = built(state)
  if (!toggles.length) return false
  const doc = state.doc
  const line = doc.lineAt(head)

  // At the start of a title: the toggle goes and its words stay (Notion's rule).
  const t = toggleAtTitle(toggles, line.number)
  if (t && !t.hidden && head === t.prefixEnd) {
    view.dispatch({ ...unwrapSpec(state, t, 0), userEvent: 'delete' })
    return true
  }
  if (head !== line.from || head === 0) return false

  // At the start of the first line inside: up onto the title.
  const h = toggleHolding(toggles, line.number)
  if (h && !h.hidden && h.open && h.body && line.number === h.body.first) {
    join(view, h.titleEnd, line.number, h.body.first === h.body.last)
    return true
  }
  // At the start of the line after a toggle: up onto whatever of it is showing.
  const x = snapHead(list, head - 1, -1, false)
  if (x !== head - 1) {
    join(view, x, line.number, false)
    return true
  }
  return false
}

function forwardDelete(view: EditorView): boolean {
  const { state } = view
  const head = cursorOnly(state)
  if (head === null || isRaw(state)) return false
  const { toggles, zones: list } = built(state)
  if (!toggles.length) return false
  const doc = state.doc
  const line = doc.lineAt(head)

  // At the end of a title: the first line inside (or, shut, the line after).
  const t = toggleAtTitle(toggles, line.number)
  if (t && !t.hidden && head === t.titleEnd) {
    if (t.open && t.body) join(view, head, t.body.first, t.body.first === t.body.last)
    else if (!atNoteEnd(doc, t)) join(view, head, doc.lineAt(afterPos(doc, t)).number, false)
    return true
  }
  if (head !== line.to) return false

  // At the end of the line above a toggle: an empty line goes, anything else
  // would pull the toggle's markup onto it.
  const below = toggles.find((b) => !b.hidden && b.from === head + 1)
  if (below) {
    if (line.length === 0) {
      view.dispatch({
        changes: { from: line.from, to: head + 1 },
        selection: { anchor: below.prefixEnd - line.length - 1 },
        userEvent: 'delete',
        filter: false
      })
    }
    return true
  }
  // At the end of the last line inside a toggle: the line after it.
  if (head < doc.length) {
    const y = snapHead(list, head + 1, head, false)
    if (y !== head + 1) {
      if (y > head + 1) join(view, head, doc.lineAt(y).number, false)
      return true
    }
  }
  return false
}

/** Where a new line goes when you step out of the bottom of `t`: straight
 *  after it, keeping (or making) the hidden blank line in between. */
function lineAfter(state: EditorState, t: Toggle): { at: number; insert: string } {
  const br = state.lineBreak
  return ownsTailBlank(t)
    ? { at: state.doc.line(t.tailLine).to, insert: br }
    : { at: state.doc.line(t.endLine).to, insert: br + br }
}

function enter(view: EditorView): boolean {
  const { state } = view
  if (isRaw(state) || completionStatus(state) === 'active') return false
  const sel = state.selection
  if (sel.ranges.length !== 1) return false
  const { toggles } = built(state)
  if (!toggles.length) return false
  const doc = state.doc
  const br = state.lineBreak
  const { from, to } = sel.main
  const line = doc.lineAt(from)

  const t = toggleAtTitle(toggles, line.number)
  if (t && !t.hidden && from >= t.prefixEnd && to <= t.titleEnd) {
    // An empty title: the toggle turns back into an ordinary line.
    if (t.titleEnd === t.prefixEnd) {
      view.dispatch({ ...unwrapSpec(state, t, 0), userEvent: 'input' })
      return true
    }
    // At the very start of a title: a new line above, the toggle moves down.
    if (to === t.prefixEnd) {
      view.dispatch({
        changes: { from: t.from, insert: br },
        selection: { anchor: t.prefixEnd + br.length },
        userEvent: 'input',
        filter: false,
        scrollIntoView: true
      })
      return true
    }
    // What follows the cursor moves down with it — unless all that follows is
    // hidden marks (a colour's closing tag), which stay with their opening one.
    const tail = to === t.titleEnd || hiddenRunEnd(view, to) >= t.titleEnd
    const rest = tail ? '' : doc.sliceString(to, t.titleEnd)
    const cut = { from, to: tail ? to : t.titleEnd }
    const kept = doc.sliceString(t.prefixEnd, cut.from) + doc.sliceString(cut.to, t.titleEnd)

    if (!t.open) {
      // Shut: a new toggle underneath, like the next item of a list.
      const next = lineAfter(state, t)
      // Something follows: keep a (hidden) blank line after the new one too.
      const insert = next.insert + toggleText(rest, [''], false, br) + (t.endLine < doc.lines ? br : '')
      const cs = ChangeSet.of([cut, { from: next.at, insert }], doc.length)
      view.dispatch({
        changes: cs,
        selection: { anchor: cs.mapPos(next.at, -1) + next.insert.length + SHUT_PREFIX.length },
        userEvent: 'input',
        filter: false,
        scrollIntoView: true
      })
      return true
    }
    if (!t.body) {
      const text = toggleText(kept, [rest], true, br)
      view.dispatch({
        changes: { from: t.from, to: doc.line(t.endLine).to, insert: text },
        // the start of the one line inside
        selection: { anchor: t.from + OPEN_PREFIX.length + kept.length + SUFFIX.length + 2 * br.length },
        userEvent: 'input',
        filter: false,
        scrollIntoView: true
      })
      return true
    }
    // Open: onto a new first line inside — or, when that line is empty
    // already and nothing is moving, simply onto it.
    const first = doc.line(t.body.first)
    const cs =
      rest === '' && first.length === 0
        ? ChangeSet.of([cut], doc.length)
        : ChangeSet.of([cut, { from: first.from, insert: rest + br }], doc.length)
    view.dispatch({
      changes: cs,
      selection: { anchor: cs.mapPos(first.from, -1) },
      userEvent: 'input',
      filter: false,
      scrollIntoView: true
    })
    return true
  }

  // Enter on an empty last line inside a toggle steps out below it.
  if (from !== to) return false
  const h = toggleHolding(toggles, line.number)
  if (h && !h.hidden && h.open && h.body && line.number === h.body.last && line.length === 0) {
    const next = lineAfter(state, h)
    const specs: ChangeSpec[] = [{ from: next.at, insert: next.insert }]
    if (h.body.first < h.body.last) specs.push({ from: line.from - 1, to: line.to })
    const cs = ChangeSet.of(specs, doc.length)
    view.dispatch({
      changes: cs,
      selection: { anchor: cs.mapPos(next.at, 1) },
      userEvent: 'input',
      filter: false,
      scrollIntoView: true
    })
    return true
  }
  return false
}

/** Cmd/Ctrl+Enter on a title opens or shuts it, as in Notion. */
function flipKey(view: EditorView): boolean {
  const head = cursorOnly(view.state)
  if (head === null || isRaw(view.state)) return false
  const t = toggleAtTitle(built(view.state).toggles, view.state.doc.lineAt(head).number)
  if (!t || t.hidden || head < t.prefixEnd || head > t.titleEnd) return false
  flip(view, t)
  return true
}

// Prec.highest: these decide before cursorSnap's Enter, the markdown Enter and
// the default Backspace/Delete — all of which would cut into hidden markup at
// exactly these spots. Each declines (returns false) everywhere else.
const toggleKeys = Prec.highest(
  keymap.of([
    { key: 'Enter', run: enter, shift: enter },
    { key: 'Backspace', run: backspace },
    { key: 'Delete', run: forwardDelete },
    { key: 'Mod-Enter', run: flipKey }
  ])
)

// --- typing ">" then a space at the start of a line -------------------------

const CODE = new Set(['FencedCode', 'CodeBlock', 'HTMLBlock', 'CommentBlock', 'ToggleSummary'])

const arrowShortcut = EditorView.inputHandler.of((view, from, to, text) => {
  if (text !== ' ' || from !== to || isRaw(view.state)) return false
  const { state } = view
  if (state.selection.ranges.length !== 1) return false
  const line = state.doc.lineAt(from)
  if (from !== line.from + 1 || line.text.charAt(0) !== '>') return false
  for (let n: SyntaxNode | null = syntaxTree(state).resolveInner(line.from, 1); n; n = n.parent) {
    if (CODE.has(n.name)) return false
  }
  const title = line.text.slice(1).replace(/^\s+/, '')
  view.dispatch({
    ...wrapSpec(state, line.number, line.number, title, 'start'),
    // Its own undo step: Cmd+Z takes you back to the ">" you typed.
    annotations: isolateHistory.of('before'),
    userEvent: 'input.type'
  })
  return true
})

// --- the guard: edits never cut into a toggle's markup ----------------------
//
// A selection that runs from a title into the lines inside it, then Backspace,
// would take `</summary>` and the blank line with it and leave half a toggle —
// raw HTML on screen. So typing, Backspace, Delete, cut and paste have the
// hidden stretches taken out of what they remove. A selection that covers a
// whole toggle removes it whole, markup and all. Titles are one line, so a
// line break pasted into one becomes a space.

const guard = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged || isRaw(tr.startState)) return tr
  if (!tr.isUserEvent('input') && !tr.isUserEvent('delete')) return tr
  const start = tr.startState
  const { toggles } = built(start)
  if (!toggles.length) return tr
  const doc = start.doc

  const list: { from: number; to: number; text: string }[] = []
  tr.changes.iterChanges((fA, tA, _fB, _tB, ins) => list.push({ from: fA, to: tA, text: ins.toString() }))
  if (list.length !== 1) return tr
  let { from, to, text } = list[0]
  let changed = false

  const title = toggles.find((t) => !t.hidden && from >= t.prefixEnd && to <= t.titleEnd)
  if (title && /[\r\n]/.test(text)) {
    text = text.replace(/\r\n|\r|\n/g, ' ')
    changed = true
  }

  if (to > from) {
    // Widen to whole toggles where the selection already covers one.
    for (const t of toggles) {
      if (t.hidden) continue
      const end = visibleEnd(doc, t)
      if (to < end) continue
      if (from < t.from || (from <= t.prefixEnd && (to > end || (t.open && !!t.body)))) {
        const a = Math.min(from, t.from)
        const b = Math.max(to, doc.line(t.endLine).to)
        if (a !== from || b !== to) changed = true
        from = a
        to = b
      }
    }
  }

  const keep = guarded(doc, toggles, (t) => from <= t.from && to >= doc.line(t.endLine).to)
  // Where the typed text goes: `from`, unless that is inside a hidden stretch.
  let at = from
  for (const g of keep) if (g.from < at && at < g.to) at = g.pre ? g.to : g.from
  if (at !== from) changed = true
  const cuts: { from: number; to: number }[] = []
  let pos = from
  for (const g of keep) {
    if (g.to <= pos || g.from >= to) continue
    changed = true
    if (g.from > pos) cuts.push({ from: pos, to: g.from })
    pos = Math.max(pos, g.to)
  }
  if (!changed) return tr
  if (pos < to) cuts.push({ from: pos, to })

  const specs: ChangeSpec[] = cuts.map((c) => ({ ...c }))
  if (text) specs.push({ from: at, insert: text })
  const cs = ChangeSet.of(specs, doc.length)
  return {
    changes: cs,
    selection: { anchor: cs.mapPos(at, 1) },
    userEvent: tr.annotation(Transaction.userEvent),
    scrollIntoView: tr.scrollIntoView,
    effects: tr.effects
  }
})

export const toggleList: Extension = [toggleField, snap, toggleKeys, arrowShortcut, guard]
