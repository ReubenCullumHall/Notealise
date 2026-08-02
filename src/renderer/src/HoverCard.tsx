import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

// The one way this app shows more about something you're pointing at: a small
// card directly beneath it. Used by the link inspector and by a note's
// timestamps, so "hover for detail" means the same thing everywhere.
//
// **Portalled to document.body, and that is not optional.** It positions itself
// in viewport coordinates, and `position: fixed` is only relative to the viewport
// while no ancestor has a `transform`, `filter`, `backdrop-filter` or
// `will-change` — any of those makes that ancestor the containing block instead.
// The links strip has BOTH (a translate as it scrolls away, and a backdrop blur),
// which is what once put the link card hundreds of pixels from the link it
// described. Same trap as the settings modal and the sidebar (CLAUDE.md).
//
// Native `title` tooltips are deliberately not used for any of this: the OS puts
// them wherever the cursor is, after a delay it chooses, which is neither under
// the thing nor consistent between two places in the same window.

/** Where the hovered element is, in viewport coordinates. Just the three edges
 *  the card needs, so a caller can hand over a plain object. */
export interface Anchor {
  left: number
  top: number
  bottom: number
}

/** How far below the hovered thing the card sits: close enough to read as
 *  belonging to it, far enough not to sit under the cursor. */
const GAP = 6
const EDGE = 8

export function HoverCard({
  at,
  width = 304,
  children
}: {
  at: Anchor
  width?: number
  children: React.ReactNode
}): React.JSX.Element {
  const box = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState(0)

  // Measured after paint so the flip decision uses the card's real height rather
  // than a guess — the contents vary (a backlink carries a quoted line, a folder
  // doesn't).
  useLayoutEffect(() => {
    setHeight(box.current?.offsetHeight ?? 0)
  }, [at, children])

  const below = at.bottom + GAP
  const flip = height > 0 && below + height > window.innerHeight - EDGE
  return createPortal(
    <div
      ref={box}
      style={{
        position: 'fixed',
        left: Math.max(EDGE, Math.min(at.left, window.innerWidth - width - EDGE)),
        top: flip ? Math.max(EDGE, at.top - GAP - height) : below,
        width
      }}
      className="pointer-events-none z-[80] max-w-[calc(100vw-1rem)] rounded-lg border border-ink-300/30 bg-surface/95 px-2.5 py-2 text-left shadow-float backdrop-blur"
    >
      {children}
    </div>,
    document.body
  )
}
