import { StateField, type EditorState, type Extension } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView, WidgetType } from '@codemirror/view'
import katex from 'katex'

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
  constructor(readonly latex: string) {
    super()
  }
  eq(other: BlockMathWidget): boolean {
    return other.latex === this.latex
  }
  toDOM(): HTMLElement {
    const div = document.createElement('div')
    div.className = 'cm-math cm-math-display'
    try {
      div.innerHTML = katex.renderToString(this.latex, { displayMode: true, throwOnError: false })
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

function touchesSelection(state: EditorState, from: number, to: number): boolean {
  for (const r of state.selection.ranges) {
    if (r.from <= to && r.to >= from) return true
  }
  return false
}

function build(state: EditorState): DecorationSet {
  const doc = state.doc
  const decos: { from: number; to: number; deco: Decoration }[] = []
  let openLine = -1
  for (let i = 1; i <= doc.lines; i++) {
    const text = doc.line(i).text.trim()
    if (openLine === -1) {
      if (text === '$$') openLine = i
      continue
    }
    if (text === '$$') {
      const from = doc.line(openLine).from
      // A block replacement must cover whole lines: end at the start of the
      // line after the closing fence, or at the document's end if it's last.
      const to = i < doc.lines ? doc.line(i + 1).from : doc.line(i).to
      if (i > openLine + 1 && !touchesSelection(state, from, to)) {
        const latex = doc.sliceString(doc.line(openLine + 1).from, doc.line(i - 1).to)
        if (latex.trim()) {
          decos.push({ from, to, deco: Decoration.replace({ widget: new BlockMathWidget(latex), block: true }) })
        }
      }
      openLine = -1
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
    if (!tr.docChanged && !tr.selection) return value
    return build(tr.state)
  },
  provide: (f) => EditorView.decorations.from(f)
})

export const blockMath: Extension = [blockMathField]
