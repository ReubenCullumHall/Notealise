import { useState } from 'react'
import { normalizeHex } from '../../../shared/color'
import { ColorField } from '../color/Picker'
import { Icon } from '../icons'
import type { ResolvedThemeId } from '../../../shared/settings'
import { ACCENTS } from './model'

// The accent picker, in one place.
//
// It existed twice — once in Settings → Appearance and once in onboarding's
// Fonts step — as two copies of the same map over `ACCENTS` that had drifted
// into different dot sizes and different ring treatments. Reuben, 2026-09-05:
// the colour pickers were to be universal, "the same preset colours and a
// custom hex colour interface if you want ... in onboarding ... and in accent
// colours". Two hand-rolled copies is exactly how that stops being true again a
// month from now, so there is one component and both places call it.
//
// What it stores: `accent` is either a palette name (`'sage'`), the string
// `'default'`, or a literal `'#rrggbb'`. `accentHue` in model.ts is the only
// thing that has to understand all three — see its note on why a custom accent
// contributes its hue and not its exact colour.

/** Dot size differs between the two callers and always did: onboarding is a
 *  full-screen step with room to breathe, Settings is a dense panel. It is the
 *  only thing either caller gets to change. */
type Size = 'settings' | 'onboarding'

export function AccentPicker({
  accent,
  theme,
  onPick,
  size = 'settings'
}: {
  accent: string
  /** which "no accent" dot to draw — it has to contrast with the page it is on */
  theme: ResolvedThemeId
  onPick: (value: string) => void
  size?: Size
}): React.JSX.Element {
  const custom = accent.startsWith('#') && !!normalizeHex(accent)
  // Open when a custom colour is already in force, or the field that set it
  // would be hidden with no way to see what the colour actually is.
  const [open, setOpen] = useState(custom)
  const [hex, setHex] = useState(custom ? accent : '#e07b5c')

  const dot = size === 'onboarding' ? 'h-7 w-7' : 'h-[30px] w-[30px]'

  return (
    // 480, not 420: twelve 28px dots with eleven 8px gaps measure 424, so the
    // custom one wrapped onto a line of its own by four pixels.
    <div className={size === 'onboarding' ? 'flex w-full max-w-[480px] flex-col items-center' : ''}>
      <div
        className={
          'flex flex-wrap gap-2 ' + (size === 'onboarding' ? 'items-center justify-center' : '')
        }
      >
        {ACCENTS.map((a) => {
          const on = accent === a.id
          // `hex` is null only for 'default', which has to read against the
          // page rather than be a colour of its own.
          const bg = a.hex ?? (theme === 'light' ? '#1a1a1a' : '#e8e8e8')
          return (
            <button
              key={a.id}
              type="button"
              data-tip={a.label}
              aria-label={a.label}
              aria-pressed={on}
              onClick={() => onPick(a.id)}
              style={{ background: bg }}
              className={
                dot +
                ' shrink-0 rounded-full border-none transition duration-150 outline-none ' +
                (on
                  ? 'ring-2 ring-brand-500 ring-offset-2 ring-offset-paper'
                  : 'ring-1 ring-ink-300/25 hover:ring-ink-400/40')
              }
            />
          )
        })}
        {/* The custom accent as an eleventh dot, wearing whatever colour is in
            the field — so a custom accent is visible in the row rather than
            only inside a collapsed disclosure. */}
        <button
          type="button"
          data-tip="Any colour"
          aria-label="Any colour"
          aria-expanded={open}
          aria-pressed={custom}
          onClick={() => setOpen((o) => !o)}
          style={{ background: hex }}
          className={
            dot +
            ' flex shrink-0 items-center justify-center rounded-full border-none text-white outline-none transition duration-150 ' +
            '[filter:drop-shadow(0_0_1.2px_rgb(0_0_0/0.85))] ' +
            (custom
              ? 'ring-2 ring-brand-500 ring-offset-2 ring-offset-paper'
              : 'ring-1 ring-ink-300/25 hover:ring-ink-400/40')
          }
        >
          <Icon name="plus" className="h-3.5 w-3.5" />
        </button>
      </div>

      {open && (
        <div className={'mt-3 w-full ' + (size === 'onboarding' ? 'max-w-[300px]' : 'max-w-[236px]')}>
          <ColorField
            value={hex}
            onChange={(next) => {
              setHex(next)
              onPick(next)
            }}
          />
          <p className="mt-2 text-[11px] leading-relaxed text-ink-400">
            The app builds a full set of readable shades from this colour&rsquo;s hue, so buttons and
            washes still work on every theme — they will not all be this exact colour.
          </p>
        </div>
      )}
    </div>
  )
}
