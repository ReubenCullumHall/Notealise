import { ViewPlugin, type EditorView, type PluginValue, type ViewUpdate } from '@codemirror/view'

// Tell CodeMirror when anything in the note changes height on its own (2026-11-07).
//
// CodeMirror keeps a map of where every line is and measures it when IT changes something — not
// when a widget grows later. A voice note draws small and grows to its full height once its
// recording is read; a maths block grows when KaTeX lays it out; a table when its fonts land. Until
// something else made the editor measure again, every line below sat up to ~70px away from where
// the editor believed it was — so a click, the six dots under the pointer and a drop all aimed at
// the wrong block (Reuben: "they don't work when moving around easily or consistently").
// `remeasureWhenSized` (attachSelect.ts) did this for pictures alone; this covers everything.
//
// One ResizeObserver on every top-level line and block on screen; a height change asks for one
// measure (CodeMirror batches them).

/** Make the editor re-read every line's height on its next measure. A plain `requestMeasure()` is
 *  not enough: CodeMirror only re-reads heights when its own content changed or the whole content
 *  box changed height, and a widget growing inside it is neither (measured 2026-11-07: a forced
 *  `requestMeasure()` left a voice note 30px short in its map). The flag is the one CodeMirror sets
 *  itself when fonts finish loading (`viewState.mustMeasureContent`, @codemirror/view 6.43) —
 *  internal, so it is set only if it is there; without it this falls back to the plain ask. */
function remeasure(view: EditorView): void {
  const state = (view as unknown as { viewState?: { mustMeasureContent?: boolean | string } }).viewState
  if (state && 'mustMeasureContent' in state && state.mustMeasureContent !== 'refresh') state.mustMeasureContent = true
  view.requestMeasure()
}

class SizeWatch implements PluginValue {
  private readonly watched = new Set<Element>()
  // Every report asks, the first one too: a block can finish growing between CodeMirror's own
  // measure and this starting to watch it, and its first report is then the only news of it.
  // CodeMirror folds however many asks arrive into one measure.
  private readonly observer = new ResizeObserver(() => remeasure(this.view))

  constructor(private readonly view: EditorView) {
    this.scan()
  }

  update(u: ViewUpdate): void {
    // After CodeMirror has drawn this update's lines and blocks.
    if (u.docChanged || u.viewportChanged || u.geometryChanged || u.transactions.length) {
      this.view.requestMeasure({ key: this, read: () => this.scan() })
    }
  }

  private scan(): void {
    for (const el of this.watched) {
      if (!el.isConnected) {
        this.observer.unobserve(el)
        this.watched.delete(el)
      }
    }
    for (const el of Array.from(this.view.contentDOM.children)) {
      if (this.watched.has(el)) continue
      this.watched.add(el)
      this.observer.observe(el)
    }
  }

  destroy(): void {
    this.observer.disconnect()
  }
}

export const sizeWatch = ViewPlugin.fromClass(SizeWatch)
