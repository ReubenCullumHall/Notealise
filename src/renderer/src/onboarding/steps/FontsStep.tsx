import { useEffect } from 'react'
import { FONTS, fontCssValue, type FontOption } from '../../settings/fonts'
import { ACCENTS } from '../../settings/model'
import type { ResolvedThemeId } from '../../../../shared/settings'
import type { OnboardingStepProps } from '../Onboarding'

// The Customisation screen from the 2026-08-17 blueprint — now built down to
// both halves: font, and (added 2026-08-20) accent colour, reusing the same
// `ACCENTS` palette and the "apply to every space" pattern the font half
// already used (App.tsx's pickOnboardingFont / pickOnboardingAccent). Colour
// reach (text-only vs. surfaces too) stays a Settings-only control — one
// decision here, not two.
//
// Only the BUNDLED faces are offered, deliberately, and this is the whole
// reason the screen can exist at all: they ship inside the app (theme.css's
// @font-face rules, assets/fonts/*.woff2), so every card here is instantly
// selectable on a machine that has never been online. The other 16 catalogue
// entries have to be fetched from a CDN first (shared/fonts.ts), and a
// first-run screen is the worst possible place to put a control that can fail
// — an offline install would show four cards that do nothing. Those live one
// place only: Settings → Your collection → Fonts, which the copy below points
// at rather than pretending the choice here is the whole set.
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

export function FontsStep({ theme, value, onPick, accent, onPickAccent, onReady }: Props): React.JSX.Element {
  // Never gated: "App default" is a real answer, and it's the one already
  // selected — there is nothing here a person has to do before moving on.
  // The last step since Walkthrough was cut (2026-08-20) — the button that
  // used to say "Start writing" on that closing screen says it here now.
  useEffect(() => {
    onReady({ ready: true, continueLabel: 'Start writing' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="flex flex-col items-center gap-6 text-center">
      <div>
        <h1 className="font-display text-[24px] font-semibold text-ink-900">Pick a font to write in</h1>
        <p className="mx-auto mt-3 max-w-[440px] text-[14px] leading-relaxed text-ink-500">
          This is the face your notes are written in. Every space can have its own, and you can change
          it whenever you like — nothing here is locked in.
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

      <p className="max-w-[420px] text-[12px] leading-relaxed text-ink-400">
        These five are built in, so they work offline from the day you install. Sixteen more — plus
        any font file of your own — live in{' '}
        <span className="text-ink-500">Settings → Your collection → Fonts</span>.
      </p>

      <div className="flex flex-col items-center gap-2.5 border-t border-ink-300/15 pt-5">
        <p className="text-[12.5px] font-medium text-ink-700">And a colour, if you want one</p>
        <div className="flex flex-wrap items-center justify-center gap-2">
          {ACCENTS.map((a) => {
            const on = accent === a.id
            const bg = a.hue == null ? (theme === 'light' ? '#1a1a1a' : '#e8e8e8') : `hsl(${a.hue} 50% 55%)`
            return (
              <button
                key={a.id}
                type="button"
                data-tip={a.label}
                aria-label={a.label}
                aria-pressed={on}
                onClick={() => onPickAccent(a.id)}
                style={{ background: bg }}
                className={
                  'h-7 w-7 shrink-0 rounded-full transition duration-150 ' +
                  (on
                    ? 'ring-2 ring-brand-500 ring-offset-2 ring-offset-paper'
                    : 'ring-1 ring-ink-300/25 hover:ring-ink-400/40')
                }
              />
            )
          })}
        </div>
        <p className="text-[11.5px] text-ink-400">
          Leave it on Default and the app stays neutral. Every space can have its own later.
        </p>
      </div>
    </div>
  )
}
