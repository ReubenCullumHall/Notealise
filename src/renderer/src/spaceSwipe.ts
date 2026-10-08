// The sideways trackpad swipe that changes space — no Shift needed (Reuben's first ask,
// 2026-10-08). This file is only the DECISION: it is fed every wheel event and says "one
// space on" (1), "one space back" (-1) or nothing. App.tsx owns what happens next.
//
// Why a swipe is harder to read than Shift+scroll. Shift says "this is the gesture"; a bare
// swipe has to be told apart from everything else two fingers do. The three ways it goes
// wrong, and what stops each:
//
//  - Ordinary up/down scrolling always drifts sideways a little. Sideways must beat up/down
//    by RATIO over the whole gesture, and a gesture that was ever up/down stays that way
//    until the fingers have stopped — including one that began sideways and then turned
//    vertical before it fired.
//  - One flick is dozens of events, and the trackpad keeps sending them for most of a second
//    after the fingers lift (momentum). Moving once per event, or once per THRESHOLD of
//    that tail, would fly through every space. So one gesture moves one space: after it
//    fires, the rest of its tail is swallowed until the events pause, or until the fingers
//    clearly come back the other way.
//  - Slow drift never adds up: a pause of IDLE_MS starts a fresh count.
//  - The next swipe the SAME way follows straight on from the last one's tail, and quick
//    swiping is exactly that. Lifting the fingers hands over to momentum; touching down again
//    cancels it and starts the next swipe with no pause — Reuben's own recording of fast
//    swiping (409 events over 9s) has no pause of even 180ms in it. Treating everything after
//    a move as its tail (the first version) swallowed all but the first swipe of a run, and
//    waiting for the movement to stop (the second) did too: between two pushes it never stops,
//    it only dips for an event or two. What marks the join is the SHAPE: a tail only ever dies
//    away, while a new push is the movement falling to a fraction of its fastest and then
//    picking up again. Each time that happens, it is the next swipe.
//
// A swipe over something that really scrolls sideways (tabs, wide tables) is not this
// gesture; `scrollsSideways` is how the caller finds out.

export interface SwipeFeel {
  /** net sideways distance, in px, that counts as a swipe */
  threshold: number
  /** a pause this long (ms) between events means a new gesture */
  idleMs: number
  /** how much movement (px) it takes to decide sideways vs up/down */
  lockPx: number
  /** sideways must be at least this many times the up/down movement */
  ratio: number
  /** after a swipe, movement back the other way (px) that counts as a NEW swipe */
  backPx: number
  /** after a swipe, the movement falling to this fraction of its fastest is a dip... */
  valleyFrac: number
  /** ...and picking up to at least this many px per event... */
  pickUpPx: number
  /** ...and this many times the bottom of the dip, is the next swipe */
  pickUpMult: number
}

/** Chosen against synthetic flicks and two recordings of Reuben's real swipes — slow
 *  strokes, and then fast chained ones (peaks of 30-130 px per event) — NOT yet tuned live.
 *  Over the chained recording the same 13 swipes are found for every `valleyFrac` from
 *  0.15 to 0.3, `pickUpPx` from 4 to 9 and `pickUpMult` from 2 to 4; 0.4 starts to split a
 *  single push in two, so the setting sits in the middle of the range that works. */
export const SWIPE_FEEL: SwipeFeel = {
  threshold: 60,
  idleMs: 180,
  lockPx: 24,
  ratio: 2.2,
  backPx: 40,
  valleyFrac: 0.25,
  pickUpPx: 6,
  pickUpMult: 3
}

export type SwipeStep = 1 | -1 | null

/** Feed it `deltaX`, `deltaY` and the event's `timeStamp`, in order. Positive deltaX is the
 *  page moving right under the fingers — fingers going LEFT — and that is the NEXT space
 *  (the way a later desktop slides in, and the same direction as the Shift+scroll gesture).
 *  `exempt` says the pointer is over something that scrolls sideways: that is not this gesture,
 *  and neither is the rest of the movement it belongs to — the box moves under the pointer as
 *  it scrolls, so the events that follow are not all over it. */
export function createSwipeDetector(
  feel: SwipeFeel = SWIPE_FEEL
): (dx: number, dy: number, t: number, exempt?: boolean) => SwipeStep {
  let last = -Infinity
  let net = 0 // sideways, signed
  let side = 0 // sideways, total
  let up = 0 // up/down, total
  let axis: 'none' | 'x' | 'y' = 'none'
  let fired: 0 | 1 | -1 = 0 // direction of the swipe that already fired this gesture, or 0
  let back = 0 // movement the other way since it fired
  let peak = 0 // the fastest event since it fired
  let valley = Infinity // the slowest since that peak
  let exemptUntil = -Infinity // while it scrolls something sideways, nothing counts

  const fresh = (): void => {
    net = side = up = back = 0
    peak = 0
    valley = Infinity
    axis = 'none'
    fired = 0
  }

  return (dx, dy, t, exempt = false) => {
    if (exempt || t <= exemptUntil) {
      exemptUntil = t + feel.idleMs
      last = t // so the count starts again from nothing once it has stopped
      return null
    }
    if (t - last > feel.idleMs) fresh()
    last = t

    let counted = false
    if (fired) {
      const sign = Math.sign(dx)
      if (sign !== -fired) {
        // Same way as the swipe that moved a space (or no sideways movement at all).
        if (sign === fired) back = 0
        const speed = Math.abs(dx)
        // Still its tail — unless it had fallen away to almost nothing and has now picked up
        // again: that is the next swipe, straight on. (Judged on the dip as it was BEFORE this
        // event, so a push that goes straight past the last one's fastest still counts.)
        if (valley <= feel.valleyFrac * peak && speed >= Math.max(feel.pickUpPx, feel.pickUpMult * valley)) fresh()
        else {
          if (speed > peak) {
            peak = speed
            valley = Infinity
          } else valley = Math.min(valley, speed)
          return null
        }
      } else {
        back += Math.abs(dx)
        if (back < feel.backPx) return null
        // The fingers came back the other way: a new swipe, and the movement that showed
        // it counts towards it (a swipe back should not need more than a swipe forward).
        const dir = -fired
        const carried = back
        fresh()
        net = dir * carried
        side = carried
        axis = 'x'
        counted = true
      }
    }
    if (!counted) {
      net += dx
      side += Math.abs(dx)
      up += Math.abs(dy)
    }

    // Decide it is sideways once there is enough movement to tell; up/down is final.
    // (Sideways must beat up/down by `ratio`, so a plain scroll whose fingers wander,
    // or a diagonal, is never a swipe.)
    if (axis === 'none' && side + up >= feel.lockPx) axis = 'x'
    if (axis === 'x' && up * feel.ratio > side) axis = 'y'
    if (axis !== 'x' || Math.abs(net) < feel.threshold) return null

    fired = net > 0 ? 1 : -1
    back = 0
    peak = Math.abs(dx)
    valley = Infinity
    return fired
  }
}

/** True if this element, or anything around it, is a box that scrolls sideways right now.
 *  MEASURED rather than listed (the same reasoning as the Shift+scroll gesture): a list of
 *  selectors goes stale the first time someone adds a scroller, and the failure — a table
 *  that jumps space instead of scrolling — is the kind nobody reports.
 *  Any ELEMENT, not just an HTML one: a tab's little × is an <svg>, and while a tab strip
 *  scrolls under the pointer some of the wheel events land on it — which used to read as "not
 *  over anything that scrolls" and let the strip's own scrolling change the space. */
export function scrollsSideways(start: EventTarget | null): boolean {
  let el: Element | null = start instanceof Element ? start : null
  while (el && el !== document.body) {
    if (el.scrollWidth - el.clientWidth > 1) {
      const ox = getComputedStyle(el).overflowX
      if (ox === 'auto' || ox === 'scroll') return true
    }
    el = el.parentElement
  }
  return false
}
