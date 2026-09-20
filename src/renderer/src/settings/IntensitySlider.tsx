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

export function IntensitySlider({
  value,
  accent,
  onChange
}: {
  value: number
  accent: boolean
  onChange: (n: number) => void
}): React.JSX.Element {
  const drag = useDragTrack((x) => onChange(normalizePageLookIntensity(x * PAGE_LOOK_INTENSITY_MAX)))
  const nudge = (e: React.KeyboardEvent): void => {
    const step = e.shiftKey ? 10 : 1
    const d: Record<string, number> = { ArrowLeft: -step, ArrowRight: step, ArrowDown: -step, ArrowUp: step }
    const hit = d[e.key]
    if (hit === undefined) return
    e.preventDefault()
    onChange(normalizePageLookIntensity(value + hit))
  }
  return (
    <div
      {...drag}
      id="page-look-intensity"
      role="slider"
      tabIndex={0}
      aria-label="Page look intensity"
      aria-valuemin={PAGE_LOOK_INTENSITY_MIN}
      aria-valuemax={PAGE_LOOK_INTENSITY_MAX}
      aria-valuenow={value}
      aria-valuetext={`${value} percent`}
      onKeyDown={nudge}
      className="look-intensity mt-1.5"
      style={{ '--page-look-rgb': accent ? 'var(--accent-500)' : 'var(--wash)' } as React.CSSProperties}
    >
      <span
        className="color-handle"
        style={{ left: `${value}%`, top: '50%', '--handle-rgb': 'var(--page-look-rgb)' } as React.CSSProperties}
      />
    </div>
  )
}
