import { flushSync } from 'react-dom'
import { motionOn } from './tabStyles'

/** Dragging a column sideways by the strip along its top edge (Reuben,
 *  2026-09-26: "the only way to shift them … is with the button").
 *
 *  Same shape as `PaneDivider`: the drag writes transforms straight to the DOM
 *  and commits to React ONCE, on release — going through state on every
 *  `pointermove` would re-render every open CodeMirror to move a column a few
 *  pixels. The dragged column follows the pointer 1:1 (an eased drag reads as
 *  lag); the OTHER columns glide out of its way as it passes their middles, and
 *  on release it glides into the slot they left. Only then is `movePane` run,
 *  with every transition switched off for that one frame, so the columns
 *  swapping content and dropping their transforms land on exactly the pixels
 *  already on screen.
 *
 *  `movePane`, not `swapPanes`: the column travels, so its width travels with
 *  it — which is also the only way the preview and the committed layout agree
 *  in a three-way split with uneven widths. */

/** Pointer travel before a press becomes a drag, so a click on the strip is
 *  just a click (it focuses the column, like anywhere else in it). */
const THRESHOLD_PX = 4
/** The columns' own glide (app.css `.pane-col`), shortened — this answers a
 *  hand that is moving, not a layout that changed on its own. No overshoot: a
 *  column swinging past its slot would cross the one being carried. */
const GLIDE_MS = 220
const GLIDE = `transform ${GLIDE_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`

/** True from the first move until the dropped column has settled — a second
 *  press during the settle would measure columns that are still in flight. */
let busy = false

/** Called from the strip's `pointerdown`. `col` is the `.pane-col` being
 *  dragged; `onDrop` gets the index it should end up at, and is only called when
 *  that differs from where it started. */
export function startPaneReorder(
  e: React.PointerEvent<HTMLElement>,
  col: HTMLElement,
  onDrop: (to: number) => void
): void {
  if (e.button !== 0 || busy) return
  const handle = e.currentTarget
  const row = col.parentElement
  if (!row) return
  const id = e.pointerId
  const x0 = e.clientX
  const glide = motionOn()
  // Without this the press selects text in the editor under the pointer.
  e.preventDefault()
  handle.setPointerCapture(id)

  let cols: HTMLElement[] = []
  let rects: DOMRect[] = []
  let from = -1
  let to = -1
  let started = false

  const begin = (): void => {
    cols = [...row.children].filter((c): c is HTMLElement => c.classList.contains('pane-col'))
    from = cols.indexOf(col)
    // Measured once, before anything moves: every target position below is
    // worked out from the untransformed layout.
    rects = cols.map((c) => c.getBoundingClientRect())
    to = from
    started = from >= 0
    if (!started) return
    busy = true
    document.body.classList.add('pane-reordering')
    col.classList.add('pane-lifted')
    col.style.transition = 'none'
    for (const c of cols) if (c !== col) c.style.transition = glide ? GLIDE : 'none'
  }

  /** Where each column sits if the dragged one lands at `at`: the others keep
   *  their order and close up around it. Columns butt edge to edge (the
   *  dividers take no net width), so a left edge is the widths before it. */
  const lefts = (at: number): number[] => {
    const order = cols.map((_, i) => i).filter((i) => i !== from)
    order.splice(at, 0, from)
    const out: number[] = []
    let x = rects[0].left
    for (const i of order) {
      out[i] = x
      x += rects[i].width
    }
    return out
  }

  const move = (ev: PointerEvent): void => {
    if (ev.pointerId !== id) return
    // Released somewhere we never heard about (outside the window, focus lost).
    if (ev.buttons === 0) return end(ev)
    const raw = ev.clientX - x0
    if (!started) {
      if (Math.abs(raw) < THRESHOLD_PX) return
      begin()
      if (!started) return end(ev)
    }
    const me = rects[from]
    // Kept inside the row: a column dragged past the window edge has nowhere to go.
    const dx = Math.max(
      rects[0].left - me.left,
      Math.min(rects[rects.length - 1].right - me.right, raw)
    )
    col.style.transform = `translateX(${dx}px)`
    // A neighbour gives way once the carried column's LEADING edge passes that
    // neighbour's middle — its right edge going right, its left edge going left.
    // (Middle against middle needed a whole column's width of travel, and the
    // row's edge stops the carried column exactly on the last one's middle, so
    // the end slot could never be reached.)
    const left = me.left + dx
    const right = me.right + dx
    const at = cols.filter((_, i) => {
      if (i === from) return false
      const mid = rects[i].left + rects[i].width / 2
      return i < from ? left >= mid : right > mid
    }).length
    if (at === to) return
    to = at
    const x = lefts(at)
    cols.forEach((c, i) => {
      if (i !== from) c.style.transform = `translateX(${x[i] - rects[i].left}px)`
    })
  }

  const detach = (): void => {
    handle.removeEventListener('pointermove', move)
    handle.removeEventListener('pointerup', end)
    handle.removeEventListener('pointercancel', end)
    handle.removeEventListener('lostpointercapture', end)
    if (handle.hasPointerCapture(id)) handle.releasePointerCapture(id)
  }

  const finish = (): void => {
    for (const c of cols) c.style.transition = 'none'
    // Synchronously, so the new content and the dropped transforms reach the
    // screen in the same frame — no flash of the old order in its old place.
    if (to !== from) flushSync(() => onDrop(to))
    for (const c of cols) c.style.transform = ''
    col.classList.remove('pane-lifted')
    document.body.classList.remove('pane-reordering')
    void row.offsetWidth // settle the frame before the transitions come back
    for (const c of cols) c.style.transition = ''
    busy = false
  }

  function end(ev: PointerEvent): void {
    if (ev.pointerId !== id) return
    detach()
    if (!started) return
    // Glide into the slot the others opened, then commit.
    const x = lefts(to)
    col.style.transition = glide ? GLIDE : 'none'
    col.style.transform = `translateX(${x[from] - rects[from].left}px)`
    if (glide) window.setTimeout(finish, GLIDE_MS)
    else finish()
  }

  handle.addEventListener('pointermove', move)
  handle.addEventListener('pointerup', end)
  handle.addEventListener('pointercancel', end)
  handle.addEventListener('lostpointercapture', end)
}
