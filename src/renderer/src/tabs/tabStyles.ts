// The tab strip's skins, in one place because THREE things wear them now: a
// lone tab, a segment of a grouped tab (`TabStrip.tsx`), and the island and its
// chips (`Island.tsx`). They were constants inside TabStrip until the island
// was built; a second copy of the same class strings is exactly the drift rule 8
// warns about, and the island sits in the same row as the tabs, where any drift
// is immediately visible side by side.

// Active/inactive follow the sidebar's space switcher rather than inventing a
// second "selected" idiom: accent border + wash for the one you're on, a plain
// hairline for the rest. `btn-edge` opts the inactive ones into the
// button-definition setting; the active tab keeps its accent border, which is
// how you can see which one you're in (CLAUDE.md, Tailwind-vs-app.css note).
export const TAB_BASE =
  'press-row group relative flex shrink-0 cursor-pointer select-none items-center gap-1 rounded-lg border py-1 pl-3 pr-1 text-[13px] outline-none transition duration-200 focus-visible:ring-2 focus-visible:ring-brand-300 '
export const TAB_ON = 'border-brand-400/60 bg-brand-500/15 text-brand-600 '
export const TAB_OFF =
  'btn-edge border-ink-300/25 bg-transparent text-ink-500 hover:bg-ink-300/15 hover:text-ink-900 '

// A SEGMENT of a grouped tab. The group draws the one border round the lot, so
// a segment has none of its own — what separates two of them is the divider
// below, and what marks the focused one is the accent wash it shares with a
// lone active tab. TAB_SHOWN (a second, quieter "this is on screen" border)
// used to say what the grouping now says outright, and went with this change.
export const SEG_BASE =
  'press-row group/seg relative flex shrink-0 cursor-pointer select-none items-center gap-1 rounded-md py-0.5 pl-2.5 pr-1 text-[13px] outline-none transition duration-200 focus-visible:ring-2 focus-visible:ring-brand-300 '
export const SEG_ON = 'bg-brand-500/15 text-brand-600 '
export const SEG_OFF = 'text-ink-600 hover:bg-ink-300/15 hover:text-ink-900 '

// The island's open/close bounce, shared with the + button's new tab so both
// move on one curve. See TabIsland.tsx for why an overshoot is allowed here.
export const BOUNCE_MS = 460
export const BOUNCE = 'cubic-bezier(0.34, 1.45, 0.64, 1)'
/** The same curve with far less overshoot — a 1.5% settle instead of 6.6%.
 *  Reuben, 2026-09-24: the split's divider was "moving so much" (cut by about
 *  70%: 10px of swing measured down to 3), and a closing tab should be softer.
 *  `SOFT_Y1` is the control point that makes it, for `bounceAt`. */
export const SOFT_Y1 = 1.217
export const BOUNCE_SOFT = `cubic-bezier(0.34, ${SOFT_Y1}, 0.64, 1)`
export const motionOn = (): boolean =>
  document.documentElement.dataset.motion !== 'off' &&
  !window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** Where the BOUNCE curve is at `x` (0–1 of the way through the time), so a
 *  motion that can't be handed to the browser as one eased keyframe pair can
 *  still be built from samples of the same curve. Used for a closing tab: its
 *  width stops at zero, but the strip closing up behind it has to carry the
 *  overshoot on its own. */
export const bounceAt = (x: number, y1 = 1.45): number => {
  const [x1, x2, y2] = [0.34, 0.64, 1]
  const bez = (t: number, a: number, b: number): number =>
    3 * a * t * (1 - t) ** 2 + 3 * b * t ** 2 * (1 - t) + t ** 3
  let lo = 0
  let hi = 1
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2
    if (bez(mid, x1, x2) < x) lo = mid
    else hi = mid
  }
  return bez((lo + hi) / 2, y1, y2)
}
