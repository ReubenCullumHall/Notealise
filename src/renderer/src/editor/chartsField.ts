import { EditorSelection, EditorState, StateField, type Extension, type Transaction } from '@codemirror/state'
import { findCharts, type ChartBlock } from '../../../shared/charts'
import { isRaw } from './rawView'

// Where a note's Mermaid charts are. State only (no drawing, no window), so the block guards and
// their tests can ask without loading the drawing tool.

/** What a line of text needs to touch for the note's charts to have changed. */
const FENCE_LIKE = /^ {0,3}(?:`{3}|~{3})|^\s*\$\$|^---/m

function rescanNeeded(charts: readonly ChartBlock[], tr: Transaction): boolean {
  let needed = false
  const before = tr.startState.doc
  const after = tr.newDoc
  tr.changes.iterChangedRanges((fromA, toA, fromB, toB) => {
    if (needed) return
    if (charts.some((c) => fromA <= c.to && toA >= c.from)) {
      needed = true
      return
    }
    const oldText = before.sliceString(before.lineAt(fromA).from, before.lineAt(toA).to)
    const newText = after.sliceString(after.lineAt(fromB).from, after.lineAt(toB).to)
    needed = FENCE_LIKE.test(oldText) || FENCE_LIKE.test(newText)
  })
  return needed
}

/** Every chart in the note. Worked out again only when an edit could have changed one: this
 *  runs on every key, in every note, and nearly all of them have no charts at all. */
export const chartsField = StateField.define<readonly ChartBlock[]>({
  create: (state) => findCharts(state.doc.toString()),
  update(value, tr) {
    if (!tr.docChanged) return value
    if (rescanNeeded(value, tr)) return findCharts(tr.newDoc.toString())
    if (!value.length) return value
    return value.map((c) => ({
      ...c,
      from: tr.changes.mapPos(c.from),
      to: tr.changes.mapPos(c.to),
      bodyFrom: tr.changes.mapPos(c.bodyFrom),
      closeFrom: tr.changes.mapPos(c.closeFrom)
    }))
  }
})

/** Find & Replace and a chart's hidden text (Reuben, 2026-11-22: "Find yes, Replace no").
 *  Find lands on the card, picked whole, because its words are behind it. Replace leaves charts
 *  alone, so a common word can't quietly break one you can't see. Markdown pro shows the text,
 *  so there it is ordinary text. */
export const chartSearch: Extension = EditorState.transactionFilter.of((tr) => {
  const replacing = tr.isUserEvent('input.replace')
  if (!replacing && !tr.isUserEvent('select.search')) return tr
  if (isRaw(tr.startState)) return tr
  const charts = tr.startState.field(chartsField, false)
  if (!charts?.length) return tr

  if (!replacing) {
    if (tr.docChanged || tr.newSelection.ranges.length > 1) return tr
    const { from, to } = tr.newSelection.main
    const c = charts.find((x) => from >= x.from && to <= x.to)
    if (!c) return tr
    return { selection: EditorSelection.single(c.from, c.to), effects: tr.effects, scrollIntoView: true, userEvent: 'select.search' }
  }

  const kept: { from: number; to: number; insert: string }[] = []
  let skipped: ChartBlock | null = null
  tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    const hit = charts.find((c) => fromA < c.to && toA > c.from)
    if (hit) skipped ??= hit
    else kept.push({ from: fromA, to: toA, insert: inserted.toString() })
  })
  if (!skipped) return tr
  const passed: ChartBlock = skipped
  // Replace pressed on a chart's match: nothing to change there, so step past it.
  if (!kept.length) {
    return { selection: { anchor: Math.min(passed.to + 1, tr.startState.doc.length) }, scrollIntoView: true, userEvent: 'select.search' }
  }
  return { changes: kept, effects: tr.effects, userEvent: 'input.replace.all' }
})
