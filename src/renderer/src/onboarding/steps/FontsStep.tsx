import { useEffect, useRef } from 'react'
import { FONTS, fontCssValue, type FontOption } from '../../settings/fonts'
import { AccentPicker } from '../../settings/AccentPicker'
import type { AccentMode, ResolvedThemeId } from '../../../../shared/settings'
import type { OnboardingStepProps } from '../Onboarding'

// The Customisation screen from the 2026-08-17 blueprint — now built down to
// both halves: font, and (added 2026-08-20) accent colour, reusing the same
// `ACCENTS` palette and the "apply to every space" pattern the font half
// already used (App.tsx's pickOnboardingFont / pickOnboardingAccent). Colour
// reach (text-only vs. surfaces too) was Settings-only until 2026-09-21, when
// Reuben asked for it here: it appears ONLY once a colour is picked, so the
// screen stays a font pick for anyone who leaves the colour on Default.
//
// Only the BUNDLED faces are offered, deliberately, and this is the whole
// reason the screen can exist at all: they ship inside the app (theme.css's
// @font-face rules, assets/fonts/*.woff2), so every card here is instantly
// selectable on a machine that has never been online. The other 16 catalogue
// entries have to be fetched from a CDN first (shared/fonts.ts), and a
// first-run screen is the worst possible place to put a control that can fail
// — an offline install would show four cards that do nothing. Those live one
// place only: Settings → Your collection → Fonts. The pointer to it used to
// be a footnote here too ("These five are built in… sixteen more live in
// Settings"); cut 2026-09-23, Reuben's call — it was why this step scrolled
// in the app's default window size, and it's a technical aside a first run
// doesn't need.
//
// Writes `font` (a note's own text), not `uiFont` (the app's chrome) — the two
// are separate settings on purpose, see SpaceFonts.tsx. This is a Markdown
// editor and the screen is about the writing; restyling the interface from a
// screen that says "your notes" would be the wrong one of the pair.

// Explicit order, not the catalogue's: shelved by what someone would reach
// for, everyday first — plain sans, serif, typewriter, then the accessibility
// pick. Filtering FONTS in place put OpenDyslexic second, which reads as an
// odd second thing to offer before the app has explained what it's for.
const ORDER = ['inter', 'fraunces', 'jetbrains-mono', 'opendyslexic']
const CHOICES: FontOption[] = ORDER.map((id) => FONTS.find((f) => f.id === id && f.source === 'bundled')!)

/** What each bundled face is actually FOR, in one line — the catalogue's own
 *  `blurb` is written for someone browsing Settings who already knows what a
 *  skin is, and reads as jargon on a first-run screen ("Picking it explicitly
 *  makes headings sans too"). */
const ONBOARDING_BLURB: Record<string, string> = {
  inter: 'Clean and plain. The one most apps use.',
  fraunces: 'A serif with some warmth to it.',
  'jetbrains-mono': 'Even-width letters, like a typewriter.',
  opendyslexic: 'Weighted at the bottom, easier to read for some.'
}

interface Props extends OnboardingStepProps {
  theme: ResolvedThemeId
  value: string
  onPick: (id: string) => void
  accent: string
  onPickAccent: (id: string) => void
  /** what the picked colour recolours — the Space's `accentMode` */
  accentMode: AccentMode
  onPickAccentMode: (mode: AccentMode) => void
}

function FontCard({
  font,
  on,
  onClick
}: {
  font: FontOption | null
  on: boolean
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={'font-card w-[150px] shrink-0' + (on ? ' on' : '')}
      aria-pressed={on}
      onClick={onClick}
    >
      {/* Settings' .preview truncates to one line (`white-space: nowrap` +
          ellipsis), which is right in a dense grid and wrong here — it cut
          "OpenDyslexic" and "JetBrains Mono" down to "OpenDys…". Let them
          wrap; the row stretches to match. `break-words` is doing real work —
          "OpenDyslexic" is one unbreakable word in a wide face and overflows
          the card on its own line without it. */}
      <span
        className="preview !overflow-visible !whitespace-normal break-words"
        style={font ? { fontFamily: fontCssValue(font) } : undefined}
      >
        {font ? font.family : 'Aa'}
      </span>
      <span className="label">
        {on ? '✓ ' : ''}
        {font ? font.family : 'App default'}
      </span>
      <span className="mt-1 block text-[11px] leading-snug text-ink-400">
        {font ? ONBOARDING_BLURB[font.id] : 'Inter to write in, Fraunces for headings.'}
      </span>
    </button>
  )
}

// Wording is Reuben's, 2026-09-21. The ids are the Space's own, so a pick here
// is the same setting as Settings → Customisation's "Text only" / "Tinted".
const REACH: { id: AccentMode; label: string }[] = [
  { id: 'text', label: 'Colour the text' },
  { id: 'tint', label: 'Tint the whole page' }
]

export function FontsStep({
  theme,
  value,
  onPick,
  accent,
  onPickAccent,
  accentMode,
  onPickAccentMode,
  onReady
}: Props): React.JSX.Element {
  // Never gated: "App default" is a real answer, and it's the one already
  // selected — there is nothing here a person has to do before moving on.
  // The last step since Walkthrough was cut (2026-08-20) — the button that
  // used to say "Start writing" on that closing screen says it here now.
  useEffect(() => {
    onReady({ ready: true, continueLabel: 'Start writing' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The colour block is the bottom of a step that already scrolls in the app's
  // default 1100×720 window, so the reach choice appearing under the swatches
  // landed BELOW the fold (measured 2026-09-21: row at y 550–586 in a scroll box
  // ending at 567) — the page recoloured and the new choice was out of sight.
  // Bring the block's last line into view the moment a colour is first picked.
  // Not on mount: coming Back to a step that already has a colour must not
  // jump past its heading.
  const colourEnd = useRef<HTMLParagraphElement>(null)
  const hadColour = useRef(accent !== 'default')
  useEffect(() => {
    const has = accent !== 'default'
    if (has && !hadColour.current) {
      colourEnd.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
    hadColour.current = has
  }, [accent])

  return (
    <div className="flex flex-col items-center gap-6 text-center">
      <div>
        <h1 className="font-display text-[24px] font-semibold text-ink-900">Pick a font to write in</h1>
        <p className="mx-auto mt-3 max-w-[440px] text-[14px] leading-relaxed text-ink-500">
          Every space can have its own, and you can change it whenever you like — nothing here is
          locked in.
        </p>
      </div>

      {/* Flex-wrap rather than settings' `.font-grid`: five cards over three
          columns leaves a two-card second row, and a grid left-aligns that
          remainder against a centred screen. Wrapping centres it. */}
      <div className="flex w-full max-w-[480px] flex-wrap items-stretch justify-center gap-2">
        <FontCard font={null} on={!value} onClick={() => onPick('')} />
        {CHOICES.map((f) => (
          <FontCard key={f.id} font={f} on={value === f.id} onClick={() => onPick(f.id)} />
        ))}
      </div>

      <div className="flex flex-col items-center gap-2.5 border-t border-ink-300/15 pt-5">
        <p className="text-[12.5px] font-medium text-ink-700">And a colour, if you want one</p>
        {/* The same control as Settings → Appearance → Accent, component and
            all (2026-09-05). It was a second hand-rolled copy of the same map
            over ACCENTS, and the two had already drifted. */}
        <AccentPicker
          accent={accent}
          theme={theme}
          onPick={onPickAccent}
          size="onboarding"
        />
        {/* Only once a colour is picked — 'default' is "no accent", so there is
            nothing for a reach to apply to. The page behind it is the preview:
            Onboarding.tsx recolours its own text for 'text' and the tinted
            ramp repaints the page itself for 'tint'. */}
        {accent !== 'default' && (
          <div
            className="mode-row onboarding-fade-in w-full max-w-[380px]"
            // .mode-row's own 12px top margin is for Settings; the column's gap
            // already spaces this one
            style={{ marginTop: 0 }}
            role="group"
            aria-label="What the colour applies to"
          >
            {REACH.map((r) => {
              const on = accentMode === r.id
              return (
                <button
                  key={r.id}
                  type="button"
                  className={'mode-btn' + (on ? ' on' : '')}
                  aria-pressed={on}
                  onClick={() => onPickAccentMode(r.id)}
                >
                  <span className="t text-center">{r.label}</span>
                </button>
              )
            })}
          </div>
        )}
        <p ref={colourEnd} className="text-[11.5px] text-ink-400">
          Leave it on Default and the app stays neutral. Every space can have its own later.
        </p>
      </div>
    </div>
  )
}
