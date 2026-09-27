import { ViewPlugin, type EditorView, type ViewUpdate } from '@codemirror/view'

// The Lined page look keeps every line of a note on a rule, which only holds
// if everything in the note is a whole number of rules tall. A table can be
// made so in CSS alone (its rows are lines of text); a formula on its own line
// cannot — KaTeX draws it whatever height the maths needs. So this measures
// each one and hands its height to CSS as `--snap-h`; app.css rounds that up
// to whole rules and pads the formula evenly above and below (only under
// Lined — everywhere else the number is simply unused, so switching looks
// needs nothing re-measured). The content box is what's observed, so the
// padding that answers the measurement can never trigger another one.

const SELECTOR = '.cm-math-display'

export const ruleSnap = ViewPlugin.fromClass(
  class {
    private watched = new Set<HTMLElement>()
    private observer = new ResizeObserver((entries) => {
      for (const e of entries) {
        ;(e.target as HTMLElement).style.setProperty('--snap-h', `${e.contentRect.height}px`)
      }
    })

    constructor(readonly view: EditorView) {
      this.scan()
    }

    // A plugin's update runs BEFORE CodeMirror redraws, so a formula widget
    // made by this very update doesn't exist yet — look after the redraw.
    update(u: ViewUpdate): void {
      if (u.transactions.length || u.viewportChanged || u.geometryChanged) {
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
      for (const el of this.view.contentDOM.querySelectorAll<HTMLElement>(SELECTOR)) {
        if (this.watched.has(el)) continue
        this.watched.add(el)
        this.observer.observe(el)
      }
    }

    destroy(): void {
      this.observer.disconnect()
      this.watched.clear()
    }
  }
)
