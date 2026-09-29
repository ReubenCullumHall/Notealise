import { Prec, RangeSetBuilder, StateField, type EditorState, type Extension, type Text } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView, keymap, WidgetType } from '@codemirror/view'
import katex from 'katex'
import { isRaw } from './rawView'
import { mathEditField, mathEditOf } from './mathEdit'
import { depthOfLine, findToggles, hiddenLine } from './toggleModel'

// Multi-line $$ math source (opening "$$" and closing "$$" each alone on their
// own line, with the LaTeX in between). mathPass in livePreview.ts already
// renders single-line $$...$$ and inline $...$; it deliberately leaves this
// case raw because a plain ViewPlugin can't replace text across a line break
// with an inline decoration — CM6 requires `block: true` for that, and a
// block replacement's range must exactly cover whole lines (from a line
// start to the start of the following line). That's a different enough
// contract from the atomic-range trick the rest of livePreview.ts uses that
// it lives in its own StateField here rather than joining PASSES.

class BlockMathWidget extends WidgetType {
  constructor(
    readonly latex: string,
    /** how many toggle lists it sits inside — a block is not a line, so the
     *  toggle's line indent never reaches it (toggleList.ts) */
    readonly depth = 0
  ) {
    super()
  }
  eq(other: BlockMathWidget): boolean {
    return other.latex === this.latex && other.depth === this.depth
  }
  toDOM(): HTMLElement {
    const div = document.createElement('div')
    div.className = 'cm-math cm-math-display'
    if (this.depth) {
      div.classList.add('cm-in-toggle')
      div.style.setProperty('--toggle-depth', String(this.depth))
    }
    try {
      div.innerHTML = katex.renderToString(this.latex, { displayMode: true, throwOnError: false, maxSize: 100 })
    } catch {
      div.className = 'math-error'
      div.textContent = '$$' + this.latex + '$$'
    }
    return div
  }
  ignoreEvent(): boolean {
    return false
  }
}

/** Every multi-line `$$` block, as the line numbers of its two fences. Pairs
 *  from the top, the way the renderer reads them; exported so a click on a
 *  drawn block (mathEditor.ts) finds the same block this file drew. */
export function fencedMathBlocks(doc: Text): { open: number; close: number }[] {
  const out: { open: number; close: number }[] = []
  let openLine = -1
  for (let i = 1; i <= doc.lines; i++) {
    if (doc.line(i).text.trim() !== '$$') continue
    if (openLine === -1) {
      openLine = i
      continue
    }
    if (i > openLine + 1) out.push({ open: openLine, close: i })
    openLine = -1
  }
  return out
}

function build(state: EditorState): DecorationSet {
  if (isRaw(state)) return Decoration.none // Markdown pro: show the $$ source
  const doc = state.doc
  // The block open in the maths box (or just closed from it) is drawn by
  // mathEditor.ts, live as you type, so it is left alone here.
  const edit = mathEditOf(state)
  const decos: { from: number; to: number; deco: Decoration }[] = []
  const toggles = findToggles(state)
  for (const { open, close } of fencedMathBlocks(doc)) {
    // Inside a shut toggle: not drawn at all, the toggle hides those lines.
    if (hiddenLine(toggles, open)) continue
    const from = doc.line(open).from
    // A block replacement must cover whole lines: end at the start of the
    // line after the closing fence, or at the document's end if it's last.
    const to = close < doc.lines ? doc.line(close + 1).from : doc.line(close).to
    // No reveal for the cursor or a selection, ever: the raw $$ never shows
    // outside Markdown pro (Reuben, 2026-09-27). It is edited in the maths box.
    if (edit && edit.from < to && edit.to > from) continue
    const latex = doc.sliceString(doc.line(open + 1).from, doc.line(close - 1).to)
    if (latex.trim()) {
      decos.push({
        from,
        to,
        deco: Decoration.replace({ widget: new BlockMathWidget(latex, depthOfLine(toggles, open)), block: true })
      })
    }
  }
  return Decoration.set(
    decos.map((d) => d.deco.range(d.from, d.to)),
    true
  )
}

const blockMathField = StateField.define<DecorationSet>({
  create: build,
  update(value, tr) {
    // `reconfigured` is Markdown pro being toggled — a transaction with neither
    // a doc change nor a selection change, so without it the rendered maths
    // would linger until the next keystroke.
    // The last clause: the maths box opening or closing on a block hands its
    // drawing between this file and mathEditor.ts.
    if (
      !tr.docChanged &&
      !tr.selection &&
      !tr.reconfigured &&
      tr.startState.field(mathEditField, false) === tr.state.field(mathEditField, false)
    )
      return value
    return build(tr.state)
  },
  provide: (f) => EditorView.decorations.from(f)
})

// --- keeping the cursor out of a drawn block's `$$` lines ----------------------
//
// A drawn block is one thing on screen, but underneath it is three or more lines
// of text, and a cursor that lands on the `$$` line itself — then a keystroke
// there — breaks the fence and turns the whole block back into raw source
// (Reuben, 2026-09-27: "make sure this never happens"). So, outside Markdown pro:
//   • the cursor can't rest inside a block — it steps from the end of the line
//     above straight to the start of the line below (`guard`, atomic);
//   • Backspace from the line below / Delete from the line above take the block
//     out as one piece, the way they take out an inline formula, and never join
//     the lines either side of it together; on a BLANK line beside a block they
//     remove just that blank line, so tidying up after an Enter can't lose a
//     formula;
//   • typing at the very start or end of a note, beside a block that sits there,
//     goes onto a line of its own.

/** The range the cursor must not sit inside: from the end of the line above the
 *  block to the start of the line below it. Both ends are ordinary places to
 *  type. `to` is the block's own replaced range end (the next line's start, or
 *  the note's end when the block is last). */
function guard(from: number, to: number): { from: number; to: number } {
  return { from: from > 0 ? from - 1 : 0, to }
}

const ATOM = Decoration.mark({})
const blockAtomic = EditorView.atomicRanges.of((view) => {
  const set = view.state.field(blockMathField, false)
  if (!set || set.size === 0) return Decoration.none
  const out = new RangeSetBuilder<Decoration>()
  set.between(0, view.state.doc.length, (from, to) => {
    const g = guard(from, to)
    out.add(g.from, g.to, ATOM)
  })
  return out.finish()
})

/** The drawn block whose guard edge the cursor sits on, on the side `forward`
 *  says the key reaches towards. */
function blockBeside(state: EditorState, forward: boolean): { from: number; to: number } | null {
  if (isRaw(state) || state.selection.ranges.length > 1 || !state.selection.main.empty) return null
  const head = state.selection.main.head
  let hit: { from: number; to: number } | null = null
  state.field(blockMathField, false)?.between(0, state.doc.length, (from, to) => {
    const g = guard(from, to)
    if (forward ? head === g.from : head === g.to) {
      hit = { from, to }
      return false
    }
    return undefined
  })
  return hit
}

function backspaceBlock(view: EditorView): boolean {
  const { state } = view
  const b = blockBeside(state, false)
  if (!b) return false
  const doc = state.doc
  let del: { from: number; to: number }
  if (b.to === doc.length) {
    // Last thing in the note: the block and the line break before it.
    del = { from: b.from > 0 ? b.from - 1 : 0, to: doc.length }
  } else {
    const below = doc.lineAt(b.to)
    if (below.length === 0) {
      // A blank line under the block: remove only that line.
      del = below.number < doc.lines ? { from: below.from, to: below.from + 1 } : { from: below.from - 1, to: below.from }
    } else {
      del = { from: b.from, to: b.to }
    }
  }
  view.dispatch({
    changes: del,
    selection: { anchor: del.from },
    userEvent: 'delete.backward',
    scrollIntoView: true
  })
  return true
}

function deleteBlock(view: EditorView): boolean {
  const { state } = view
  const b = blockBeside(state, true)
  if (!b) return false
  const doc = state.doc
  let del: { from: number; to: number }
  let anchor = state.selection.main.head
  if (b.from === 0) {
    del = { from: 0, to: b.to }
  } else {
    const above = doc.lineAt(b.from - 1)
    if (above.length === 0) {
      // A blank line over the block: remove only that line.
      del = above.number > 1 ? { from: above.from - 1, to: above.from } : { from: 0, to: 1 }
      anchor = del.from
    } else {
      del = b.to === doc.length ? { from: b.from - 1, to: doc.length } : { from: b.from, to: b.to }
    }
  }
  view.dispatch({ changes: del, selection: { anchor }, userEvent: 'delete.forward', scrollIntoView: true })
  return true
}

// Prec.high: decided here before the default Backspace/Delete, which would
// otherwise delete across the guard and join the lines either side.
const blockKeys = Prec.high(
  keymap.of([
    { key: 'Backspace', run: backspaceBlock },
    { key: 'Delete', run: deleteBlock }
  ])
)

// Typing at the note's very start or end, when a block sits there, would go
// onto the block's own `$$` line (the guard has nowhere else to put the cursor).
const blockTyping = EditorView.inputHandler.of((view, from, to, text) => {
  if (from !== to || isRaw(view.state)) return false
  const doc = view.state.doc
  let edit: { at: number; insert: string; cursor: number } | null = null
  view.state.field(blockMathField, false)?.between(0, doc.length, (bFrom, bTo) => {
    if (bFrom === 0 && from === 0) edit = { at: 0, insert: text + '\n', cursor: text.length }
    else if (bTo === doc.length && from === doc.length) edit = { at: from, insert: '\n' + text, cursor: from + 1 + text.length }
  })
  if (!edit) return false
  const e: { at: number; insert: string; cursor: number } = edit
  view.dispatch({ changes: { from: e.at, insert: e.insert }, selection: { anchor: e.cursor }, userEvent: 'input.type' })
  return true
})

export const blockMath: Extension = [blockMathField, blockAtomic, blockKeys, blockTyping]
