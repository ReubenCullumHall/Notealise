import { EditorView } from '@codemirror/view'
import { type Layer, tagFor } from './palette'
import { recolor } from './colorModel'

// Thin CodeMirror wrappers over the pure model in colorModel.ts.

/** Apply/replace/toggle a colour on the current selection. `name === null` clears. */
export function applyColor(view: EditorView, layer: Layer, name: string | null): void {
  const sel = view.state.selection.main
  if (sel.empty) return
  const r = recolor(view.state.doc.toString(), sel.from, sel.to, tagFor(layer), name)
  if (view.state.doc.sliceString(r.from, r.to) === r.insert) {
    view.focus() // nothing to change (e.g. clearing a layer that isn't there)
    return
  }
  view.dispatch({
    changes: { from: r.from, to: r.to, insert: r.insert },
    selection: { anchor: r.selFrom, head: r.selTo }
  })
  view.focus()
}

/** Remove both highlight and text colour from the selection. */
export function clearColor(view: EditorView): void {
  applyColor(view, 'hl', null)
  applyColor(view, 'tc', null)
}
