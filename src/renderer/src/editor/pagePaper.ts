import { ViewPlugin, type EditorView } from '@codemirror/view'

// The page look is painted on a sheet BEHIND the editor (NotePane's `.page-paper`,
// app.css), not on CodeMirror's scroller. That is what lets it run up behind the
// note's name and fade out at every edge without fading a single word — a fade
// on the scroller would take the text with it. Reuben, 2026-10-02.
//
// The sheet scrolls with the note by CSS alone (a scroll timeline, app.css), so
// nothing here runs while you scroll. What CSS can't know is where the text
// starts and how far the note scrolls, and those are the three numbers this
// hands over, as variables on the pane's `.edit-layer`:
//
//   --paper-origin    where line 1's box starts, from the top of the pane. The
//                     pattern is laid from here, so the rules and squares keep
//                     the place under the text they always had.
//   --paper-scroller  where the scroller starts (the tint begins here, and so
//                     does Lined, which doesn't run up behind the name).
//   --paper-range     how far the note scrolls — only to make the sheet tall
//                     enough to cover it.
//
// The first two move only when the scroller does (the name's row getting
// smaller in a split, the find bar opening above the text, the links strip
// pinned or not), which changes the scroller's height; the third whenever the
// note's length changes. The observer hears both, after layout and before the
// frame is drawn, so the sheet is never a frame behind.

class Paper {
  private layer: HTMLElement | null = null
  private readonly observer = new ResizeObserver(() => this.measure())

  constructor(readonly view: EditorView) {
    // A plugin is built before CodeMirror attaches its DOM to the page, so the
    // pane isn't findable yet — look once the first measure cycle runs.
    view.requestMeasure({ key: this, read: () => this.attach() })
  }

  private attach(): void {
    if (this.layer) return
    // Only a note pane has the sheet; the onboarding demo editor has none.
    this.layer = this.view.dom.closest<HTMLElement>('.edit-layer')
    if (!this.layer) return
    // Observing reports each element once straight away, which is the first
    // measurement — outside CodeMirror's read phase, where a write would force
    // a second layout.
    this.observer.observe(this.view.scrollDOM)
    this.observer.observe(this.view.contentDOM)
  }

  private measure(): void {
    const layer = this.layer
    if (!layer || !layer.isConnected) return
    const sc = this.view.scrollDOM
    const box = layer.getBoundingClientRect()
    // A split column opens with a transform on it; measuring in the layer's own
    // pixels keeps the numbers right mid-animation.
    const scale = layer.offsetHeight ? box.height / layer.offsetHeight : 1
    const top = (sc.getBoundingClientRect().top - box.top) / (scale || 1)
    const pad = parseFloat(getComputedStyle(sc).paddingTop) || 0
    layer.style.setProperty('--paper-scroller', `${top}px`)
    layer.style.setProperty('--paper-origin', `${top + pad}px`)
    layer.style.setProperty('--paper-range', `${Math.max(0, sc.scrollHeight - sc.clientHeight)}px`)
  }

  destroy(): void {
    this.observer.disconnect()
  }
}

export const pagePaper = ViewPlugin.fromClass(Paper)
