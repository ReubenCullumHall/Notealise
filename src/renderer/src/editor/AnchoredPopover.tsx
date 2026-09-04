import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

// A dropdown hung off a button in the note's command row — the "?" slot picker
// and the colour menu.
//
// **Portalled to document.body, and that is not optional.** Rendered in place,
// these two panels were unreachable: every click on them landed in CodeMirror.
// Measured 2026-08-29 with a headless Electron probe against the live renderer
// — `document.elementFromPoint` at the first command in the slot picker
// returned `div.cm-content`, not the menu, and the same for every colour swatch
// and "Remove colour".
//
// Why. The command row (`ROW_CLASS`, NotePane.tsx) is `position: static`, and
// its later sibling `.pane-body` — which holds the editor — is
// `position: relative`. A positioned element paints above a static one, so
// anything the row hangs BELOW itself is covered by the editor. The panel's own
// `z-index: 40` could not save it: the row also carries `backdrop-filter` and a
// `translate-y-0` transform, either of which makes it a stacking context, and a
// stacking context traps its descendants' z-index inside itself — the row
// contributes no z-index of its own to compete with `.pane-body`. Confirmed by
// isolating it: `transform: none` and `backdrop-filter: none` on the row change
// nothing, while `position: relative; z-index: 50` on the row, or
// `z-index: -1` on `.pane-body`, both make the panel clickable again.
//
// That is the same trap CLAUDE.md records for `.fade-in`'s `both`-filled
// transform, and the same fix applies: **escaping the ancestor is the only
// thing that works, raising the z-index is not.** Going out to `document.body`
// also clears the second version of this in a split column, where the toolbar
// itself is `overflow-x-auto` — a scroll container clips a child panel no
// matter what paints where.
//
// Positioning, close rules and the flip-when-it-would-overflow are lifted from
// `color/Picker.tsx`'s `ColorPopover` deliberately, so every anchored popover in
// the app sits at the same distance and closes on the same gestures.

/** How far below the trigger the panel sits, and how close to the window edge it
 *  may come. GAP is 8 rather than `color/Picker.tsx`'s 6 so the drop keeps the
 *  exact spacing these two panels had as `top-9` children of a 28px button —
 *  moving them out to a portal must not move them on screen. */
const GAP = 8
const EDGE = 8

interface Props {
  /** the button this hangs off: read for its position, and excluded from the
   *  click-outside check so clicking it again closes rather than re-opens */
  anchor: React.RefObject<HTMLElement | null>
  width: number
  /** how tall the panel may grow before it scrolls internally; it is clamped to
   *  the space actually available as well */
  maxHeight?: number
  label: string
  onClose: () => void
  children: React.ReactNode
}

export function AnchoredPopover({
  anchor,
  width,
  maxHeight = 420,
  label,
  onClose,
  children
}: Props): React.JSX.Element | null {
  const panel = useRef<HTMLDivElement>(null)
  const [at, setAt] = useState<DOMRect | null>(null)
  const [height, setHeight] = useState(0)

  // Measured after paint, not guessed: the slot picker's height depends on how
  // many commands there are, and the flip decision below needs the real number.
  useLayoutEffect(() => {
    setAt(anchor.current?.getBoundingClientRect() ?? null)
  }, [anchor])
  useLayoutEffect(() => {
    setHeight(panel.current?.offsetHeight ?? 0)
  }, [at, children])

  // Re-anchor on a resize rather than leaving the panel stranded where the
  // button used to be. Not on scroll: the only scroller under it is the note
  // itself, and a click-outside already closes this before that can matter.
  useEffect(() => {
    const remeasure = (): void => setAt(anchor.current?.getBoundingClientRect() ?? null)
    window.addEventListener('resize', remeasure)
    return () => window.removeEventListener('resize', remeasure)
  }, [anchor])

  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      const t = e.target as Node
      if (panel.current?.contains(t)) return
      if (anchor.current?.contains(t)) return // its own toggle handles this
      onClose()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation() // close the menu, don't let it reach the editor
        onClose()
      }
    }
    // CAPTURE for the mousedown, as in ColorPopover: a click on a sidebar row
    // must close this before that row's own handler opens a note.
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [anchor, onClose])

  if (!at) return null

  const below = at.bottom + GAP
  const flip = height > 0 && below + height > window.innerHeight - EDGE
  const room = flip ? at.top - GAP - EDGE : window.innerHeight - below - EDGE
  // CENTRED on the button, not aligned to one of its edges. Edge alignment is
  // what a menu bar does, where the trigger is the corner of the thing it
  // opens; these are 28px icon buttons in the middle of a row, and a 268px
  // panel hanging off one side of one reads as belonging to whatever it happens
  // to cover. Clamped below, so a slot near the window edge still opens fully
  // on screen — it just stops being centred at that point.
  const left = at.left + at.width / 2 - width / 2

  return createPortal(
    <div
      ref={panel}
      role="dialog"
      aria-label={label}
      style={{
        position: 'fixed',
        left: Math.max(EDGE, Math.min(left, window.innerWidth - width - EDGE)),
        top: flip ? Math.max(EDGE, at.top - GAP - height) : below,
        width,
        maxHeight: Math.max(120, Math.min(maxHeight, room))
      }}
      // The toolbar's own container prevents this for the buttons inside it, so
      // that clicking one never blurs the editor or collapses the selection the
      // command is about to act on. Out here in a portal the panel is no longer
      // inside that container, so it has to say so itself — without this, every
      // colour swatch would apply to an empty selection.
      onMouseDown={(e) => e.preventDefault()}
      className="fade-in z-[80] overflow-y-auto rounded-xl border border-ink-300/25 bg-surface p-2.5 shadow-float"
    >
      {children}
    </div>,
    document.body
  )
}
