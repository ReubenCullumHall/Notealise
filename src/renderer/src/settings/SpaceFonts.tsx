import { findFont, fontCssValue, FONTS, type FontFallback } from './fonts'
import type { FontLibrary } from './useInstalledFonts'
import type { Space } from '../../../shared/settings'
import type { SpaceProps } from './Spaces'
import { Differs } from './primitives'

// The three font pickers. Rendered inside SpaceForm, so — like Theme and
// Colour beside it — they appear in both scopes with no second copy: in
// Spaces → this space they set that space's fonts, in Look → Every space they
// write to every space at once.
//
// Only shows fonts that are actually INSTALLED (bundled + whatever
// `fontLibrary` has downloaded or the user has imported) — you can't select a
// font you don't have. Everything else lives one page over, in Settings →
// Look → Your collection → Fonts (Collection.tsx), which is where "installed" grows.
//
// Three independent picks, not one grid:
//  - `uiFont`, a whole-INTERFACE skin — sidebar, settings, buttons,
//    onboarding. Restyling this never touches a note's own text.
//  - `font`, the same idea for a NOTE's own body, headings and title. Kept
//    separate from `uiFont` on purpose: picking a font to write in
//    shouldn't also restyle the settings window it's picked from, or make
//    the settings look like the note you're writing.
//  - `dyslexiaFont`, a smaller, separate row of just the faces chosen for
//    easier reading — layered on top of `font`, and only ever touching a
//    note's body text, never its headings or the interface. Custom imports
//    never appear here — there's no way to know an arbitrary font file was
//    designed for this, so it stays catalogue-only.
// See settings/fonts.ts and settings/model.ts's applyFont for why these
// don't share a field.

interface DisplayFont {
  id: string
  family: string
  fallback: FontFallback
  blurb: string
}

function toDisplay(f: { id: string; family: string; fallback: FontFallback }): DisplayFont {
  const cat = findFont(f.id)
  return { id: f.id, family: f.family, fallback: f.fallback, blurb: cat?.blurb ?? 'Your own font, from a file you added.' }
}

function FontCard({
  font,
  on,
  onClick
}: {
  font: DisplayFont | null
  on: boolean
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      className={'font-card' + (on ? ' on' : '')}
      aria-pressed={on}
      data-tip={font ? font.blurb : 'The app’s own look — Inter for body text, Fraunces for headings.'}
      onClick={onClick}
    >
      <span className="preview" style={font ? { fontFamily: fontCssValue(font) } : undefined}>
        {font ? font.family : 'Aa'}
      </span>
      <span className="label">
        {on ? '✓ ' : ''}
        {font ? font.family : 'App default'}
      </span>
    </button>
  )
}

function SkinGrid({
  fonts,
  value,
  onPick
}: {
  fonts: DisplayFont[]
  value: string
  onPick: (id: string) => void
}): React.JSX.Element {
  return (
    <div className="font-grid">
      <FontCard font={null} on={!value} onClick={() => onPick('')} />
      {fonts.map((f) => (
        <FontCard key={f.id} font={f} on={value === f.id} onClick={() => onPick(f.id)} />
      ))}
    </div>
  )
}

interface Props extends SpaceProps {
  fontLibrary: FontLibrary
  /** whole-app scope: which of the three the spaces disagree about */
  differs?: (key: keyof Space) => boolean
}

// The third of the three basics on Look and Spaces (2026-09-29), shown open
// rather than inside a Fonts fold — so each heading names its font outright,
// and each hint is one line.
export function SpaceFonts({ space, onChange, fontLibrary, differs }: Props): React.JSX.Element {
  const patch = (p: Partial<Space>): void => onChange(p)

  const bundled = FONTS.filter((f) => f.source === 'bundled')
  const installedNonDyslexia = fontLibrary.installed
    .filter((f) => findFont(f.id)?.category !== 'dyslexia')
    .map(toDisplay)
  const skinFonts: DisplayFont[] = [
    ...bundled.filter((f) => f.category !== 'dyslexia'),
    ...installedNonDyslexia
  ]

  const installedDyslexia = fontLibrary.installed
    .filter((f) => findFont(f.id)?.category === 'dyslexia')
    .map(toDisplay)
  const dyslexiaFonts: DisplayFont[] = [
    ...bundled.filter((f) => f.category === 'dyslexia'),
    ...installedDyslexia
  ]

  return (
    <>
      <section className="settings-group">
        <h3>
          Interface font
          {differs?.('uiFont') && <Differs />}
        </h3>
        <p className="hint">
          The sidebar, settings and buttons — never your writing. More faces are in Look → Your
          collection.
        </p>
        <SkinGrid fonts={skinFonts} value={space.uiFont} onPick={(id) => patch({ uiFont: id })} />
      </section>

      <section className="settings-group">
        <h3>
          Notes font
          {differs?.('font') && <Differs />}
        </h3>
        <p className="hint">A note’s body, headings and title. Code blocks keep JetBrains Mono.</p>
        <SkinGrid fonts={skinFonts} value={space.font} onPick={(id) => patch({ font: id })} />
      </section>

      <section className="settings-group">
        <h3>
          Easier reading font
          {differs?.('dyslexiaFont') && <Differs />}
        </h3>
        <p className="hint">
          Swaps just a note’s body text for a face chosen for legibility, on top of the Notes font.
        </p>
        <SkinGrid fonts={dyslexiaFonts} value={space.dyslexiaFont} onPick={(id) => patch({ dyslexiaFont: id })} />
      </section>
    </>
  )
}
