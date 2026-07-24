import { EditorSelection } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { mathInsert, wrapRange } from './formatModel'

// Toolbar/keymap formatting. Bold/italic/strikethrough are plain Markdown;
// underline has no Markdown syntax so it uses inline HTML (<u>), the same as
// Obsidian. Math is a $$…$$ block. All operate on the live EditorView.

function toggleWrap(view: EditorView, open: string, close: string = open): void {
  const doc = view.state.doc.toString()
  view.dispatch(
    view.state.changeByRange((range) => {
      const r = wrapRange(doc, range.from, range.to, open, close)
      return {
        changes: { from: r.from, to: r.to, insert: r.insert },
        range: EditorSelection.range(r.selFrom, r.selTo)
      }
    })
  )
  view.focus()
}

export const bold = (view: EditorView): void => toggleWrap(view, '**')
export const italic = (view: EditorView): void => toggleWrap(view, '*')
export const underline = (view: EditorView): void => toggleWrap(view, '<u>', '</u>')
export const strike = (view: EditorView): void => toggleWrap(view, '~~')

/** Insert a $$…$$ math block; wraps the selection, or drops the cursor between $$$$. */
export function insertMath(view: EditorView): void {
  const { from, to } = view.state.selection.main
  const inner = view.state.doc.sliceString(from, to)
  const insert = mathInsert(inner)
  view.dispatch({
    changes: { from, to, insert },
    selection: inner ? { anchor: from + 2, head: from + 2 + inner.length } : { anchor: from + 2 }
  })
  view.focus()
}
