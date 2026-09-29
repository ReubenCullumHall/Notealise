import { useEffect, useRef, useState } from 'react'
import { Icon } from '../icons'
import { claimEscape } from './escapeClaims'

// The shared controls the Settings sections are built from, lifted out of
// Settings.tsx unchanged so the section files can share them without importing
// each other. Ported from legacy/src/App.jsx — see each doc comment.

/** Title and description on the left, control on the right — ported from
 *  legacy/src/App.jsx's SettingRow. */
export function SettingRow({
  title,
  desc,
  children
}: {
  title: string
  desc: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    // `relative` so a `Select` in the control slot can anchor its dropdown to
    // the whole row (see Select below) rather than just its own button —
    // otherwise nothing stops a future row here from ending up with the same
    // dropdown/row collision the preset library's "Use on…" menu had.
    <div className="relative flex items-start gap-4 py-3.5">
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-semibold text-ink-900">{title}</span>
        <span className="mt-0.5 block text-[11.5px] leading-relaxed text-ink-400">{desc}</span>
      </span>
      <span className="shrink-0 pt-0.5">{children}</span>
    </div>
  )
}

export interface SelectOption {
  id: string
  label: string
  /** Shown under the label in the open list — a live example (Date format,
   *  Time zone) at the default size, or a full description at `size="lg"`. */
  example?: string | null
}

/** A dropdown that shows each option's live example underneath its label, so
 *  you pick the shape you want rather than decoding a name. `filter` turns on
 *  a search box, which the timezone list needs — there are several hundred.
 *  `size="lg"` is for options whose `example` is prose rather than a short
 *  sample — Startup's two choices, say — and needs room to wrap instead of
 *  truncating to one line. Ported from legacy/src/App.jsx's Select. */
export function Select({
  value,
  options,
  onChange,
  filter = false,
  align = 'right',
  size = 'sm'
}: {
  value: string
  options: SelectOption[]
  onChange: (id: string) => void
  filter?: boolean
  align?: 'left' | 'right'
  size?: 'sm' | 'lg'
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const box = useRef<HTMLSpanElement>(null)
  const current = options.find((o) => o.id === value) || options[0]

  useEffect(() => {
    if (!open) return
    // Claimed for exactly as long as this dropdown would itself act on
    // Escape — see escapeClaims.ts for why Settings' own close-on-Escape
    // needs to know this dropdown gets first say.
    const release = claimEscape()
    const onDown = (e: MouseEvent): void => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setOpen(false)
      }
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey, true)
    return () => {
      release()
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  const shown = q
    ? options.filter((o) => (o.label + ' ' + (o.example || '')).toLowerCase().includes(q.toLowerCase()))
    : options

  return (
    // Not `relative` itself — the popover anchors to the `SettingRow` this
    // always sits inside (see its own `relative`), so the dropdown's edge
    // lines up with the row's own edge rather than just this button's, the
    // same fix applied to the preset library's "Use on…" menu.
    <span ref={box} className="inline-flex">
      <button
        onClick={() => {
          setOpen((o) => !o)
          setQ('')
        }}
        aria-expanded={open}
        className={
          'flex items-center gap-1.5 rounded-lg border border-ink-300/30 font-medium outline-none transition duration-200 focus-visible:ring-2 focus-visible:ring-brand-300 ' +
          (size === 'lg' ? 'px-3 py-2 text-[13px] ' : 'px-2.5 py-1.5 text-[12.5px] ') +
          (open ? 'bg-brand-500/15 text-brand-600' : 'btn-edge bg-surface/70 text-ink-700 hover:text-ink-900')
        }
      >
        <span className={(size === 'lg' ? 'max-w-[200px]' : 'max-w-[150px]') + ' truncate'}>
          {current ? current.label : value}
        </span>
        <span className={'inline-flex text-ink-400 transition-transform duration-200 ' + (open ? 'rotate-90' : '')}>
          <Icon name="chevron" className="h-4 w-4" />
        </span>
      </button>

      {open && (
        <div
          className={
            'fade-in absolute top-full z-40 mt-1 w-max rounded-xl border border-ink-300/25 bg-surface p-1 shadow-float ' +
            (size === 'lg' ? 'w-[300px] ' : 'min-w-[190px] ') +
            (align === 'right' ? 'right-0' : 'left-0')
          }
        >
          {filter && (
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search…"
              className="mb-1 w-full rounded-lg bg-ink-300/10 px-2.5 py-1.5 text-[12px] text-ink-900 outline-none placeholder:text-ink-400"
            />
          )}
          <div className="max-h-64 overflow-y-auto">
            {shown.length === 0 && <p className="px-2.5 py-2 text-[12px] text-ink-400">No matches.</p>}
            {shown.map((o) => (
              <button
                key={o.id}
                onClick={() => {
                  onChange(o.id)
                  setOpen(false)
                }}
                className={
                  'flex w-full items-start gap-2 rounded-lg text-left transition duration-150 ' +
                  (size === 'lg' ? 'px-3 py-2.5 ' : 'px-2.5 py-1.5 ') +
                  (o.id === value ? 'bg-brand-500/15' : 'hover:bg-ink-300/15')
                }
              >
                <span className="min-w-0 flex-1">
                  <span
                    className={
                      (size === 'lg' ? 'block text-[13px] ' : 'block truncate text-[12.5px] ') +
                      (o.id === value ? 'font-medium text-brand-600' : 'text-ink-700')
                    }
                  >
                    {o.label}
                  </span>
                  {o.example &&
                    (size === 'lg' ? (
                      <span className="mt-0.5 block text-[11.5px] leading-relaxed text-ink-400">{o.example}</span>
                    ) : (
                      <span className="block truncate text-[11px] text-ink-400">{o.example}</span>
                    ))}
                </span>
                <span className={'shrink-0 text-brand-600 ' + (o.id === value ? 'opacity-100' : 'opacity-0')}>
                  <Icon name="check" className="h-4 w-4" />
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </span>
  )
}

/** Knob is bg-surface so it contrasts with the track in both themes: dark knob
 *  on a grey track in dark mode, white knob on grey in light.
 *
 *  The ON track is `accent-500`, not `brand-500`. They are the same colour
 *  until an accent is picked, and then they part company: `accentMode: 'text'`
 *  (the default) leaves the brand ramp alone, so a brand-painted switch stayed
 *  grey in the mode almost everyone is in. See ACCENT_KEYS in settings/model.ts.
 *  The OFF track stays on the ink ramp — the theme's own colour, faded. */
export function Switch({ on }: { on: boolean }): React.JSX.Element {
  return (
    <span
      className={
        'relative h-5 w-9 shrink-0 rounded-full transition duration-200 ' + (on ? 'bg-accent-500' : 'bg-ink-300/40')
      }
    >
      <span
        className={
          'absolute top-0.5 h-4 w-4 rounded-full bg-surface shadow-card transition-all duration-200 ' +
          (on ? 'left-[18px]' : 'left-0.5')
        }
      />
    </span>
  )
}

/** "Spaces differ" next to a control, on Look → Every space only: the spaces
 *  disagree about it, so showing one space's answer as everyone's would be a
 *  lie. Moved here from SpaceForm.tsx so the basics above the folds (Theme,
 *  Accent colour, the fonts) can carry it in their own headings. `font-sans`
 *  because a heading here is set in the serif. */
export function Differs(): React.JSX.Element {
  return (
    <span
      data-tip="Your spaces don’t agree on this. Changing it here settles it for all of them."
      className="ml-2 inline-flex shrink-0 items-center gap-1 rounded-md bg-wash/[0.07] px-1.5 py-0.5 align-middle font-sans text-[10px] font-medium text-ink-400"
    >
      <Icon name="spaces" className="h-2.5 w-2.5" />
      spaces differ
    </span>
  )
}

/** One setting that is really several yes/no answers about the same thing —
 *  which bars stay on screen while you scroll, what a nested row does with its
 *  folder's colour. It used to be one ToggleRow per answer, each with its own
 *  frame and its own paragraph, which is how the settings pages grew long
 *  enough to lose things in (Reuben, 2026-09-29: "debloat"). One frame, one
 *  hint, a row of ticks. Same frame as ToggleRow, so the two sit together in a
 *  list without looking like different kinds of thing. */
export function TickGroup({
  label,
  hint,
  aside,
  children
}: {
  label: string
  hint?: string
  /** beside the label — the "spaces differ" marker */
  aside?: React.ReactNode
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div role="group" aria-label={label} className="btn-edge rounded-xl px-3 py-3 ring-1 ring-ink-300/20">
      <span className="flex items-center text-[13px] font-medium text-ink-700">
        {label}
        {aside}
      </span>
      {hint && <span className="mt-0.5 block text-[11.5px] leading-relaxed text-ink-400">{hint}</span>}
      <div className="-mx-1.5 mt-1.5 flex flex-wrap items-center gap-1">{children}</div>
    </div>
  )
}

/** A tick box and its label as one button — the settings copy of App.tsx's
 *  TickRow (same box, same accent-not-brand reasoning), plus `disabled` for an
 *  answer that means nothing yet, with `tip` saying what would make it mean
 *  something. `aria-disabled` rather than `disabled`, because a disabled
 *  button gets no hover — and the hover is where the tip says why it's
 *  greyed. `role="checkbox"` on a <button> so it shares every other control's
 *  focus ring; the base `button` rule's border and fill are undone by
 *  `border-none bg-transparent`. */
export function Tick({
  on,
  onClick,
  label,
  disabled = false,
  tip
}: {
  on: boolean
  onClick: () => void
  label: string
  disabled?: boolean
  tip?: string
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={on}
      aria-disabled={disabled || undefined}
      data-tip={tip}
      onClick={disabled ? undefined : onClick}
      className={
        'flex items-center gap-2 rounded-lg border-none bg-transparent px-1.5 py-1.5 text-left text-[12.5px] outline-none transition duration-150 focus-visible:ring-2 focus-visible:ring-brand-300 ' +
        // A greyed tick still has to beat the base `button:hover` fill in
        // app.css, or it lights up as though it could be clicked.
        (disabled ? 'cursor-default opacity-40 hover:bg-transparent ' : 'hover:bg-ink-300/15 hover:text-ink-700 ') +
        (on ? 'text-ink-700' : 'text-ink-500')
      }
    >
      <span
        aria-hidden="true"
        className={
          'flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[4px] border ' +
          (on ? 'border-accent-400 bg-accent-500/25 text-accent-600' : 'border-ink-300/50')
        }
      >
        {on && <Icon name="check" className="h-3 w-3" />}
      </span>
      {label}
    </button>
  )
}

/** A segmented row of tabs above a settings page that holds more than one
 *  page — Look, Data, Help. Explore's own `.explore-tabs` look, so a page with
 *  tabs reads the same wherever it is. */
export function PageTabs<T extends string>({
  tabs,
  value,
  onPick,
  label
}: {
  tabs: { id: T; label: string }[]
  value: T
  onPick: (id: T) => void
  label: string
}): React.JSX.Element {
  return (
    <div className="explore-tabs self-start" role="tablist" aria-label={label}>
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={value === t.id}
          onClick={() => onPick(t.id)}
          className={'explore-tab' + (value === t.id ? ' on' : '')}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}

export function ToggleRow({
  on,
  onClick,
  label,
  hint
}: {
  on: boolean
  onClick: () => void
  label: string
  hint: string
}): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      className={
        'press-row flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left outline-none transition duration-200 focus-visible:ring-2 focus-visible:ring-brand-300 ' +
        (on ? 'bg-brand-500/15 ring-1 ring-brand-300/60' : 'btn-edge ring-1 ring-ink-300/20 hover:bg-ink-300/15')
      }
    >
      <span className="min-w-0 flex-1">
        <span className={'block text-[13px] font-medium ' + (on ? 'text-brand-600' : 'text-ink-700')}>{label}</span>
        <span className="mt-0.5 block text-[11.5px] leading-relaxed text-ink-400">{hint}</span>
      </span>
      <Switch on={on} />
    </button>
  )
}
