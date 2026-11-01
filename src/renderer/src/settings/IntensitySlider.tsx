import { useEffect, useRef, useState } from 'react'
import { normalizePageLookIntensity, PAGE_LOOK_INTENSITY_MAX, PAGE_LOOK_INTENSITY_MIN } from '../../../shared/looks'
import { useDragTrack } from '../color/dragTrack'

// The page-look intensity fine tuner (Space.pageLookIntensity) — how strongly
// the pattern draws, independent of which look is picked and of the tint.
// Same track vocabulary as Explore's tint strength slider (`.tint-alpha`), but
// the fill colour is `--page-look-rgb` rather than a picked hex — set here
// from `accent` (ink wash vs. the space's own accent colour) — so the track
// always shows the colour the pattern will actually draw in.
//
// Shared by SpacePage.tsx (Settings → Page look, and Customisation's mirror of
// it) and Collection.tsx (Your collection's "Page looks" shelf) — one
// component so a fix or a restyle only has to happen once.
//
// Dragging saves NOTHING until the pointer lets go (Reuben, 2026-11-01: "it
// needs to be smooth … it's just a slider"). Measured with a real vault, two
// things made a drag stutter, and both are gone from the drag:
//  - every settings save re-renders the whole app, and two of the things that
//    re-run on it are slow — each open note's backlinks (NotePane →
//    incomingLinks) and the accent colours (applySettings → applyAccent reads
//    computed styles): 50–90 ms a save. Even throttled, it froze a third of
//    the frames.
//  - previewing the drag on the page by writing `--page-look-intensity` on
//    <html> restyles every element in the window (~26 ms each on Look → Every
//    space), because the pattern's colours are worked out on <html>.
// So during a drag only the handle and the "Intensity — n%" label move,
// following a local `draft`; one save on release lands the value and redraws
// the pattern. Settings covers the page anyway.

export function IntensitySlider({
  value,
  accent,
  onChange
}: {
  value: number
  accent: boolean
  onChange: (n: number) => void
}): React.JSX.Element {
  /** where the handle is while a drag (or its save) is still in flight */
  const [draft, setDraft] = useState<number | null>(null)
  const dragging = useRef(false)
  const latest = useRef(value)
  const saved = useRef(value)
  saved.current = value

  const drag = useDragTrack(
    (x) => {
      const n = normalizePageLookIntensity(x * PAGE_LOOK_INTENSITY_MAX)
      dragging.current = true
      latest.current = n
      setDraft(n)
    },
    () => {
      dragging.current = false
      if (latest.current === saved.current) setDraft(null)
      else onChange(latest.current)
    }
  )

  // Hand the handle back to the saved value once the save comes back with the
  // number the drag ended on.
  useEffect(() => {
    if (!dragging.current && draft !== null && value === draft) setDraft(null)
  }, [value, draft])

  const shown = draft ?? value
  const nudge = (e: React.KeyboardEvent): void => {
    const step = e.shiftKey ? 10 : 1
    const d: Record<string, number> = { ArrowLeft: -step, ArrowRight: step, ArrowDown: -step, ArrowUp: step }
    const hit = d[e.key]
    if (hit === undefined) return
    e.preventDefault()
    setDraft(null)
    onChange(normalizePageLookIntensity(shown + hit))
  }
  return (
    <>
      <label className="block text-[11.5px] font-medium text-ink-700" htmlFor="page-look-intensity">
        Intensity — {shown}%
      </label>
      <div
        {...drag}
        id="page-look-intensity"
        role="slider"
        tabIndex={0}
        aria-label="Page look intensity"
        aria-valuemin={PAGE_LOOK_INTENSITY_MIN}
        aria-valuemax={PAGE_LOOK_INTENSITY_MAX}
        aria-valuenow={shown}
        aria-valuetext={`${shown} percent`}
        onKeyDown={nudge}
        className="look-intensity mt-1.5"
        style={{ '--page-look-rgb': accent ? 'var(--accent-500)' : 'var(--wash)' } as React.CSSProperties}
      >
        <span
          className="color-handle"
          style={{ left: `${shown}%`, top: '50%', '--handle-rgb': 'var(--page-look-rgb)' } as React.CSSProperties}
        />
      </div>
    </>
  )
}
