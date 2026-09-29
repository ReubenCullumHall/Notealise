import { Prec, StateField, type ChangeDesc, type EditorState, type Extension, type Transaction } from '@codemirror/state'
import {
  Decoration,
  type DecorationSet,
  EditorView,
  type Rect,
  showTooltip,
  type Tooltip,
  type TooltipView,
  WidgetType
} from '@codemirror/view'
import katex from 'katex'
import { BOUNCE, BOUNCE_MS, motionOn } from '../tabs/tabStyles'
import { fencedMathBlocks } from './blockMath'
import { scanMath } from './mathPass'
import {
  closeMathEdit,
  mathEditField,
  mathEditOf,
  mathText,
  openMathEdit,
  syncMathEdit,
  type MathEdit,
  type MathKind,
  type MathSpan
} from './mathEdit'

// ---------------------------------------------------------------------------
// The maths box (Reuben, 2026-09-26: "like Notion"). Insert a formula — the
// "/" menu, a format-bar button, Ctrl/Cmd+Shift+L — or click one already drawn,
// and a box opens under it: the LaTeX in a text field the width of the note,
// a Done button, and the formula itself drawn on the line, redrawn as you type.
//
// The note's text stays the truth throughout. Every keystroke in the box is
// written straight into the $…$ / $$…$$ it came from (so autosave, undo and
// Markdown pro see an ordinary edit); the box is only a better place to type
// it than the line itself.
//
// Arrow keys onto a formula still show its raw $…$ in the line, as before —
// Reuben's call, so moving through a note never pops a box open. Only a click
// or an insert opens one.
// ---------------------------------------------------------------------------

/** The formula the box is working on, drawn on its line: live while you type,
 *  and for a moment after Done, so the cursor resting just past it doesn't flip
 *  it back to raw text. The same classes the ordinary drawn maths wears, plus
 *  `cm-math-editing` while the box is open so the one being edited stands out. */
class EditingMathWidget extends WidgetType {
  constructor(
    readonly latex: string,
    readonly kind: MathKind,
    readonly open: boolean
  ) {
    super()
  }
  eq(other: EditingMathWidget): boolean {
    return other.latex === this.latex && other.kind === this.kind && other.open === this.open
  }
  toDOM(): HTMLElement {
    const el = document.createElement(this.kind === 'fenced' ? 'div' : 'span')
    this.paint(el)
    return el
  }
  // Redrawn in place on every keystroke rather than replaced, so the box keeps
  // measuring the same element and nothing flickers.
  updateDOM(dom: HTMLElement): boolean {
    if ((dom.tagName === 'DIV') !== (this.kind === 'fenced')) return false
    this.paint(dom)
    return true
  }
  private paint(el: HTMLElement): void {
    const display = this.kind !== 'inline'
    el.className = 'cm-math' + (this.open ? ' cm-math-editing' : '') + (display ? ' cm-math-display' : '')
    if (!this.latex.trim()) {
      el.classList.add('cm-math-empty')
      el.textContent = 'New formula'
      return
    }
    try {
      // maxSize: see mathPass.ts.
      el.innerHTML = katex.renderToString(this.latex, { displayMode: display, throwOnError: false, maxSize: 100 })
    } catch {
      el.textContent = this.latex
    }
  }
  ignoreEvent(): boolean {
    return false
  }
}

function editDecos(state: EditorState): DecorationSet {
  const e = mathEditOf(state)
  if (!e) return Decoration.none
  const widget = new EditingMathWidget(e.latex, e.kind, e.open)
  const doc = state.doc
  if (e.kind === 'fenced') {
    // A block replacement has to cover whole lines (see blockMath.ts).
    const last = doc.lineAt(e.to)
    const end = last.number < doc.lines ? doc.line(last.number + 1).from : last.to
    return Decoration.set(Decoration.replace({ widget, block: true }).range(doc.lineAt(e.from).from, end))
  }
  // An inline formula with nothing typed yet has no text to cover.
  if (e.from === e.to) return Decoration.set(Decoration.widget({ widget, side: 1 }).range(e.from))
  return Decoration.set(Decoration.replace({ widget }).range(e.from, e.to))
}

const editDecoField = StateField.define<DecorationSet>({
  create: editDecos,
  update(value, tr) {
    if (tr.startState.field(mathEditField, false) !== tr.state.field(mathEditField, false)) return editDecos(tr.state)
    return tr.docChanged ? value.map(tr.changes) : value
  },
  provide: (f) => [EditorView.decorations.from(f), EditorView.atomicRanges.of((view) => view.state.field(f))]
})

// --- writing the box back into the note -------------------------------------

/** The smallest change that turns `prev` (at `base`) into `next`. One typed
 *  character becomes a one-character edit, so undo groups a burst of typing the
 *  way it does anywhere else in the note. */
function diff(base: number, prev: string, next: string): { from: number; to: number; insert: string } {
  const max = Math.min(prev.length, next.length)
  let p = 0
  while (p < max && prev[p] === next[p]) p++
  let s = 0
  while (s < max - p && prev[prev.length - 1 - s] === next[next.length - 1 - s]) s++
  return { from: base + p, to: base + prev.length - s, insert: next.slice(p, next.length - s) }
}

function sync(view: EditorView, input: HTMLTextAreaElement): void {
  const e = mathEditOf(view.state)
  if (!e?.open) return
  let latex = input.value
  let kind = e.kind
  if (latex.includes('\n')) {
    if (kind === 'display' && e.alone) {
      // The first new line turns $$x$$ into $$ fences on lines of their own —
      // the only way several lines of LaTeX stay maths in any other editor.
      kind = 'fenced'
    } else if (kind !== 'fenced') {
      // Maths inside a sentence can't hold a line break (a paste can bring
      // one). Same length, so the caret stays where it was.
      const at = input.selectionStart
      latex = latex.replace(/\n/g, ' ')
      input.value = latex
      input.setSelectionRange(at, at)
    }
  }
  const next = mathText(kind, latex)
  view.dispatch({
    changes: diff(e.from, view.state.doc.sliceString(e.from, e.to), next),
    effects: syncMathEdit.of({ ...e, latex, kind, to: e.from + next.length })
  })
}

/** Close the box. `back` is Done, Enter or Escape: the keyboard returns to the
 *  note, just past the formula — or onto the next line after a block, the way
 *  Enter leaves any other block. Without it (a click somewhere else took the
 *  focus) the cursor stays wherever that click put it. An emptied formula is
 *  removed rather than left behind as a bare `$$$$`. */
function close(view: EditorView, back: boolean): Transaction | null {
  const e = mathEditOf(view.state)
  if (!e?.open) return null
  const doc = view.state.doc
  const latex = e.kind === 'inline' ? e.latex.trim() : e.latex
  const text = latex.trim() ? mathText(e.kind, latex) : ''
  let change = diff(e.from, doc.sliceString(e.from, e.to), text)
  const end = e.from + text.length
  // Done on a block at the very end of the note: give the cursor a line to land
  // on, as a new note's last block would.
  const tail = doc.lineAt(e.to)
  if (back && text && e.alone && tail.number === doc.lines) {
    change = { from: change.from, to: doc.length, insert: change.insert + doc.sliceString(change.to, doc.length) + '\n' }
  }
  const changes = view.state.changes(change)
  let selection: { anchor: number } | undefined
  if (back) {
    const after = changes.apply(doc)
    const line = after.lineAt(end)
    selection = {
      anchor: text && e.alone && line.number < after.lines ? after.line(line.number + 1).from : end
    }
  }
  const rest: MathEdit | null = text ? { ...e, latex, to: end, open: false } : null
  // Built before it's dispatched so the caller gets its changes back: a click
  // that closes one box to open another has to map the second formula through
  // whatever the first close removed.
  const tr = view.state.update({ changes, selection, effects: closeMathEdit.of(rest), scrollIntoView: back })
  view.dispatch(tr)
  if (back) view.focus()
  return tr
}

// --- the box -----------------------------------------------------------------

/** The space between the formula and the box. */
const GAP = 6

const SVG = 'http://www.w3.org/2000/svg'
/** The return-key arrow, drawn in the same 24-unit grid and 1.7 stroke as
 *  icons.tsx — this box is plain DOM, so it can't use the React <Icon/>. */
function enterIcon(): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', '1.7')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  svg.setAttribute('aria-hidden', 'true')
  const path = document.createElementNS(SVG, 'path')
  path.setAttribute('d', 'M19 5v6a4 4 0 0 1-4 4H5M9 11l-4 4 4 4')
  svg.append(path)
  return svg
}

/** Where the box goes: under (or over) the formula, and as wide as the note's
 *  text column — the room the LaTeX had when it was edited in the line — with
 *  the LaTeX lined up on the same left edge as the note's own words. */
function coords(view: EditorView, dom: HTMLElement, input: HTMLTextAreaElement): Rect {
  const content = view.contentDOM.getBoundingClientRect()
  const line = view.contentDOM.querySelector<HTMLElement>('.cm-line')
  const pad = line ? parseFloat(getComputedStyle(line).paddingLeft) || 0 : 0
  const cs = getComputedStyle(input)
  const inset = input.offsetLeft + input.clientLeft + (parseFloat(cs.paddingLeft) || 0)
  const left = content.left + Math.max(0, pad - inset)
  const right = content.right - Math.max(0, pad - inset)
  dom.style.width = `${Math.max(0, right - left)}px`
  const el = view.contentDOM.querySelector('.cm-math-editing')?.getBoundingClientRect()
  // Scrolled out of the note: CodeMirror hides a tooltip whose anchor is off screen.
  if (!el) return { left, right, top: -1e4, bottom: -1e4 }
  // Under the formula unless that would put it on the pane's corner buttons
  // (the eye and Markdown pro's switch, NotePane.tsx) or off the bottom of the
  // note — nothing covers a control (CLAUDE.md). Then over the formula, if
  // there's room. Returned as the rect CodeMirror places the box under.
  const scroller = view.scrollDOM.getBoundingClientRect()
  let floor = scroller.bottom
  for (const b of view.dom.closest('.edit-layer')?.querySelectorAll<HTMLElement>(':scope > button') ?? []) {
    const r = b.getBoundingClientRect()
    if (r.width && r.left < right && r.right > left) floor = Math.min(floor, r.top - GAP)
  }
  const h = dom.offsetHeight
  if (el.bottom + GAP + h > floor && el.top - 2 * GAP - h > scroller.top) {
    const bottom = el.top - 2 * GAP - h
    return { left, right, top: bottom - 1, bottom }
  }
  return { left, right, top: el.top, bottom: el.bottom }
}

/** Opens like a new note's row grows in and a new tab lands: the box unrolls
 *  from the formula on the tab strip's bounce and drops its last few pixels
 *  into place. The clip leaves room round the edges for the float shadow. */
function popIn(dom: HTMLElement): void {
  dom.animate(
    [
      { clipPath: 'inset(-20px -60px 100% -60px)', transform: 'translateY(-6px)' },
      { clipPath: 'inset(-20px -60px -60px -60px)', transform: 'translateY(0)' }
    ],
    { duration: BOUNCE_MS, easing: BOUNCE }
  )
  dom.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' })
}

/** CodeMirror takes the box out of the page before telling it so, so the close
 *  plays on a copy left in its place. Quick and quiet, like the confirm box's
 *  own exit — closing is you moving on, not an event. */
function popOut(dom: HTMLElement, value: string, parent: HTMLElement): void {
  const ghost = dom.cloneNode(true) as HTMLElement
  const field = ghost.querySelector('textarea')
  if (field) field.value = value
  ghost.inert = true
  ghost.removeAttribute('role')
  ghost.setAttribute('aria-hidden', 'true')
  ghost.style.pointerEvents = 'none'
  parent.append(ghost)
  const out = ghost.animate(
    [
      { opacity: 1, transform: 'translateY(0)' },
      { opacity: 0, transform: 'translateY(-4px)' }
    ],
    { duration: 140, easing: 'cubic-bezier(0.5, 0, 0.85, 0.35)', fill: 'forwards' }
  )
  out.onfinish = () => ghost.remove()
  out.oncancel = () => ghost.remove()
}

function createBox(view: EditorView): TooltipView {
  const dom = document.createElement('div')
  dom.className = 'cm-math-box'
  dom.setAttribute('role', 'dialog')
  dom.setAttribute('aria-label', 'Formula')

  const input = document.createElement('textarea')
  input.className = 'cm-math-input'
  input.spellcheck = false
  input.rows = 1
  input.placeholder = 'Type LaTeX, like \\frac{a}{b}'
  input.setAttribute('aria-label', 'LaTeX')
  input.setAttribute('autocapitalize', 'off')
  input.setAttribute('autocorrect', 'off')
  input.value = mathEditOf(view.state)?.latex ?? ''

  const done = document.createElement('button')
  done.type = 'button'
  done.className = 'primary cm-math-done'
  done.append('Done', enterIcon())
  dom.append(input, done)

  // The field grows with what's in it (up to a cap in app.css, then scrolls).
  const fit = (): void => {
    input.style.height = 'auto'
    input.style.height = `${input.scrollHeight + input.offsetHeight - input.clientHeight}px`
  }

  input.addEventListener('input', () => {
    fit()
    sync(view, input)
  })
  input.addEventListener('keydown', (ev) => {
    if (ev.isComposing) return
    if (ev.key === 'Escape' || (ev.key === 'Enter' && !ev.shiftKey)) {
      ev.preventDefault()
      // Escape here is the box's, not the sidebar's selection mode's.
      ev.stopPropagation()
      close(view, true)
      return
    }
    if (ev.key === 'Enter') {
      // Shift+Enter is a new line only where the formula can hold one.
      const e = mathEditOf(view.state)
      if (!e || !(e.kind === 'fenced' || (e.kind === 'display' && e.alone))) ev.preventDefault()
    }
  })
  done.addEventListener('click', () => close(view, true))

  let alive = true
  // A click or a Tab away closes the box. Switching to another app does not —
  // coming back finds it as you left it.
  dom.addEventListener('focusout', (ev) => {
    const to = ev.relatedTarget as Node | null
    if (to && dom.contains(to)) return
    setTimeout(() => {
      if (!alive || !mathEditOf(view.state)?.open) return
      if (dom.contains(document.activeElement)) return
      if (!document.hasFocus()) return
      close(view, false)
    })
  })

  let first = true
  let width = -1
  let parent: HTMLElement | null = null
  return {
    dom,
    offset: { x: 0, y: GAP },
    // Under the formula, like Notion's, and never squashed to fit — opening it
    // scrolls the note to make room (the editor keeps 40vh of space under its
    // last line, so there always is some). `coords` moves it over the formula
    // only if you then scroll it down onto the corner buttons.
    resize: false,
    getCoords: () => coords(view, dom, input),
    mount() {
      parent = dom.parentElement
      // After this update has finished: the box is still parked off screen
      // until CodeMirror measures it, hence preventScroll.
      queueMicrotask(() => {
        if (!alive) return
        input.focus({ preventScroll: true })
        input.setSelectionRange(input.value.length, input.value.length)
        const e = mathEditOf(view.state)
        // Room for the box plus the corner buttons under it.
        const room = Math.min(window.innerHeight * 0.45, Math.max(160, dom.offsetHeight + 100))
        if (e) view.dispatch({ effects: EditorView.scrollIntoView(e.to, { y: 'nearest', yMargin: room }) })
      })
    },
    positioned() {
      // The width is only known once CodeMirror has placed the box, so the
      // field's height is worked out again at its real width.
      if (dom.offsetWidth !== width) {
        width = dom.offsetWidth
        fit()
      }
      if (!first) return
      first = false
      if (motionOn()) popIn(dom)
    },
    destroy() {
      alive = false
      if (motionOn() && parent?.isConnected) popOut(dom, input.value, parent)
    }
  }
}

const boxTooltip = showTooltip.compute([mathEditField], (state): Tooltip | null => {
  const e = mathEditOf(state)
  return e?.open ? { pos: e.from, above: false, strictSide: true, create: createBox } : null
})

// --- opening it on a formula that's already there -----------------------------

/** The formula whose drawn form starts at `pos` — found the same way the two
 *  renderers found it (blockMath.ts for fenced blocks, mathPass.ts for the rest). */
function findMathAt(state: EditorState, pos: number): MathSpan | null {
  const doc = state.doc
  const line = doc.lineAt(pos)
  if (line.text.trim() === '$$') {
    for (const b of fencedMathBlocks(doc)) {
      if (b.open !== line.number) continue
      const open = doc.line(b.open)
      const shut = doc.line(b.close)
      return {
        from: open.from + open.text.indexOf('$$'),
        to: shut.from + shut.text.indexOf('$$') + 2,
        latex: doc.sliceString(doc.line(b.open + 1).from, doc.line(b.close - 1).to),
        kind: 'fenced',
        alone: true
      }
    }
    return null
  }
  let found: MathSpan | null = null
  scanMath(line.text, line.from, (from, to, latex, display) => {
    if (found || pos < from || pos >= to) return
    found = {
      from,
      to,
      latex,
      kind: display ? 'display' : 'inline',
      alone: line.text.trim() === doc.sliceString(from, to)
    }
  })
  return found
}

function mapSpan(span: MathSpan, changes: ChangeDesc): MathSpan {
  return { ...span, from: changes.mapPos(span.from, 1), to: changes.mapPos(span.to, -1) }
}

// A click on drawn maths opens the box on it. Prec.high so it is decided here,
// before any gesture further down treats the widget as an ordinary click.
const clickToEdit = Prec.high(
  EditorView.domEventHandlers({
    mousedown(ev, view) {
      if (ev.button !== 0 || ev.shiftKey || ev.metaKey || ev.ctrlKey || ev.altKey) return false
      const el = (ev.target as Element | null)?.closest?.('.cm-math')
      if (!el || !view.contentDOM.contains(el)) return false
      const current = mathEditOf(view.state)
      if (current?.open && el.classList.contains('cm-math-editing')) {
        // Already open on this one: keep typing.
        ev.preventDefault()
        view.dom.querySelector<HTMLTextAreaElement>('.cm-math-box:not([inert]) .cm-math-input')?.focus()
        return true
      }
      let span = findMathAt(view.state, view.posAtDOM(el))
      if (!span) return false
      // preventDefault keeps the focus where it is until the box takes it — and
      // keeps CodeMirror from dropping the cursor into the formula, which is
      // the arrow-key path's raw view.
      ev.preventDefault()
      if (current?.open) {
        const tr = close(view, false)
        if (tr?.docChanged) span = mapSpan(span, tr.changes)
      }
      view.dispatch({ effects: openMathEdit.of(span), selection: { anchor: span.to } })
      return true
    }
  })
)

export const mathEditor: Extension = [mathEditField, editDecoField, boxTooltip, clickToEdit]
