import { EditorView, ViewPlugin, type PluginValue } from '@codemirror/view'

// Show a note's scrollbar only when the pointer is near it.
//
// A scrollbar is a permanent grey stripe down the side of the writing, and in a
// split view there is one down the middle of the window between the two panes —
// which is where the eye goes, and it is not part of the note. It only appears
// at all when a note is longer than the window, so hiding it costs nothing when
// it is not needed and removes a line of furniture when it is.
//
// NEAR the edge, not "anywhere in the pane": hovering the pane is most of the
// screen, which is barely different from always showing it. The bar has to
// appear when you are reaching for it and stay gone the rest of the time.
//
// It stays fully usable — this is presentation only. The thumb is there to be
// grabbed the moment it fades in, and the track still takes a click.

/** How close to the right edge counts as reaching for it. Wide enough to catch
 *  a pointer that is aiming for the bar rather than exactly on it. */
const NEAR = 44

class Reveal implements PluginValue {
  private readonly el: HTMLElement

  constructor(view: EditorView) {
    this.el = view.scrollDOM
    // Listeners on the scroller itself rather than `EditorView.domEventHandlers`,
    // which binds to the CONTENT element: the strip of pane beside the text is
    // exactly where the pointer is when it reaches for the bar, and there is no
    // content there to hear it.
    this.el.addEventListener('pointermove', this.onMove)
    this.el.addEventListener('pointerleave', this.onLeave)
  }

  private readonly onMove = (e: PointerEvent): void => {
    const r = this.el.getBoundingClientRect()
    this.el.classList.toggle('cm-near-scrollbar', r.right - e.clientX <= NEAR)
  }

  private readonly onLeave = (): void => {
    this.el.classList.remove('cm-near-scrollbar')
  }

  destroy(): void {
    this.el.removeEventListener('pointermove', this.onMove)
    this.el.removeEventListener('pointerleave', this.onLeave)
    this.el.classList.remove('cm-near-scrollbar')
  }
}

export const scrollbarReveal = ViewPlugin.fromClass(Reveal)
