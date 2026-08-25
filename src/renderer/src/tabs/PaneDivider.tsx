import { useEffect, useRef, useState } from 'react'
import { MIN_PANE_PX } from './model'

/** The draggable seam between two columns.
 *
 *  **It takes no net width.** An 11px box with -5.5px margins either side gives
 *  back exactly what it costs, so the panes' own fractions still describe the
 *  whole row and adding dividers changes no arithmetic — while the element keeps
 *  a real hit area, focus target and bounding box. What you see at rest is
 *  `NotePane`'s existing `border-l`, which the divider's centre lands on; this
 *  only draws a brighter line *over* that border on hover and while dragging.
 *  The resting appearance of a split does not change.
 *
 *  **The drag is not animated, deliberately.** The seam tracks the pointer 1:1;
 *  a divider that eases toward your finger reads as lag, not as polish. The
 *  motion in this feature lives everywhere else — the line waking on hover, the
 *  columns gliding when one opens, closes or is reset. `body.pane-resizing` is
 *  what suppresses the column transition for the duration of a drag, so the two
 *  never fight. A keyboard nudge deliberately does NOT set it: 24px arriving
 *  instantly reads as a glitch, where 24px gliding reads as a nudge.
 *
 *  **A drag writes `flex-grow` straight to the DOM and commits to React once, on
 *  release.** Going through state on every `pointermove` would re-render App —
 *  and with it every open CodeMirror — sixty times a second, to move a line two
 *  pixels. The elements it writes to are exactly the two it resizes by
 *  construction (`previousElementSibling` / `nextElementSibling`), which is also
 *  why no ref list has to be threaded down and kept in step with the pane array.
 *  The commit on release then re-renders once with the same numbers, so there is
 *  nothing to see at the hand-off. */
interface Props {
  /** the pane this divider sits to the LEFT of — `resizePanes`' `at` (1-based,
   *  since pane 0 has no divider before it) */
  at: number
  /** raw pixel widths for the pair; `resizePanes` normalises them */
  onResize: (at: number, left: number, right: number) => void
  /** double-click, Enter or Space — put every column back to even */
  onReset: () => void
  /** e.g. "Resize Meeting notes and Ideas" */
  label: string
}

/** How far one arrow-key press moves the seam. Big enough to be worth pressing,
 *  small enough to land on a width you meant. */
const NUDGE_PX = 24

interface DragFrom {
  id: number
  x: number
  /** pixel widths of the pair when the drag began */
  left: number
  right: number
  /** their `flex-grow` numbers, whose sum this drag redistributes and preserves */
  grow: number
  /** the last widths written, for the single commit on release; null until the
   *  pointer actually moves, so a plain click commits nothing */
  last: { left: number; right: number } | null
}

export function PaneDivider({ at, onResize, onReset, label }: Props): React.JSX.Element {
  const [dragging, setDragging] = useState(false)
  const from = useRef<DragFrom | null>(null)

  /** Both columns keep at least `MIN_PANE_PX` — unless the pair is too narrow to
   *  give them one each, where that clamp would invert and pin the seam solid.
   *  There the floor drops to half the pair, so the divider still moves and the
   *  worst case is a symmetric split rather than a dead control. */
  const clamp = (want: number, span: number): number => {
    const min = Math.min(MIN_PANE_PX, span / 2)
    return Math.max(min, Math.min(span - min, want))
  }

  const neighbours = (el: HTMLElement): [HTMLElement, HTMLElement] | null => {
    const prev = el.previousElementSibling as HTMLElement | null
    const next = el.nextElementSibling as HTMLElement | null
    return prev && next ? [prev, next] : null
  }

  const begin = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return
    const pair = neighbours(e.currentTarget)
    if (!pair) return
    const [prev, next] = pair
    const grow =
      parseFloat(getComputedStyle(prev).flexGrow) + parseFloat(getComputedStyle(next).flexGrow)
    if (!Number.isFinite(grow) || grow <= 0) return
    from.current = {
      id: e.pointerId,
      x: e.clientX,
      left: prev.getBoundingClientRect().width,
      right: next.getBoundingClientRect().width,
      grow,
      last: null
    }
    e.currentTarget.setPointerCapture(e.pointerId)
    setDragging(true)
    // Without this the drag selects text in whichever editor it passes over.
    e.preventDefault()
  }

  const move = (e: React.PointerEvent<HTMLDivElement>): void => {
    const d = from.current
    if (!d || d.id !== e.pointerId) return
    const pair = neighbours(e.currentTarget)
    if (!pair) return
    const span = d.left + d.right
    const left = clamp(d.left + (e.clientX - d.x), span)
    const right = span - left
    d.last = { left, right }
    // Redistribute the pair's own share; every other column is untouched, which
    // is what keeps a three-way split predictable to drag.
    pair[0].style.flexGrow = String((left / span) * d.grow)
    pair[1].style.flexGrow = String((right / span) * d.grow)
  }

  const end = (e: React.PointerEvent<HTMLDivElement>): void => {
    const d = from.current
    if (!d || d.id !== e.pointerId) return
    from.current = null
    setDragging(false)
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
    // A click that never moved leaves the layout alone — committing here would
    // write an explicit even `sizes` array over a layout that legitimately had
    // none, and "never dragged" is worth keeping distinguishable from "dragged
    // back to even" (see `equalisePanes`).
    if (d.last) onResize(at, d.last.left, d.last.right)
  }

  const nudge = (e: React.KeyboardEvent<HTMLDivElement>, dx: number): void => {
    const pair = neighbours(e.currentTarget)
    if (!pair) return
    const left = pair[0].getBoundingClientRect().width
    const span = left + pair[1].getBoundingClientRect().width
    const want = clamp(left + dx, span)
    onResize(at, want, span - want)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'ArrowLeft') nudge(e, -NUDGE_PX)
    else if (e.key === 'ArrowRight') nudge(e, NUDGE_PX)
    else if (e.key === 'Enter' || e.key === ' ') onReset()
    else return
    e.preventDefault()
  }

  // The cursor and the text-selection block have to cover the WHOLE window, not
  // just this element: pointer capture keeps the events coming here, but the
  // pointer itself is out over an editor, and that is where the I-beam and the
  // selection would otherwise appear mid-drag. This class is also what turns the
  // columns' glide off for the duration — see app.css.
  useEffect(() => {
    if (!dragging) return
    document.body.classList.add('pane-resizing')
    return () => document.body.classList.remove('pane-resizing')
  }, [dragging])

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      tabIndex={0}
      className={'pane-divider' + (dragging ? ' dragging' : '')}
      onPointerDown={begin}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      onDoubleClick={onReset}
      onKeyDown={onKeyDown}
    >
      <span className="pane-divider-line" />
    </div>
  )
}
