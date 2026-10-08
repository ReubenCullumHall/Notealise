// The slide between spaces (Reuben, 2026-10-08: "add a smoother animation to make it look like
// a computer switching desktops", and "swipe between them freely, with no lag or delay if
// doing it quickly").
//
// HOW. A View Transition: the browser keeps a picture
// of the space you are leaving, the app switches to the next one behind it, and the two are
// moved together — the old one out one side, the new one in from the other — so the two sit
// edge to edge for the whole move, the way two desktops do. Two pictures, never two live
// copies of the app (two sets of panes would be two CodeMirrors; see `switchSpace`).
//
// Only the two regions that ARE the space slide: the note area and the sidebar's list. The
// search bar, the space switcher and the sidebar's foot are not part of a space and stay put.
// They are named for the browser (`view-transition-name`) ONLY while a slide runs — an html
// class is on before it starts and off after it ends — because a name that is always on
// makes ANY other view transition capture them as separate pieces too (they would cross-fade
// in place instead of going with the rest of the page). Every rule for the pictures sits under
// `html.space-vt` in app.css for the same reason.
//
// QUICK SWIPING. A new `startViewTransition` ends the one still running — its picture jumps to
// where it was heading — so starting one per swipe would show a half-finished slide snapping
// shut each time the next swipe arrived. Instead, a swipe the SAME way while a slide is running
// only changes what the incoming side shows: the incoming picture is live, not a still, so it
// simply becomes the newer space and the slide carries on. Reversing, or starting after one has
// finished, starts a fresh slide.
//
// The shape of the whole thing is a few lines of CSS, so what moves and how it moves can be
// changed without touching this file.

type ViewTransition = {
  ready: Promise<void>
  finished: Promise<void>
  updateCallbackDone: Promise<void>
}

/** What the slide needs from the page — the real `document`, or a stand-in for the tests. */
export interface SlideEnv {
  startViewTransition?: (update: () => void) => ViewTransition
  root: { classList: { add(...names: string[]): void; remove(...names: string[]): void } }
}

const realEnv = (): SlideEnv => ({
  startViewTransition: (document as Document & { startViewTransition?: SlideEnv['startViewTransition'] })
    .startViewTransition?.bind(document),
  root: document.documentElement
})

/** Can this page run it? (Every build of the app can; the check is for the browser preview.) */
export function spaceSlideAvailable(env: () => SlideEnv = realEnv): boolean {
  return typeof env().startViewTransition === 'function'
}

/**
 * Make `slide`: run `update` — the switch to the next space — under the slide, `dir` being 1
 * for a space further along the row (the new one comes in from the right) and -1 for one
 * before it. `update` must leave the page showing the new space when it returns, because
 * that is the moment the browser takes its second picture (App flushes React inside it).
 *
 * Resolves once `update` has run — not when the motion ends — so the next switch can follow
 * at once. Rejects only if `update` throws; the motion itself can never stop a switch.
 */
export function createSpaceSlide(env: () => SlideEnv = realEnv): (dir: 1 | -1, update: () => void) => Promise<void> {
  let current: { dir: 1 | -1; running: boolean } | null = null

  return (dir, update) => {
    const e = env()
    if (!e.startViewTransition) {
      update()
      return Promise.resolve()
    }
    // A slide this way is already on its way: the incoming picture is live, so just let it
    // show the newer space.
    if (current && current.running && current.dir === dir) {
      update()
      return Promise.resolve()
    }
    const me = { dir, running: false }
    current = me
    e.root.classList.remove('space-vt-next', 'space-vt-prev')
    e.root.classList.add('space-vt', dir > 0 ? 'space-vt-next' : 'space-vt-prev')
    const vt = e.startViewTransition(update)
    // Not "running" until the pictures exist; before that the old one is still being taken.
    void vt.ready.then(
      () => {
        me.running = true
      },
      () => undefined
    )
    // Whoever is newest cleans up. A slide that was ended by the next one finishes too, and
    // must not take the newer slide's names off the page.
    const clear = (): void => {
      if (current !== me) return
      current = null
      e.root.classList.remove('space-vt', 'space-vt-next', 'space-vt-prev')
    }
    void vt.finished.then(clear, clear)
    return vt.updateCallbackDone
  }
}

/** The page's own slide. */
export const slideSpaces = createSpaceSlide()

/** How far the edge nudge goes, and how long it takes. */
const NUDGE_PX = 12
const NUDGE_MS = 320
let lastNudge = -Infinity

/**
 * A swipe towards the end of the row, where there is nowhere further to go: the two regions give
 * a little with the swipe and settle back — the way macOS's desktops do at the last one — so a
 * swipe that did nothing still answers. Moves what is INSIDE each region, not the region, so
 * nothing ever slides over the sidebar or the controls beside it.
 */
export function nudgeSpaces(dir: 1 | -1, motion: boolean, now: number = performance.now()): void {
  if (!motion || now - lastNudge < NUDGE_MS * 0.8) return
  lastNudge = now
  const shift = -dir * NUDGE_PX
  document.querySelectorAll<HTMLElement>('.space-vt-main, .space-vt-side').forEach((region) => {
    for (const child of Array.from(region.children)) {
      // Each keyframe's easing is for the stretch AFTER it: out to the furthest point quickly and
      // decelerating, then back to rest a little more gently. (An easing on the whole animation
      // would move the furthest point to somewhere other than the 40% mark.)
      ;(child as HTMLElement).animate(
        [
          { transform: 'translateX(0)', offset: 0, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
          { transform: `translateX(${shift}px)`, offset: 0.4, easing: 'cubic-bezier(0.3, 0, 0.2, 1)' },
          { transform: 'translateX(0)', offset: 1 }
        ],
        { duration: NUDGE_MS }
      )
    }
  })
}
