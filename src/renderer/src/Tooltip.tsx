import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

// The app's own tooltips. Mounted once, from App; every control opts in with a
// `data-tip` attribute instead of the HTML `title` one.
//
// Three reasons `title` had to go, all of them reported as bugs:
//
//  1. **It goes stale.** The OS renders the tooltip once and keeps showing that
//     text until the pointer leaves — so toggling a control while hovering it
//     (the search bar's "titles only / titles and contents", the archive filter)
//     left the old sentence on screen describing the state you just left.
//  2. **It doesn't always appear.** Several controls carried a `title` that
//     never showed at all in the packaged window.
//  3. **It is a box.** A native tooltip is an opaque panel the app can't style,
//     and it reads as heavier than the thing it describes.
//
// So: plain text, directly under whatever you're pointing at, re-read from the
// DOM every time — including after a click, which is what fixes (1).

/** ms of hovering before the text appears. Long enough not to flicker as the
 *  pointer crosses a row of buttons, short enough to feel like an answer. */
const DELAY = 380
const GAP = 6
const EDGE = 8

interface Tip {
  text: string
  left: number
  right: number
  top: number
  bottom: number
  /** true when the anchor is in the right-hand third — the text is then aligned
   *  to its right edge, so a long tip doesn't shoot off the window */
  fromRight: boolean
}

export function Tooltip(): React.JSX.Element | null {
  const [tip, setTip] = useState<Tip | null>(null)
  const box = useRef<HTMLDivElement | null>(null)
  /** Where the text actually goes, worked out AFTER it has been laid out — and
   *  stamped with the tip it belongs to, so a stale position from the previous
   *  one is never painted for a moment. */
  const [at, setAt] = useState<{ x: number; y: number; of: Tip } | null>(null)

  // The position has to be measured, not assumed. It used to be assumed: the
  // vertical clamp was `min(bottom + GAP, innerHeight - 28)`, i.e. "a tooltip is
  // 28px tall". A one-line tip is; a wrapped one is not, and the eye's
  // "Showing the code behind each photo and video — click to hide it" wraps to
  // three lines in the BOTTOM-RIGHT corner of the window, which is the worst
  // case for both axes at once. The clamp pinned its top just inside the window
  // and let the rest fall off the bottom.
  useLayoutEffect(() => {
    const el = box.current
    if (!tip || !el) return
    const r = el.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    // Horizontal: align to whichever edge of the anchor keeps it in view, then
    // clamp. `Math.max(EDGE, …)` on the upper bound as well, so a window
    // narrower than the tooltip still starts it on screen rather than off the
    // left.
    let x = tip.fromRight ? tip.right - r.width : tip.left
    x = Math.min(Math.max(EDGE, x), Math.max(EDGE, vw - r.width - EDGE))
    // Vertical: under the control if it fits, above it if not — flipping beats
    // clamping, which would slide the text over the very thing it describes.
    let y = tip.bottom + GAP
    if (y + r.height > vh - EDGE) y = tip.top - GAP - r.height
    y = Math.min(Math.max(EDGE, y), Math.max(EDGE, vh - r.height - EDGE))
    setAt({ x, y, of: tip })
  }, [tip])

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    let anchor: HTMLElement | null = null

    const cancel = (): void => {
      if (timer) clearTimeout(timer)
      timer = null
      anchor = null
      setTip(null)
    }

    /** Read the CURRENT text off the element — never a value captured earlier,
     *  which is exactly how the native one went stale. */
    const read = (el: HTMLElement): Tip | null => {
      const text = el.dataset.tip
      if (!text) return null
      const r = el.getBoundingClientRect()
      return {
        text,
        left: r.left,
        right: r.right,
        top: r.top,
        bottom: r.bottom,
        fromRight: r.left > window.innerWidth * 0.62
      }
    }

    const over = (e: Event): void => {
      const el = (e.target as HTMLElement | null)?.closest?.('[data-tip]') as HTMLElement | null
      if (el === anchor) return
      if (timer) clearTimeout(timer)
      anchor = el
      setTip(null)
      if (!el) return
      timer = setTimeout(() => setTip(read(el)), DELAY)
    }

    // Clicking a control usually changes what it does next — re-read rather than
    // leaving the sentence that described the old state.
    const click = (): void => {
      if (!anchor) return
      requestAnimationFrame(() => {
        if (anchor) setTip(read(anchor))
      })
    }

    document.addEventListener('pointerover', over, true)
    document.addEventListener('pointerdown', click, true)
    document.addEventListener('click', click, true)
    // Anything that moves the page moves the anchor, so the text would be
    // pointing at nothing.
    window.addEventListener('scroll', cancel, true)
    window.addEventListener('blur', cancel)
    document.addEventListener('keydown', cancel, true)
    return () => {
      if (timer) clearTimeout(timer)
      document.removeEventListener('pointerover', over, true)
      document.removeEventListener('pointerdown', click, true)
      document.removeEventListener('click', click, true)
      window.removeEventListener('scroll', cancel, true)
      window.removeEventListener('blur', cancel)
      document.removeEventListener('keydown', cancel, true)
    }
  }, [])

  if (!tip) return null
  const placed = at?.of === tip
  return createPortal(
    <div
      ref={box}
      style={{
        position: 'fixed',
        // Laid out at the origin for one frame so it can be measured, and kept
        // invisible until it has been — `visibility`, not `display`, because
        // `display: none` has no box to measure in the first place.
        top: placed ? at.y : 0,
        left: placed ? at.x : 0,
        visibility: placed ? 'visible' : 'hidden',
        // Never wider than the window, whatever the 16rem cap says.
        maxWidth: 'min(16rem, calc(100vw - 16px))'
      }}
      // Text, not a panel: no border, no background, no shadow. The drop-shadow
      // is the only concession — it is what keeps a light tip legible where it
      // happens to fall over the note's own text.
      className="pointer-events-none z-[90] text-[11.5px] font-medium leading-snug text-ink-600 [text-shadow:0_1px_0_rgb(var(--paper)),0_0_6px_rgb(var(--paper))]"
      role="tooltip"
    >
      {tip.text}
    </div>,
    document.body
  )
}
