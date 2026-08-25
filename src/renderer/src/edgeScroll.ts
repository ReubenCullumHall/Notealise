// Scrolling a container by holding a drag near its top or bottom edge.
//
// Why it has to exist: with a mouse you can spin the wheel mid-drag, so a long
// note or a long sidebar is reachable while carrying something. With a
// trackpad you cannot — the same two fingers that would scroll are the ones
// holding the drag down. Without this, moving a photo further than one screen
// is simply not possible on a laptop.
//
// The zone is a SIXTH of the container at each end, measured off the
// container's own box rather than the window: the thing being scrolled is what
// the pointer is aiming at, and in a split view a pane is not the page.
//
// Speed ramps with depth instead of being constant. A fixed rate has to choose
// between "too slow to cross a long note" and "shoots past the line you wanted"
// — a ramp is slow and precise at the boundary, fast at the very edge, and the
// pointer chooses continuously between the two.

/** Fraction of the container at each end that scrolls. */
const ZONE = 1 / 6
/** Pixels per frame at the very edge — about 900/sec at 60fps. */
const MAX_SPEED = 15

export interface EdgeScroller {
  /** Call on every pointer move with the pointer's viewport Y. */
  track(clientY: number): void
  /** Call when the drag ends, from every path that can end it. */
  stop(): void
}

/**
 * @param el      the scrolling container
 * @param onStep  called after each scroll step, so a drag marker positioned
 *                against the document can be put back under the pointer — the
 *                pointer is not moving, so nothing else would update it.
 */
export function createEdgeScroller(el: HTMLElement, onStep?: () => void): EdgeScroller {
  let frame = 0
  let speed = 0

  const step = (): void => {
    const before = el.scrollTop
    el.scrollTop = before + speed
    // Stop at the ends rather than burning a frame on every tick forever.
    if (el.scrollTop === before) {
      frame = 0
      return
    }
    onStep?.()
    frame = requestAnimationFrame(step)
  }

  return {
    track(clientY) {
      const r = el.getBoundingClientRect()
      const zone = Math.max(1, r.height * ZONE)
      // Above the top edge counts as fully into the top zone, and below the
      // bottom edge as fully into the bottom one: dragging out of the window is
      // a clear "keep going", not a reason to stop.
      const intoTop = (r.top + zone - clientY) / zone
      const intoBottom = (clientY - (r.bottom - zone)) / zone
      const depth = intoTop > 0 ? -Math.min(1, intoTop) : intoBottom > 0 ? Math.min(1, intoBottom) : 0
      speed = depth * MAX_SPEED
      if (speed === 0) {
        if (frame) cancelAnimationFrame(frame)
        frame = 0
      } else if (!frame) {
        frame = requestAnimationFrame(step)
      }
    },
    stop() {
      if (frame) cancelAnimationFrame(frame)
      frame = 0
      speed = 0
    }
  }
}
