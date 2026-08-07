import { Decoration, EditorView, WidgetType } from '@codemirror/view'
import { syntaxTree } from '@codemirror/language'
import { overlapsSelection, type Pass } from './livePreview'

// GFM task lists: `- [ ] thing` / `- [x] thing`. The `[ ]` is replaced by a real
// checkbox you can click, and the raw brackets come back when the cursor is in
// the line — the same reveal-to-edit contract as every other pass.
//
// Node shape verified against the real @lezer/markdown tree (GFM is on):
//   ListItem > ListMark "-" , Task > TaskMarker "[x]" , text
//
// Worth having beyond tidiness: an imported Google Keep checklist is a list of
// ticked and unticked items, and without this it reads as literal "[x]" text —
// the tick state is there in the file but invisible as anything but punctuation.
class CheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean) {
    super()
  }

  eq(other: CheckboxWidget): boolean {
    return other.checked === this.checked
  }

  toDOM(): HTMLElement {
    const box = document.createElement('span')
    box.className = 'cm-task' + (this.checked ? ' cm-task-done' : '')
    box.setAttribute('role', 'checkbox')
    box.setAttribute('aria-checked', String(this.checked))
    return box
  }

  ignoreEvent(): boolean {
    return false
  }
}

export const taskPass: Pass = (view, _active, push) => {
  const doc = view.state.doc
  const tree = syntaxTree(view.state)
  for (const { from, to } of view.visibleRanges) {
    tree.iterate({
      from,
      to,
      enter: (node) => {
        if (node.name !== 'TaskMarker') return
        // A task marker owns its line's opening, so an overlap check keeps the
        // brackets editable while the cursor is in them.
        if (overlapsSelection(view, node.from, node.to)) return
        const checked = /x/i.test(doc.sliceString(node.from, node.to))
        push(node.from, node.to, Decoration.replace({ widget: new CheckboxWidget(checked) }), true)
      }
    })
  }
}

/** Clicking a checkbox ticks it — by editing the `[ ]`/`[x]` in the text, which
 *  is the only state there is. A checklist you can look at but not tick would
 *  be a picture of a checklist. */
export const taskClick = EditorView.domEventHandlers({
  mousedown: (event, view) => {
    const el = (event.target as HTMLElement | null)?.closest?.('.cm-task')
    if (!el || event.button !== 0) return false
    const pos = view.posAtDOM(el)
    const line = view.state.doc.lineAt(pos)
    const m = /^(\s*[-*+]\s+\[)([ xX])(\])/.exec(line.text)
    if (!m) return false
    event.preventDefault()
    const at = line.from + m[1].length
    view.dispatch({
      changes: { from: at, to: at + 1, insert: m[2] === ' ' ? 'x' : ' ' },
      // Keep the cursor out of the line, or the replacement immediately
      // reveals the raw brackets under the pointer.
      selection: { anchor: line.to }
    })
    return true
  }
})
