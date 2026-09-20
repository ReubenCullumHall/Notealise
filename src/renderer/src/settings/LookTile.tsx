import { rgbChannels } from '../../../shared/color'
import { findPageLook, parseTint, PAGE_LOOK_INTENSITY_DEFAULT } from '../../../shared/looks'

// The miniature every page-look and tint control is built out of — the cards
// in Your collection, the cards in Explore, and the pickers on a space.
//
// It is drawn by the SAME CSS that paints the real writing area
// (`[data-page-look='…']` + the two --page-tint-* properties, app.css), on a
// tile that sets both itself. Two consequences, both deliberate:
//
//  - the pattern is at its real scale, never shrunk to fit the card. What you
//    are choosing between is how dense the rules are, so a tile that scaled
//    them would be a picture of a different look.
//  - a look added to the catalogue with no CSS rule of its own shows a plain
//    page here, exactly as it would in the editor. The preview cannot claim
//    something the app can't draw.
//
// Setting `data-page-look` on the tile is also what stops it inheriting the
// ACTIVE space's look from <html>, which would make every card in the picker
// look like whatever you already had.

interface Props {
  /** page look id; anything unknown (including '') is a plain page */
  look?: string
  /** `#rrggbb@nn` token; anything unparseable is no tint */
  tint?: string
  /** how many specimen lines of "writing" to draw over it */
  lines?: number
  /** the selected ring */
  on?: boolean
  /** 0..100, same meaning as Space.pageLookIntensity; defaults to the neutral
   *  50 so every existing call site keeps rendering exactly as before this
   *  axis existed. */
  intensity?: number
  /** draw the pattern in the accent colour instead of the theme's ink wash —
   *  same meaning as Space.pageLookAccent */
  accent?: boolean
  /** height/width utilities from the caller — the tile has no size of its own */
  className?: string
}

/** Line lengths, in the order they're used. Uneven on purpose: four bars of
 *  the same width read as a barcode, not as a paragraph. */
const WIDTHS = ['100%', '86%', '94%', '62%']

export function LookTile({
  look = '',
  tint = '',
  lines = 2,
  on,
  intensity = PAGE_LOOK_INTENSITY_DEFAULT,
  accent = false,
  className = ''
}: Props): React.JSX.Element {
  const parsed = parseTint(tint)
  const vars = {
    '--page-tint-rgb': parsed ? rgbChannels(parsed.hex) : '0 0 0',
    '--page-tint-alpha': parsed ? parsed.opacity / 100 : 0,
    '--page-look-intensity': intensity / PAGE_LOOK_INTENSITY_DEFAULT,
    // Set directly rather than via the `data-page-look-accent` attribute
    // app.css keys off for the real editor — that rule is scoped to `:root`
    // on purpose (so it inherits down to the scroller), and this tile is
    // never :root, so the same attribute here would just match nothing.
    '--page-look-rgb': accent ? 'var(--accent-500)' : 'var(--wash)'
  } as React.CSSProperties

  return (
    <span
      aria-hidden="true"
      data-page-look={findPageLook(look)?.id ?? 'none'}
      style={vars}
      className={'look-tile block ' + (on ? 'on ' : '') + className}
    >
      <span className="ink-stack">
        {Array.from({ length: lines }, (_, i) => (
          <span key={i} className="ink" style={{ width: WIDTHS[i % WIDTHS.length] }} />
        ))}
      </span>
    </span>
  )
}
