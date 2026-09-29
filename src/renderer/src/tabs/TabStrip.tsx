import { useLayoutEffect, useRef, useState } from 'react'
import { Icon } from '../icons'
import { BLANK, MAX_PANES, stripGroups, type Split } from './model'
import {
  BOUNCE,
  BOUNCE_MS,
  BOUNCE_SOFT,
  bounceAt,
  motionOn,
  SOFT_Y1,
  SEG_BASE,
  SEG_OFF,
  SEG_ON,
  TAB_BASE,
  TAB_OFF,
  TAB_ON
} from './tabStyles'
import type { Drag } from './NotePane'
import { takeStripChanges } from './stripMotion'
import { DRAG_FROM_STRIP } from './island'

interface Props {
  /** open notes in strip order (vault-relative paths) */
  tabs: string[]
  /** the note each pane is showing, left to right. Two or more of these and the
   *  strip draws them as ONE grouped tab — see `stripGroups`. */
  panes: string[]
  /** splits you have stepped out of — each drawn as one joined tab that takes
   *  you back to it (`stripGroups`, the model's `parked`) */
  parked?: Split[]
  /** the focused pane's note */
  active: string | null
  onSelect: (path: string) => void
  onClose: (path: string) => void
  /** strip reorder: put `path` before `before` (null = last) */
  onReorder: (path: string, before: string | null) => void
  /** split two open notes: `target` (the tab dropped ONTO) takes the left
   *  column, `dragged` arrives on its right */
  onSplitWith: (target: string, dragged: string) => void
  /** move a whole group — `members`, on screen or parked — to sit before
   *  `before` (null = last) */
  onMoveGroup: (before: string | null, members: string[]) => void
  /** take one note out of the split — its column closes, the tab stays open */
  onTakeOutOfSplit: (path: string) => void
  /** end the split `path` is in: on screen, one column with everything else
   *  still open behind it; parked, its notes just become ordinary tabs */
  onUngroup: (path: string) => void
  /** a tab drag started/ended — the panes show their drop zones while it runs */
  onDragTab: (path: string | null) => void
  /** open an empty tab ("+"), which asks you to pick a note */
  onNewTab: () => void
  /** the space's tab island (`Island.tsx`), already built by App and dropped in
   *  at the left of the strip. Passed as an element rather than as eight more
   *  props threaded through here: the strip is where it SITS, not something that
   *  has any opinion about what is in it. */
  island?: React.ReactNode
  dragging: Drag | null
  /** fade this out of the way (Settings → While scrolling → "Keep the tab
   *  strip on screen", off). Its layout space stays reserved — nothing below
   *  it reflows — same as the links block and the note's own heading row. */
  hidden: boolean
}

const nameOf = (p: string): string => p.slice(p.lastIndexOf('/') + 1)

/** On hover, the end of a name fades out under the x laid over it. A mask on
 *  the text rather than a painted patch behind the x: a patch would have to
 *  match whatever is under it — theme, accent tint, the hover wash — and a fade
 *  of the text itself is right on all of them. The last 18px (under the 20px x
 *  and its 1px inset, less the pill's own padding) go clear, over a 12px fade. */
const FADE_UNDER_X =
  'group-hover/seg:[mask-image:linear-gradient(to_right,#000_calc(100%_-_30px),transparent_calc(100%_-_18px))] '

/** One offscreen canvas for measuring text, made on first use. */
let measureCanvas: HTMLCanvasElement | undefined
const stripMd = (s: string): string => (s.toLowerCase().endsWith('.md') ? s.slice(0, -3) : s)
const titleOf = (p: string): string => (p === BLANK ? 'Select a note' : stripMd(nameOf(p)))


/** The strip of open notes across the top of the editor area. Click to focus,
 *  × (or middle-click) to close, drag to reorder — or drag onto a pane's edge
 *  to split, which the panes themselves handle.
 *
 *  **Notes sharing the screen share a tab.** Two or three columns render as one
 *  wide pill with a divider between each name, in the order they sit on screen,
 *  so the strip shows the split before you have looked at it (Reuben,
 *  2026-09-06). The pill's grip drags the whole group along the strip; a name
 *  inside it drags out of the split; right-clicking one offers both in words. */
/** A tab's opacity over the thinnest quarter of its width: solid from 25% of
 *  its full width up, fading to nothing below it (Reuben, 2026-09-24). Without
 *  it the last frames of a close — and the first of an open — are the tab's two
 *  borders pressed together, which in dark mode read as one harsh light line.
 *  `widthAt` turns the curve's progress into how much of the full width is
 *  showing; sampled on the same curve as the width, so the two stay in step. */
function edgeFade(widthAt: (p: number) => number, y1?: number): Keyframe[] {
  const STEPS = 24
  const frames: Keyframe[] = []
  for (let i = 0; i <= STEPS; i++) {
    const shown = widthAt(bounceAt(i / STEPS, y1))
    frames.push({ offset: i / STEPS, opacity: Math.max(0, Math.min(1, shown / 0.25)) })
  }
  return frames
}

/** A tab arriving at the end of the strip, coming out of the + (see TabStrip's
 *  opening/closing note). `from` is where the + sat before it arrived. */
function morphFromPlus(
  el: HTMLElement,
  tab: HTMLElement,
  from: { left: number; width: number },
  btn: HTMLElement
): void {
  const box = el.getBoundingClientRect()
  const look = getComputedStyle(btn)
  const own = getComputedStyle(tab)
  const opts = { duration: BOUNCE_MS, easing: BOUNCE }
  // The TAB's own width moves, not a clipping box around it, so both rounded
  // ends stay on screen the whole way. The slide starts it where the + was.
  const kids = Array.from(tab.children) as HTMLElement[]
  tab.style.overflow = 'hidden'
  // Held at full size while the tab is narrower than them, so the title is
  // uncovered rather than squeezed into "Sel…".
  kids.forEach((k) => (k.style.flexShrink = '0'))
  const full = tab.getBoundingClientRect().width
  const width = tab.animate([{ width: `${from.width}px` }, { width: `${full}px` }], opts)
  el.animate([{ transform: `translateX(${from.left - box.left}px)` }, { transform: 'none' }], opts)
  el.animate(edgeFade((p) => (from.width + (full - from.width) * p) / full), { duration: BOUNCE_MS })
  const done = (): void => {
    tab.style.overflow = ''
    kids.forEach((k) => (k.style.flexShrink = ''))
  }
  width.onfinish = done
  width.oncancel = done
  // Whatever sits under the + stays hidden until the + has spun out of the
  // way, so the title never draws through it.
  kids.forEach((k) => {
    const under = from.width - k.offsetLeft
    if (under > 0)
      k.animate([{ clipPath: `inset(0 0 0 ${under}px)` }, { clipPath: 'inset(0 0 0 0)' }], {
        duration: 160,
        easing: 'ease-in'
      })
  })
  // The + pill's grey (and no outline) becoming the tab's own colours.
  tab.animate(
    [
      { backgroundColor: look.backgroundColor, borderColor: 'transparent', color: look.color },
      { backgroundColor: own.backgroundColor, borderColor: own.borderColor, color: own.color }
    ],
    { duration: 240, easing: 'ease-out' }
  )
  // A copy of the + icon, sitting where the real one was, spinning away.
  const icon = btn.querySelector('svg')
  if (icon) {
    const ghost = document.createElement('span')
    ghost.setAttribute('aria-hidden', 'true')
    ghost.style.cssText = `position:absolute;left:0;top:0;width:${from.width}px;height:100%;display:flex;align-items:center;justify-content:center;pointer-events:none;color:${look.color}`
    ghost.appendChild(icon.cloneNode(true))
    tab.appendChild(ghost)
    const spin = ghost.animate([{ transform: 'none' }, { transform: 'rotate(90deg) scale(0)' }], {
      duration: 160,
      easing: 'ease-in',
      fill: 'forwards'
    })
    spin.onfinish = () => ghost.remove()
    spin.oncancel = () => ghost.remove()
  }
  // The real +, already waiting at the end of the strip, grows back in. No
  // overshoot of its own, and done the moment the tab settles: it used to
  // swell to 106% and shrink back while the strip was still settling beside
  // it — two wobbles at once, the "looks a bit off" at the end (Reuben,
  // 2026-09-24). The finished button was never different; its landing was.
  btn.animate([{ transform: 'scale(0)' }, { transform: 'none' }], {
    duration: BOUNCE_MS - 180,
    delay: 180,
    easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
    fill: 'backwards'
  })
}

/** A tab opened somewhere other than the end: it stretches open where it
 *  lands, on the same bounce, with the strip to its right riding it. */
function growInPlace(el: HTMLElement, tab: HTMLElement, gap: number): void {
  const cs = getComputedStyle(tab)
  const w = tab.getBoundingClientRect().width
  const kids = Array.from(tab.children) as HTMLElement[]
  tab.style.overflow = 'hidden'
  kids.forEach((k) => (k.style.flexShrink = '0'))
  const opts = { duration: BOUNCE_MS, easing: BOUNCE }
  const width = tab.animate(
    [
      { width: '0px', paddingLeft: '0px', paddingRight: '0px' },
      { width: `${w}px`, paddingLeft: cs.paddingLeft, paddingRight: cs.paddingRight }
    ],
    opts
  )
  // Its gap arrives with it rather than appearing whole on the first frame.
  el.animate([{ marginRight: `${-gap}px` }, { marginRight: '0px' }], opts)
  el.animate(edgeFade((p) => p), { duration: BOUNCE_MS })
  const done = (): void => {
    tab.style.overflow = ''
    kids.forEach((k) => (k.style.flexShrink = ''))
  }
  width.onfinish = done
  width.oncancel = done
}

/** A closed tab's stand-in shrinking away. Softer than opening (a third of the
 *  overshoot), and the settle is capped short of the gap, so whatever slides in
 *  behind it can never reach the tab, divider or bookmark in front (Reuben,
 *  2026-09-24: the + used to touch the bookmark when the last tab closed). */
function shrinkAway(el: HTMLElement, tab: HTMLElement, gap: number): void {
  const cs = getComputedStyle(tab)
  const w = tab.getBoundingClientRect().width
  const pl = parseFloat(cs.paddingLeft)
  const pr = parseFloat(cs.paddingRight)
  const bw = parseFloat(cs.borderLeftWidth)
  const settle = Math.max(0, gap - 1)
  tab.style.overflow = 'hidden'
  Array.from(tab.children).forEach((k) => ((k as HTMLElement).style.flexShrink = '0'))
  const STEPS = 24
  const shrink: Keyframe[] = []
  const pull: Keyframe[] = []
  for (let i = 0; i <= STEPS; i++) {
    const p = bounceAt(i / STEPS, SOFT_Y1)
    const left = Math.max(0, 1 - p)
    shrink.push({
      offset: i / STEPS,
      // Fades over the last quarter of its width — see `edgeFade`.
      opacity: Math.min(1, left / 0.25),
      width: `${w * left}px`,
      paddingLeft: `${pl * left}px`,
      paddingRight: `${pr * left}px`,
      borderWidth: `${Math.min(bw, (w * left) / 2)}px`
    })
    // The gap it leaves closes with it; past zero the strip keeps going for
    // the settle, capped, then comes back.
    pull.push({
      offset: i / STEPS,
      marginRight: `${-gap * Math.min(p, 1) - Math.min(settle, w * Math.max(0, p - 1))}px`
    })
  }
  tab.animate(shrink, { duration: BOUNCE_MS, fill: 'forwards' })
  const a = el.animate(pull, { duration: BOUNCE_MS, fill: 'forwards' })
  const bye = (): void => el.remove()
  a.onfinish = bye
  a.oncancel = bye
}

/** A piece of a joined tab closing — its x, a middle-click, Cmd/Ctrl+W, the
 *  menu, a note binned — or leaving the split to be a tab of its own (the
 *  column's x, `leaving`), where the same motion plays and its own tab opens
 *  where it now sits. A group is drawn afresh whenever its notes change (its
 *  key names them), and as an ordinary tab once one note is left, so there is
 *  no old element to shrink in place the way `shrinkAway` does for a lone tab.
 *  Instead the closed piece's old element goes back INSIDE the tab that
 *  replaced the group, where it sat, and shrinks away exactly as a closed tab
 *  does — same curve, fade and capped settle — while everything the new tab
 *  kept starts where it was drawn a moment ago and eases to where it now sits.
 *  The new tab is the real one throughout, so the last frame is exactly the tab
 *  that stays (Reuben, 2026-09-26: "the same animation as closing a tab not in
 *  split view"). Going down to one note, the grip shrinks away with it.
 *
 *  `old` is the group's old element, already out of the page; `now` is where
 *  every tab sits after the change. */
function closeInGroup(
  root: HTMLElement,
  old: HTMLElement,
  now: Map<string, { el: HTMLElement; parent: Element }>,
  leaving: Set<string>
): void {
  const keyOf = (w: HTMLElement): string => w.dataset.tabKey as string
  const wraps = Array.from(old.querySelectorAll<HTMLElement>('[data-tab-key]'))
  const kept = wraps.filter((w) => now.has(keyOf(w)) && !leaving.has(keyOf(w)))
  const oldPill = kept[0]?.parentElement
  const grip = oldPill?.querySelector<HTMLElement>(':scope > [data-group-grip]')
  if (!oldPill || !grip) return // the whole group went (a folder binned) — nothing to hold it
  const first = now.get(keyOf(kept[0]))!
  const lone = first.parent === root
  const row = (lone ? first.el.lastElementChild : first.parent) as HTMLElement | null
  let top: HTMLElement = first.el
  while (top.parentElement && top.parentElement !== root) top = top.parentElement
  if (!row) return
  const titleIn = (w: Element): HTMLElement | null => w.querySelector('[data-seg-title]')
  const xIn = (w: Element): HTMLElement | null => w.querySelector('button[aria-label^="Close"]')

  // Where everything was: the old group put back for one read, in place of the
  // new one — and without the tabs of notes that left it, which were not there.
  const was = new Map<Element, DOMRect>()
  const hide = [top, ...[...leaving].map((k) => now.get(k)?.el).filter((e): e is HTMLElement => !!e)]
  const display = hide.map((e) => e.style.display)
  hide.forEach((e) => (e.style.display = 'none'))
  root.insertBefore(old, top)
  const oldX = xIn(kept[0])
  const xWasOver = !oldX || getComputedStyle(oldX).position === 'absolute'
  const look = {
    backgroundColor: getComputedStyle(oldPill).backgroundColor,
    borderColor: getComputedStyle(oldPill).borderColor,
    color: getComputedStyle(kept[0].lastElementChild!).color
  }
  const wash = getComputedStyle(kept[0].lastElementChild!).backgroundColor
  for (const e of [oldPill, grip, ...wraps, ...wraps.map((w) => w.lastElementChild), ...kept.map(titleIn)])
    if (e) was.set(e, e.getBoundingClientRect())
  old.remove()
  hide.forEach((e, i) => (e.style.display = display[i]))

  // What stayed starts as it was drawn and eases to where it is now, on the
  // curve the closing piece is sampled from.
  const soft = { duration: BOUNCE_MS, easing: BOUNCE_SOFT }
  // It has to be drawn where the group was. A note that left the split and
  // opened in front of it is still its two borders wide on the first frame,
  // which the whole tab eases back from; anything further means the group
  // landed somewhere else in the strip, and it just appears there.
  const shift = (was.get(oldPill)?.left ?? 0) - row.getBoundingClientRect().left
  if (Math.abs(shift) > 4) return
  if (Math.abs(shift) > 0.25) top.animate([{ marginLeft: `${shift}px` }, { marginLeft: '0px' }], soft)

  const cs = getComputedStyle(row)
  const gap = parseFloat(cs.columnGap) || 0
  const own = { backgroundColor: cs.backgroundColor, borderColor: cs.borderColor, color: cs.color }
  // The piece you were in already wore the tab's wash; it keeps it rather than
  // blinking off while the rest of the tab catches up.
  if (wash === own.backgroundColor) look.backgroundColor = wash
  // A lone tab is shorter than a group's pieces; held to its height, they
  // spill a little into its padding instead of making it taller for a moment.
  const inner = `${row.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)}px`
  const lead = lone ? (row.firstElementChild as HTMLElement | null) : null
  const x = lone ? row.querySelector<HTMLElement>(':scope > button') : null
  const inert = (e: HTMLElement): void => {
    e.removeAttribute('data-tab-key')
    e.removeAttribute('draggable')
    e.setAttribute('aria-hidden', 'true')
    e.style.pointerEvents = 'none'
    if (lone) e.style.height = inner
  }

  // The closed pieces go back where they sat: before the next note that
  // stayed, or at the end. Dividers come too, so every seam keeps its line
  // until the piece beside it has gone.
  const ghosts: HTMLElement[] = []
  wraps.forEach((w, i) => {
    if (kept.includes(w)) return
    const after = wraps.slice(i + 1).find((k) => kept.includes(k))
    inert(w)
    row.insertBefore(w, after ? (lone ? lead : now.get(keyOf(after))!.el) : null)
    ghosts.push(w)
  })
  const seam = kept[0].querySelector<HTMLElement>('[data-seg-divider]')
  if (seam) {
    // It sat after the row's gap, which now falls on its right instead.
    const line = wraps[wraps.indexOf(kept[0]) - 1].appendChild(seam.cloneNode(true) as HTMLElement)
    line.style.marginLeft = `${parseFloat(getComputedStyle(line).marginLeft) + gap}px`
  }
  if (lone) {
    inert(grip)
    row.insertBefore(grip, row.firstChild)
    shrinkAway(grip, grip, gap)
  }
  for (const w of ghosts) {
    w.querySelectorAll<HTMLElement>('[data-seg-divider]').forEach((d) => {
      const dcs = getComputedStyle(d)
      const [ml, mr, dw] = [parseFloat(dcs.marginLeft), parseFloat(dcs.marginRight), d.getBoundingClientRect().width]
      const frames: Keyframe[] = []
      for (let i = 0; i <= 24; i++) {
        const left = Math.max(0, 1 - bounceAt(i / 24, SOFT_Y1))
        frames.push({
          offset: i / 24,
          opacity: Math.min(1, left / 0.25),
          width: `${dw * left}px`,
          marginLeft: `${ml * left}px`,
          marginRight: `${mr * left}px`
        })
      }
      d.animate(frames, { duration: BOUNCE_MS, fill: 'forwards' })
    })
    shrinkAway(w, w.querySelector<HTMLElement>('[role="tab"]') ?? w, gap)
  }

  // Widths land without the overshoot: past its width a cut-short name would
  // show one more letter and take it back.
  const flat = { duration: BOUNCE_MS, easing: 'cubic-bezier(0.34, 1, 0.64, 1)' }
  const unclip = (e: HTMLElement): (() => void) => {
    e.style.overflow = 'hidden'
    const kids = Array.from(e.children) as HTMLElement[]
    kids.forEach((k) => (k.style.flexShrink = '0'))
    return () => {
      e.style.overflow = ''
      kids.forEach((k) => (k.style.flexShrink = ''))
    }
  }
  // Widths first: a name the joined tab cut short gets its room back, and the
  // x of a piece you weren't in (drawn over its name) arrives beside it.
  if (lone && lead) {
    const from = was.get(titleIn(kept[0]) as Element)?.width
    const to = lead.getBoundingClientRect().width
    if (from !== undefined && Math.abs(from - to) > 0.5)
      lead.animate([{ maxWidth: `${from}px` }, { maxWidth: `${to}px` }], flat)
  }
  if (lone && x && xWasOver) {
    const done = unclip(x)
    const to = getComputedStyle(x).opacity
    const a = x.animate(
      [
        { width: '0px', marginLeft: `${-gap}px`, opacity: 0 },
        { width: `${x.getBoundingClientRect().width}px`, marginLeft: '0px', opacity: to }
      ],
      flat
    )
    a.onfinish = done
    a.oncancel = done
  }
  if (!lone)
    for (const k of kept) {
      const seg = now.get(keyOf(k))!.el.lastElementChild as HTMLElement | null
      const from = was.get(k.lastElementChild as Element)?.width
      if (!seg || from === undefined) continue
      const to = seg.getBoundingClientRect().width
      if (Math.abs(from - to) <= 0.5) continue
      const done = unclip(seg)
      const a = seg.animate([{ width: `${from}px` }, { width: `${to}px` }], flat)
      a.onfinish = done
      a.oncancel = done
    }
  // Then places, left to right, each read after the one before it has moved.
  for (const c of Array.from(row.children) as HTMLElement[]) {
    let anchor: Element | null = null
    let from: DOMRect | undefined
    if (c === grip || ghosts.includes(c)) [anchor, from] = [c, was.get(c)]
    else if (c === lead) [anchor, from] = [c, was.get(titleIn(kept[0]) as Element)]
    else if (c.hasAttribute('data-group-grip')) [anchor, from] = [c, was.get(grip)]
    else if (c.dataset.tabKey) {
      const k = kept.find((w) => keyOf(w) === c.dataset.tabKey)
      ;[anchor, from] = [c.lastElementChild, k && was.get(k.lastElementChild as Element)]
    }
    if (!anchor || !from) continue
    const d = from.left - anchor.getBoundingClientRect().left
    if (Math.abs(d) < 0.25) continue
    const ml = parseFloat(getComputedStyle(c).marginLeft) || 0
    c.animate([{ marginLeft: `${ml + d}px` }, { marginLeft: `${ml}px` }], soft)
  }
  // And its right-hand end, so what follows it on the strip starts where it was.
  const oldRight = was.get(oldPill)?.right
  if (oldRight !== undefined) {
    const d = oldRight - row.getBoundingClientRect().right
    const pr = parseFloat(cs.paddingRight)
    if (Math.abs(d) >= 0.25)
      row.animate([{ paddingRight: `${Math.max(0, pr + d)}px` }, { paddingRight: `${pr}px` }], soft)
  }
  // A group's own colours becoming the tab's, as the + does for a new tab.
  if (lone) row.animate([look, own], { duration: 240, easing: 'ease-out' })
}

export function TabStrip({
  tabs,
  panes,
  parked,
  active,
  onSelect,
  onClose,
  onReorder,
  onSplitWith,
  onMoveGroup,
  onTakeOutOfSplit,
  onUngroup,
  onDragTab,
  onNewTab,
  island,
  dragging,
  hidden
}: Props): React.JSX.Element {
  // The gap the dragged tab would land in: the path it goes before, or null for
  // "the end". `undefined` means no indicator at all (not over the strip).
  const [before, setBefore] = useState<string | null | undefined>(undefined)
  // The tab a drop would SPLIT against, rather than reorder past. Never set at
  // the same time as `before` — a drop is one gesture or the other, decided by
  // where in the target tab the pointer is.
  const [splitOn, setSplitOn] = useState<string | null>(null)
  // A group being dragged along the strip. Local, not App's `drag`: a group has
  // no meaning to a pane, and leaving App's state null is what keeps the panes'
  // drop zones from lighting up for a gesture they cannot answer.
  // The group being dragged along the strip — its members, since a parked split
  // travels the same way as the one on screen.
  const [groupDrag, setGroupDrag] = useState<string[] | null>(null)
  // Which segment's right-click menu is open, and where.
  const [menu, setMenu] = useState<{ x: number; y: number; path: string } | null>(null)

  const items = stripGroups({ tabs, panes, focus: 0, parked: parked?.length ? parked : undefined })
  /** The joined tab `path` is a piece of, on screen or parked. */
  const groupOf = (path: string): string[] | undefined => items.find((it) => it.length > 1 && it.includes(path))

  // A piece of a joined tab is never wider than a "Select a note" piece
  // (Reuben, 2026-09-25): a short name stays short, a long one ends in "…".
  // Measured in the strip's own font rather than hard-coded, since the
  // interface font is a setting.
  useLayoutEffect(() => {
    const root = strip.current
    const title = root?.querySelector<HTMLElement>('[data-seg-title]')
    if (!root || !title) return
    const cs = getComputedStyle(title)
    const ctx = (measureCanvas ??= document.createElement('canvas')).getContext('2d')
    if (!ctx) return
    ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`
    const w = Math.ceil(ctx.measureText(titleOf(BLANK)).width) + 1
    root.style.setProperty('--seg-title-max', `${w}px`)
  })

  // Opening and closing tabs, animated for the ACTION, whatever asked for it —
  // see stripMotion.ts, which App's `applyLayout` feeds.
  //
  // Opening: a tab that arrives at the END of the strip comes out of the + (it
  // lands right where the + was): the tab starts as the + pill — same place,
  // same size, same grey, a + in it — and stretches on the bookmark's bounce
  // into a full tab, the + inside spinning away, and the real + pops back in at
  // the end. No fades: solid from the first frame. A tab placed further along
  // (a note dropped into a gap) just stretches open where it lands.
  //
  // Closing is the same run backwards, softer: the pill shrinks away with both
  // rounded ends on screen and the strip closes up behind it with a small
  // settle — never so far that it reaches the tab, divider or bookmark before
  // it. React removes the tab in the same render that closes it, so each render
  // notes where every tab sits and a closed one's old element is put back in
  // its spot as an inert stand-in, shrunk, and removed.
  const strip = useRef<HTMLDivElement | null>(null)
  const plus = useRef<HTMLButtonElement | null>(null)
  const placed = useRef(new Map<string, { el: HTMLElement; parent: Element; next: Element | null }>())
  useLayoutEffect(() => {
    const root = strip.current
    const btn = plus.current
    if (!root) return
    const was = placed.current
    const now = new Map<string, { el: HTMLElement; parent: Element; next: Element | null }>()
    root.querySelectorAll<HTMLElement>('[data-tab-key]').forEach((el) => {
      if (el.parentElement)
        now.set(el.dataset.tabKey as string, { el, parent: el.parentElement, next: el.nextElementSibling })
    })
    placed.current = now
    const { opened, closed, unsplit } = takeStripChanges()
    if (!motionOn()) return
    const keyOf = (p: string): string => p || 'blank'
    const gap = parseFloat(getComputedStyle(root).columnGap) || 0

    // --- opening
    const arrived = opened.map(keyOf).filter((k) => now.has(k) && !was.has(k))
    let fromPlus = !!btn
    for (const key of arrived) {
      const el = now.get(key)!.el
      const tab = el.lastElementChild as HTMLElement | null
      if (!tab) continue
      // Its box on the strip itself (a split's segment sits inside the group).
      let top: Element = el
      while (top.parentElement && top.parentElement !== root) top = top.parentElement
      let after = top.nextElementSibling
      while (after && after !== btn?.parentElement && !after.querySelector('[data-tab-key]'))
        after = after.nextElementSibling
      const atEnd = after === btn?.parentElement
      if (atEnd && fromPlus && btn) {
        fromPlus = false // one tab comes out of the +; any other just opens
        // Where the + sat a moment ago: measured now, with the new tab taken
        // out of the layout for one read.
        // It used to be remembered from the last render — which could be one
        // from halfway through an earlier close, so a tab opened just after
        // closing one started out in empty space to the right.
        const hide = el // just this tab — inside a split, its group stays
        hide.style.display = 'none'
        const r = btn.getBoundingClientRect()
        hide.style.display = ''
        // The + may still be mid-pop from an earlier open (a scale), so its
        // untransformed width, centred where it is drawn.
        const w = btn.offsetWidth
        morphFromPlus(el, tab, { left: r.left + (r.width - w) / 2, width: w }, btn)
      } else growInPlace(el, tab, gap)
    }


    // --- leaving a split: the note is still open, now as a tab of its own. It
    // opens where it lands, and its piece of the joined tab goes the way a
    // closed one does (below).
    const leaving = new Set(
      unsplit
        .map(keyOf)
        .filter((k) => was.has(k) && !was.get(k)!.parent.isConnected && now.get(k)?.parent === root)
    )
    for (const key of leaving) {
      const el = now.get(key)!.el
      const tab = el.lastElementChild as HTMLElement | null
      if (tab) growInPlace(el, tab, gap)
    }

    // --- closing. Last first, so a run of closed neighbours each finds the one
    // after it already back in place to sit in front of.
    const gone = closed.map(keyOf).filter((k) => was.has(k) && !now.has(k)).reverse()
    const regrouped = new Set<Element>()
    for (const key of [...gone, ...leaving]) {
      const { el, parent, next } = was.get(key)!
      const tab = el.lastElementChild as HTMLElement | null
      if (!tab) continue
      if (!parent.isConnected) {
        // A piece of a joined tab: the whole group was drawn afresh, once for
        // however many of its pieces closed.
        let old: HTMLElement = el
        while (old.parentElement) old = old.parentElement
        if (!regrouped.has(old)) closeInGroup(root, old, now, leaving)
        regrouped.add(old)
        continue
      }
      const before =
        next && next.isConnected && next.parentElement === parent
          ? next
          : parent === root
            ? (btn?.parentElement ?? null)
            : null
      el.removeAttribute('data-tab-key')
      el.setAttribute('aria-hidden', 'true')
      el.style.pointerEvents = 'none'
      parent.insertBefore(el, before)
      shrinkAway(el, tab, gap)
    }
  })

  /** Whether dropping on `target`'s middle can actually produce a split, which
   *  is what decides whether the middle third is offered at all. An indicator
   *  for a drop the model would refuse (`splitWith` returns the layout it was
   *  given) is worse than no indicator: it promises a column that never comes.
   *
   *  A note already in a pane needs no new column — it just moves — so the cap
   *  only applies to one arriving from the strip. The blank tab is excluded as
   *  a TARGET: "waiting for a note" has nothing to sit beside, and reordering
   *  is the only thing a drop on it can sensibly mean. It is fine as the thing
   *  DRAGGED, where it is exactly the Cmd/Ctrl+\ gesture done by hand. */
  const canSplitOnto = (target: string): boolean =>
    dragging?.kind === 'tab' &&
    dragging.path !== target &&
    target !== BLANK &&
    (panes.includes(dragging.path) || panes.length < MAX_PANES)

  const clear = (): void => {
    setBefore(undefined)
    setSplitOn(null)
  }

  const over = (e: React.DragEvent, path: string | null): void => {
    // A column being dragged is rearranging the SPLIT, not the strip; the panes
    // handle that drop, and the strip stays out of it.
    if (dragging?.kind !== 'tab' && !groupDrag) return
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'move'
    if (path === null) {
      setBefore(null)
      setSplitOn(null)
      return
    }
    // A group travels whole, so there is no half of it to split against and no
    // sense in dropping it inside itself — only the caret is offered.
    if (groupDrag) {
      if (groupDrag.includes(path)) {
        clear()
        return
      }
      const box = (e.currentTarget as HTMLElement).getBoundingClientRect()
      const at = tabs.indexOf(path)
      setSplitOn(null)
      setBefore((e.clientX - box.left) / box.width > 0.5 ? (tabs[at + 1] ?? null) : path)
      return
    }
    const box = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const x = (e.clientX - box.left) / box.width
    // Three zones, matching the pane's own `zoneAt`: the outer thirds keep the
    // reorder this strip has always done, the middle splits. Read off the event
    // rather than off state for the same reason NotePane does it — the drop
    // must land where the pointer is, not where the last dragover put it.
    if (x > 0.3 && x < 0.7 && canSplitOnto(path)) {
      setSplitOn(path)
      setBefore(undefined)
      return
    }
    const at = tabs.indexOf(path)
    setSplitOn(null)
    setBefore(x > 0.5 ? (tabs[at + 1] ?? null) : path)
  }

  const drop = (e: React.DragEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    if (groupDrag) {
      if (before !== undefined) onMoveGroup(before, groupDrag)
    } else if (dragging?.kind === 'tab') {
      if (splitOn !== null) onSplitWith(splitOn, dragging.path)
      else if (before !== undefined) {
        // Dragged OUT of the group and dropped on the strip: leaving the split
        // is the gesture, and the strip position is where it lands. Two steps
        // because they are two different questions — App runs them in order.
        if (groupOf(dragging.path)) onTakeOutOfSplit(dragging.path)
        onReorder(dragging.path, before)
      }
    }
    clear()
    setGroupDrag(null)
  }

  const marker = (path: string | null): React.JSX.Element | null =>
    (dragging?.kind === 'tab' || groupDrag) && before === path ? (
      <span className="mx-px h-6 w-0.5 shrink-0 rounded-full bg-brand-400" aria-hidden="true" />
    ) : null

  /** The shared bits of a clickable name — a lone tab and a group segment do
   *  the same four things, and only their skin differs. */
  const nameProps = (path: string): React.HTMLAttributes<HTMLDivElement> => ({
    onClick: () => onSelect(path),
    onKeyDown: (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        onSelect(path)
      }
    },
    onAuxClick: (e) => {
      if (e.button === 1) onClose(path) // middle-click, as in a browser
    }
  })

  /** `over` — laid on top of the name instead of beside it: a joined tab's
   *  piece you are NOT in, where a hidden x used to hold a gap at the end that
   *  cut the name short for nothing (Reuben, 2026-09-25). It shows on hover,
   *  at full strength, and the name fades out under it (`FADE_UNDER_X`). */
  const closeButton = (path: string, on: boolean, inGroup: boolean, over = false): React.JSX.Element => (
    <button
      type="button"
      aria-label={`Close ${titleOf(path)}`}
      data-tip="Close tab"
      onClick={(e) => {
        e.stopPropagation()
        onClose(path)
      }}
      className={
        'press flex h-5 w-5 items-center justify-center rounded-md border-none bg-transparent p-0 text-current outline-none transition duration-150 hover:bg-ink-300/20 focus-visible:opacity-100 ' +
        (inGroup ? 'group-hover/seg:opacity-100 ' : 'group-hover:opacity-100 ') +
        (over ? 'absolute inset-y-0 right-1 my-auto opacity-0 ' : on ? 'opacity-70 ' : 'opacity-0 ')
      }
    >
      <Icon name="x" className="h-3 w-3" />
    </button>
  )

  const tabDragProps = (path: string): React.HTMLAttributes<HTMLDivElement> => ({
    onDragStart: (e) => {
      e.dataTransfer.effectAllowed = 'move'
      // A private type: the sidebar tree gates its drops on its own state, so a
      // tab must never look like a note being moved.
      e.dataTransfer.setData('application/x-notes-tab', path)
      e.dataTransfer.setData(DRAG_FROM_STRIP, '1')
      onDragTab(path)
    },
    onDragEnd: () => {
      onDragTab(null)
      clear()
    },
    onDragOver: (e) => over(e, path),
    onDrop: drop
  })

  return (
    <>
    <div
      ref={strip}
      className={
        'tab-strip flex shrink-0 items-center gap-1 overflow-x-auto border-b border-ink-300/25 bg-surface/40 px-2 py-1.5 backdrop-blur transition-[opacity,transform] duration-150 ' +
        (hidden ? 'pointer-events-none -translate-y-1 opacity-0' : 'translate-y-0 opacity-100')
      }
      role="tablist"
      aria-label="Open notes"
      onDragOver={(e) => over(e, null)}
      onDrop={drop}
      onDragLeave={clear}
    >
      {island}
      {/* The island and the open tabs are two different questions — what you
          keep to hand, and what you have open right now — so a hairline says so
          rather than letting the chips read as more tabs. */}
      {/* Always there while the island is, even with no tabs open — it divides
          the bookmark from the + as much as from the tabs (Reuben, 2026-09-24,
          reversing 2026-09-19's "only when there are tabs"). Being permanent,
          it no longer grows in with a first tab or folds away with a last. */}
      {island && (
        <span data-strip-divider className="mx-1 h-5 w-px shrink-0 bg-ink-300/25" aria-hidden="true" />
      )}

      {items.map((item) =>
        item.length > 1 ? (
          // --- a joined tab: the split on screen, in screen order, or a parked
          // one waiting to be gone back to. Only the one on screen wears the
          // accent edge; a parked one has an ordinary tab's hairline.
          <div key={'group:' + item.join('|')} className="flex shrink-0 items-center">
            {marker(item[0])}
            <div
              className={
                TAB_BASE.replace('pl-3 pr-1', 'gap-0.5 px-1') +
                (panes.includes(item[0]) ? 'border-brand-400/50 bg-surface/60 ' : 'btn-edge border-ink-300/25 bg-transparent ') +
                (groupDrag?.[0] === item[0] ? 'opacity-40 ' : '')
              }
              data-tip={panes.includes(item[0]) ? 'These notes are sharing the screen' : 'Go back to this split'}
              onDragOver={(e) => over(e, item[0])}
              onDrop={drop}
            >
              {/* The group's own drag handle. It has to be a distinct target:
                  the names inside are draggable too (dragging one takes it OUT
                  of the split), and two gestures that start in the same pixels
                  would be a coin toss. */}
              <span
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = 'move'
                  e.dataTransfer.setData('application/x-notes-tabgroup', '1')
                  setGroupDrag(item)
                }}
                onDragEnd={() => {
                  setGroupDrag(null)
                  clear()
                }}
                data-tip="Drag to move these together"
                data-group-grip
                className="flex h-6 w-3.5 shrink-0 cursor-grab items-center justify-center text-ink-300 transition-colors duration-150 hover:text-ink-500 active:cursor-grabbing"
              >
                <Icon name="grip" className="h-3 w-3" />
              </span>
              {item.map((path, i) => (
                <div key={path || 'blank'} data-tab-key={path || 'blank'} className="flex shrink-0 items-center">
                  {/* The divider IS the split: one per seam, never leading or
                      trailing, so the number of dividers reads as the number of
                      columns minus one. */}
                  {i > 0 && (
                    <span data-seg-divider className="mx-0.5 h-4 w-px shrink-0 bg-ink-300/40" aria-hidden="true" />
                  )}
                  <div
                    role="tab"
                    tabIndex={0}
                    aria-selected={path === active}
                    // The note's name, not its path: a long name is cut short
                    // here, and this is where you read the rest of it.
                    data-tip={path ? titleOf(path) : 'Waiting for a note'}
                    draggable
                    {...nameProps(path)}
                    {...tabDragProps(path)}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      setMenu({ x: e.clientX, y: e.clientY, path })
                    }}
                    className={
                      SEG_BASE +
                      (path === active ? SEG_ON : SEG_OFF) +
                      (dragging?.path === path ? 'opacity-40 ' : '')
                    }
                  >
                    <span
                      data-seg-title
                      className={
                        'truncate font-medium ' +
                        (path === active
                          ? 'max-w-[var(--seg-title-max,168px)] '
                          : // The piece keeps the same outer width as one whose x
                            // shows, and the name gets the x's room as well.
                            'max-w-[calc(var(--seg-title-max,168px)_+_24px)] ' + FADE_UNDER_X)
                      }
                    >
                      {titleOf(path)}
                    </span>
                    {closeButton(path, path === active, true, path !== active)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          // --- an ordinary tab: open, but not on screen
          <div key={item[0] || 'blank'} data-tab-key={item[0] || 'blank'} className="flex shrink-0 items-center">
            {marker(item[0])}
            <div
              role="tab"
              tabIndex={0}
              aria-selected={item[0] === active}
              data-tip={item[0] || 'Waiting for a note'}
              draggable
              {...nameProps(item[0])}
              {...tabDragProps(item[0])}
              className={
                TAB_BASE +
                (item[0] === active ? TAB_ON : TAB_OFF) +
                (dragging?.path === item[0] ? 'opacity-40 ' : '')
              }
            >
              {/* What the drop would do, drawn in the tab itself: the note you
                  are pointing at keeps the left half and the dragged one
                  arrives in a column on the right. Same accent-edge idiom the
                  panes use for their own drop zones (NotePane's `zoneBox`) —
                  on the dark themes a wash alone is very nearly invisible, so
                  the border is what reads. */}
              {splitOn === item[0] && (
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-y-0 right-0 w-1/2 rounded-r-lg border-l-2 border-brand-400 bg-brand-500/20"
                />
              )}
              <span className="max-w-[168px] truncate font-medium">{titleOf(item[0])}</span>
              {closeButton(item[0], item[0] === active, false)}
            </div>
          </div>
        )
      )}
      {marker(null)}
      {/* An empty strip has to be exactly as tall as a full one, or opening the
          first note shifts the page down — the thing reserving the space was
          meant to prevent. Held open by a real tab that happens to be invisible,
          so it can't drift out of step with the tab styling above it.
          The + shares a box with that spacer so the two sit flush:
          as a strip item of its own the spacer also took a full tab's WIDTH,
          which is the gap Reuben saw between the island and the + with no tabs
          open. Zero-width and clipped, it still holds the strip at tab height. */}
      <div
        className={
          'flex shrink-0 items-center ' +
          // Deaf to the pointer while a drag is in flight. The drop indicator
          // is a real 4px-wide element, so showing it SHIFTS whatever follows
          // it — and the + is small enough to slide out from under the pointer
          // entirely. That fired a dragleave, which cleared the indicator,
          // which shifted the + back under the pointer, which fired dragenter…
          // a flicker loop in which no drop ever landed, so a note dropped on
          // the + did nothing (and a chip dropped there was removed from the
          // island without becoming a tab). Ignoring the pointer hands those
          // events to the strip itself, which does not move. Same shape as the
          // 1px sidebar divider in CLAUDE.md's gotchas.
          (dragging || groupDrag ? 'pointer-events-none ' : '')
        }
      >
      {tabs.length === 0 && (
        <div className="w-0 overflow-hidden" aria-hidden="true">
          <div className={TAB_BASE + TAB_OFF + 'invisible'}>
            <span className="font-medium">Untitled</span>
          </div>
        </div>
      )}
      <button
        type="button"
        data-tip="New tab"
        aria-label="New tab"
        ref={plus}
        onClick={onNewTab}
        // Dressed as the bookmark: the same filled pill, size and hover, so the
        // two controls either end of the strip read as one family.
        className="press flex h-6 shrink-0 cursor-pointer items-center rounded-lg border-none bg-ink-300/20 px-1.5 text-ink-600 outline-none transition duration-200 hover:bg-ink-300/30 hover:text-ink-900 focus-visible:ring-2 focus-visible:ring-brand-300"
      >
        <Icon name="plus" className="h-3.5 w-3.5" />
      </button>
      </div>
    </div>
    {menu && (
      <TabGroupMenu
        x={menu.x}
        y={menu.y}
        path={menu.path}
        canTakeOut={!!groupOf(menu.path)}
        onTakeOut={() => onTakeOutOfSplit(menu.path)}
        onUngroup={() => onUngroup(menu.path)}
        onClose={() => onClose(menu.path)}
        onDismiss={() => setMenu(null)}
      />
    )}
    </>
  )
}

/** The grouped tab's right-click menu. Every item names the note you clicked,
 *  because a group is several notes and "Close" alone would be a guess. */
function TabGroupMenu({
  x,
  y,
  path,
  canTakeOut,
  onTakeOut,
  onUngroup,
  onClose,
  onDismiss
}: {
  x: number
  y: number
  path: string
  canTakeOut: boolean
  onTakeOut: () => void
  onUngroup: () => void
  onClose: () => void
  onDismiss: () => void
}): React.JSX.Element {
  const name = titleOf(path)
  const items = [
    ...(canTakeOut ? [{ label: `Take ${name} out of the split`, onClick: onTakeOut }] : []),
    { label: 'Split them all apart', onClick: onUngroup },
    { label: `Close ${name}`, onClick: onClose, danger: true }
  ]
  return (
    <div
      className="menu-backdrop"
      onClick={onDismiss}
      onContextMenu={(e) => {
        e.preventDefault()
        onDismiss()
      }}
    >
      <ul className="menu" style={{ left: x, top: y }} onClick={(e) => e.stopPropagation()}>
        {items.map((it) => (
          <li
            key={it.label}
            className={it.danger ? 'menu-item danger' : 'menu-item'}
            onClick={() => {
              it.onClick()
              onDismiss()
            }}
          >
            {it.label}
          </li>
        ))}
      </ul>
    </div>
  )
}
