// The archive button's press (Reuben, 2026-10-08, after trying a genie that
// poured the archive out of the button: "just forget that animation and make
// it a button that is clicked and has some bounce to it").
//
// So the window just switches, and the motion is the button's own: it sinks
// and tips toward where you pressed — the same press as onboarding's cards and
// Continue (`.press-3d`, onboarding/press3d.ts), deeper because the button is
// small — and on release it springs back up, hits its stop and bounces off it
// twice before it settles.
//
// It never comes up PAST where it rests (CLAUDE.md's open/close limits: a
// button never swells past its own size, nothing overlaps a neighbour — the
// bin is its neighbour, one border away). The bounce is off the resting
// position, the way a key bounces off its top stop, so every frame is the
// resting button or a pressed-in one.
//
// All of it is script, not a CSS transition: a running transition outranks an
// animation on the same property, so the release could not take over from a
// pressed pose that `:active` was still transitioning to. And nothing is left
// on the button afterwards — Windows draws a resting transformed control's
// text without ClearType (CLAUDE.md), so it rests at `transform: none`.

import { motionOn } from '../tabs/tabStyles'

export interface Tilt {
  /** degrees, + tips the top edge away */
  x: number
  /** degrees, + tips the right edge away */
  y: number
}

export const NO_TILT: Tilt = { x: 0, y: 0 }

/** How far in it goes. */
export const PRESS = {
  sink: 2, // px down
  scale: 0.92,
  maxDeg: 8, // the most it tips, pressed right at an edge
  perspective: 400, // px; nearer than `.press-3d`'s 700 so a small button still shows it
  downMs: 90,
  bounceMs: 450
}

const easeOutQuad = 'cubic-bezier(0.25, 0.46, 0.45, 0.94)'
const easeInSine = 'cubic-bezier(0.12, 0, 0.39, 0)'
const easeOutSine = 'cubic-bezier(0.61, 1, 0.88, 1)'

const r = (v: number): number => Math.round(v * 1000) / 1000 || 0 // never -0

/** The button `a` of the way in (0 = resting, 1 = all the way). The same list
 *  of steps at every amount, so the browser can blend between any two. */
export function pose(a: number, tilt: Tilt): string {
  return (
    `perspective(${PRESS.perspective}px) rotateX(${r(tilt.x * a)}deg) rotateY(${r(tilt.y * a)}deg) ` +
    `translate3d(0, ${r(PRESS.sink * a)}px, 0) scale(${r(1 - (1 - PRESS.scale) * a)})`
  )
}

/** Where on the button the pointer went down, as the way it tips: pressing
 *  near an edge pushes that edge in (as `tiltFromPointer` does for `.press-3d`). */
export function tiltAt(box: { left: number; top: number; width: number; height: number }, x: number, y: number): Tilt {
  const fx = Math.max(-0.5, Math.min(0.5, (x - box.left) / box.width - 0.5))
  const fy = Math.max(-0.5, Math.min(0.5, (y - box.top) / box.height - 0.5))
  return { x: r(-fy * 2 * PRESS.maxDeg), y: r(fx * 2 * PRESS.maxDeg) }
}

/** Going in. */
export function pressFrames(tilt: Tilt): Keyframe[] {
  return [{ transform: pose(0, tilt) }, { transform: pose(1, tilt) }]
}

/** Coming back out: up to its stop, then two bounces off it, each smaller. Each
 *  leg speeds up into the stop and slows at the top of a bounce, like a ball. */
export function bounceFrames(tilt: Tilt): Keyframe[] {
  const legs: Array<[offset: number, amount: number]> = [
    [0, 1],
    [0.3, 0],
    [0.51, 0.4],
    [0.72, 0],
    [0.86, 0.12],
    [1, 0]
  ]
  return legs.map(([offset, a], i) => ({
    offset,
    transform: pose(a, tilt),
    // into the stop: speeding up; out of it: slowing down
    ...(i < legs.length - 1 ? { easing: a > legs[i + 1][1] ? easeInSine : easeOutSine } : {})
  }))
}

/** The voice note's play button presses differently (Reuben, 2026-10-27:
 *  "don't make it bounce so much, the actual button seems to move up and down
 *  not go in and out"). On a 32px round button the sink and the tip above read
 *  as a hop, so this one only shrinks toward its centre and grows back — no
 *  sink, no tip — with one small bounce instead of two. Still never bigger than
 *  it rests. */
export const SQUEEZE = {
  scale: 0.9,
  bounceMs: 320
}

/** The squeeze `a` of the way in (0 = resting, 1 = all the way). */
export function squeezePose(a: number): string {
  return `scale(${r(1 - (1 - SQUEEZE.scale) * a)})`
}

/** Going in. */
export function squeezeFrames(): Keyframe[] {
  return [{ transform: squeezePose(0) }, { transform: squeezePose(1) }]
}

/** Coming back out: to its full size, one small dip, and rest. */
export function squeezeBounceFrames(): Keyframe[] {
  const legs: Array<[offset: number, amount: number]> = [
    [0, 1],
    [0.45, 0],
    [0.72, 0.25],
    [1, 0]
  ]
  return legs.map(([offset, a], i) => ({
    offset,
    transform: squeezePose(a),
    ...(i < legs.length - 1 ? { easing: a > legs[i + 1][1] ? easeInSine : easeOutSine } : {})
  }))
}

/**
 * One button's press. `down` on pointerdown, `up` on pointerup / leave /
 * cancel, `key` for a press that came from the keyboard (no pointer, so it
 * sinks straight and bounces at once). `'squeeze'` is the voice note's
 * in-and-out press (SQUEEZE above); the default is the archive button's.
 */
export function createPress(kind: 'press' | 'squeeze' = 'press'): {
  down: (el: HTMLElement, x: number, y: number) => void
  up: (el: HTMLElement) => void
  key: (el: HTMLElement) => void
} {
  let pressing: Animation | null = null
  let bouncing: Animation | null = null
  let tilt: Tilt = NO_TILT

  const stop = (): void => {
    pressing?.cancel()
    bouncing?.cancel()
    pressing = bouncing = null
  }

  const bounce = (el: HTMLElement): void => {
    stop()
    bouncing =
      kind === 'squeeze'
        ? el.animate(squeezeBounceFrames(), { duration: SQUEEZE.bounceMs, easing: 'linear' })
        : el.animate(bounceFrames(tilt), { duration: PRESS.bounceMs, easing: 'linear' })
    const mine = bouncing
    void mine.finished.then(
      () => {
        if (bouncing === mine) bouncing = null
      },
      () => undefined // cancelled by the next press
    )
  }

  return {
    down(el, x, y) {
      if (!motionOn()) return
      stop()
      tilt = tiltAt(el.getBoundingClientRect(), x, y)
      // Held at the bottom until the pointer comes up.
      pressing = el.animate(kind === 'squeeze' ? squeezeFrames() : pressFrames(tilt), {
        duration: PRESS.downMs,
        easing: easeOutQuad,
        fill: 'forwards'
      })
    },
    up(el) {
      const held = pressing
      if (!held) return
      // A quick tap would otherwise come back up before it had gone down:
      // let it reach the bottom, then bounce.
      if (held.playState === 'running') {
        void held.finished.then(
          () => {
            if (pressing === held) bounce(el)
          },
          () => undefined
        )
      } else bounce(el)
    },
    key(el) {
      if (!motionOn()) return
      stop()
      tilt = NO_TILT
      pressing = el.animate(kind === 'squeeze' ? squeezeFrames() : pressFrames(tilt), {
        duration: PRESS.downMs,
        easing: easeOutQuad,
        fill: 'forwards'
      })
      const held = pressing
      void held.finished.then(
        () => {
          if (pressing === held) bounce(el)
        },
        () => undefined
      )
    }
  }
}
