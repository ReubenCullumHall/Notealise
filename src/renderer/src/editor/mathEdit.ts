import { StateEffect, StateField, type EditorState } from '@codemirror/state'
import { isRaw } from './rawView'

// The maths box's memory: which formula is open in it (or has just been closed),
// where it sits in the note and how it is written. State only, on purpose —
// formatCommands.ts opens the box by dispatching `openMathEdit`, and that file
// must not pull in CodeMirror's DOM build (its tests run against a plain
// EditorState). Everything you can see — the box, the formula drawn while you
// type, the click that reopens it — is in mathEditor.ts.

/** How the formula is written in the file. All three are ordinary Markdown
 *  maths, so the note still reads in Obsidian and GitHub (CLAUDE.md rule 4):
 *  `$x$` inside a sentence, `$$x$$` on one line, or `$$` fences on lines of
 *  their own around several lines of LaTeX. */
export type MathKind = 'inline' | 'display' | 'fenced'

export interface MathSpan {
  /** the whole written formula, delimiters included */
  from: number
  to: number
  /** what goes in the box — the LaTeX without its `$` */
  latex: string
  kind: MathKind
  /** nothing else on its line — what lets Shift+Enter turn a one-line
   *  `$$x$$` into a fenced block without dragging other words along */
  alone: boolean
}

export interface MathEdit extends MathSpan {
  /** false once the box has closed: the formula stays drawn until the cursor
   *  or the text next moves, so the cursor sitting just past it doesn't
   *  instantly flip it back to raw `$…$` (the edge counts as "inside" for the
   *  keyboard reveal — livePreview.ts `cursorWithin`). */
  open: boolean
}

/** The text a formula is written as. An empty inline formula is no text at all:
 *  `$$` would read as the start of a display block. */
export function mathText(kind: MathKind, latex: string): string {
  if (kind === 'fenced') return `$$\n${latex}\n$$`
  if (kind === 'display') return `$$${latex}$$`
  return latex ? `$${latex}$` : ''
}

/** Open the box on a formula. Positions are in the document AFTER the
 *  transaction's own changes, so an insert command can write the formula and
 *  open it in one step. */
export const openMathEdit = StateEffect.define<MathSpan>()
/** A keystroke in the box, with the formula's new extent. */
export const syncMathEdit = StateEffect.define<MathEdit>()
/** Close the box: the resting formula, or null when it was emptied and removed. */
export const closeMathEdit = StateEffect.define<MathEdit | null>()

export const mathEditField = StateField.define<MathEdit | null>({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(openMathEdit)) return isRaw(tr.state) ? null : { ...e.value, open: true }
      if (e.is(syncMathEdit)) return e.value
      if (e.is(closeMathEdit)) return e.value
    }
    if (!value) return value
    // Markdown pro shows the source; the box has no place there.
    if (tr.reconfigured && isRaw(tr.state)) return null
    if (!value.open) return tr.docChanged || tr.selection ? null : value
    if (!tr.docChanged) return value
    // Something other than the box changed the note while it was open — the
    // same note typed into in another column, say. A change that reaches the
    // formula itself closes the box rather than guess which version wins.
    let touched = false
    tr.changes.iterChangedRanges((fromA, toA) => {
      if (fromA <= value.to && toA >= value.from) touched = true
    })
    if (touched) return null
    return { ...value, from: tr.changes.mapPos(value.from), to: tr.changes.mapPos(value.to) }
  }
})

/** The formula the box is open on (or resting on), if any. */
export function mathEditOf(state: EditorState): MathEdit | null {
  return state.field(mathEditField, false) ?? null
}
