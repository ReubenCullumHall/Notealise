import type { EditorView } from '@codemirror/view'

// A press on a link is either a CLICK (open it) or the start of a DRAG across
// the text (select it). Until 2026-09-25 links opened on mousedown, so a drag
// that happened to start on one could never select anything — Reuben: "when you
// drag across link text it should highlight and not open".
//
// So: take the mousedown (CodeMirror would otherwise drop a cursor inside the
// link, and a cursor inside a link is what opens its raw markdown for editing),
// then decide on the way up. Moved further than a few pixels → it was a drag,
// and the selection has been following the pointer; didn't move → open.

/** How far the pointer may wander and still count as a click. */
const SLOP = 4

export function clickOrDrag(event: MouseEvent, view: EditorView, open: () => void): void {
  event.preventDefault()
  const x0 = event.clientX
  const y0 = event.clientY
  const anchor = view.posAtCoords({ x: x0, y: y0 }, false)
  let dragging = false

  const move = (m: MouseEvent): void => {
    if (!dragging && Math.hypot(m.clientX - x0, m.clientY - y0) < SLOP) return
    if (!dragging) {
      dragging = true
      view.focus()
    }
    const head = view.posAtCoords({ x: m.clientX, y: m.clientY }, false)
    view.dispatch({ selection: { anchor, head }, userEvent: 'select.pointer', scrollIntoView: true })
  }
  const up = (): void => {
    window.removeEventListener('mousemove', move, true)
    window.removeEventListener('mouseup', up, true)
    if (!dragging) open()
  }
  window.addEventListener('mousemove', move, true)
  window.addEventListener('mouseup', up, true)
}
