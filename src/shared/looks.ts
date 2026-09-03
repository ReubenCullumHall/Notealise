// The look catalogue: **page looks** (a pattern drawn behind the writing area)
// and **tints** (a colour wash under it). The sibling of shared/fonts.ts, and
// deliberately the same shape — pure data plus pure functions, no fs and no
// DOM, so main, the renderer and the tests can all import it.
//
// Both were reserved fields on a Space long before anything read them
// (`pageLook`, `tint` — see shared/settings.ts and
// docs/appearance-research-brief.md §5). This file is what they now mean.
//
// TWO THINGS THAT LOOK ALIKE AND ARE NOT
//
//   A page look is an ID. Every one of them ships inside the app — the pattern
//   is CSS, there is nothing to fetch — so "installing" one only adds it to
//   your collection, which is what keeps the per-space picker short instead of
//   listing all of them forever. The copy in Explore says so plainly rather
//   than dressing a curation act up as a download.
//
//   A tint is a VALUE, not an id: `#rrggbb@nn`, a hex colour and an opacity
//   percentage. That is the whole definition — which is why a tint can be
//   invented with a colour wheel and a slider and still be stored in the same
//   short string a Space already had, with no id registry to keep in step.
//   The built-ins below are only tokens with names attached.
//
// WHY A WASH UNDER THE TEXT AND NOT A FILM OVER IT. The overlays this feature
// comes from (visual stress, dyslexia — research question 1 in the brief) are
// physical sheets laid ON the page, and the obvious translation is a
// translucent layer over the editor. It is the wrong translation: it mutes the
// ink along with the paper, drops the contrast of every syntax colour, and
// would sit over the caret and the selection. Painting the same colour BEHIND
// the text gives the same tinted page with the ink untouched.

import { normalizeHex } from './color'

export type PageLookSource = 'bundled' | 'catalogue'

export interface PageLook {
  id: string
  name: string
  blurb: string
  /** 'bundled' is in your collection from install and can't be removed;
   *  'catalogue' has to be added from Explore first. Nothing is downloaded
   *  either way — see the header. */
  source: PageLookSource
}

/** Every look the CSS knows how to draw. The id IS the value written to
 *  `Space.pageLook`, and it is what `[data-page-look='…']` in app.css matches
 *  on — so adding one here without adding its rule there gets you a plain page,
 *  never a broken one. */
export const PAGE_LOOKS: PageLook[] = [
  {
    id: 'lined',
    name: 'Lined',
    blurb: 'Ruled like a notebook, spaced to the editor’s own line height.',
    source: 'bundled'
  },
  {
    id: 'grid',
    name: 'Grid',
    blurb: 'Squared paper. Good for tables, diagrams and working out.',
    source: 'bundled'
  },
  {
    id: 'lined-tight',
    name: 'Narrow lined',
    blurb: 'The same rules, closer together — more lines to the page.',
    source: 'catalogue'
  },
  {
    id: 'grid-fine',
    name: 'Fine grid',
    blurb: 'A smaller square. Quieter behind text than the full grid.',
    source: 'catalogue'
  },
  {
    id: 'dots',
    name: 'Dot grid',
    blurb: 'Bullet-journal dots — structure without lines running through your words.',
    source: 'catalogue'
  },
  {
    id: 'graph',
    name: 'Graph paper',
    blurb: 'Fine squares with a heavier rule every fifth one.',
    source: 'catalogue'
  },
  {
    id: 'grain',
    name: 'Soft grain',
    blurb: 'No lines at all — just a faint speckle, like paper stock.',
    source: 'catalogue'
  }
]

export function findPageLook(id: string): PageLook | undefined {
  return id ? PAGE_LOOKS.find((l) => l.id === id) : undefined
}

/** In the collection from install. Everything else has to be added. */
export const BUNDLED_PAGE_LOOKS = PAGE_LOOKS.filter((l) => l.source === 'bundled')
export const CATALOGUE_PAGE_LOOKS = PAGE_LOOKS.filter((l) => l.source === 'catalogue')

// --- tints ------------------------------------------------------------------

export interface Tint {
  /** '#rrggbb', lower case */
  hex: string
  /** 1..TINT_MAX, whole percent */
  opacity: number
}

/** Above ~40% a wash stops being a tint and starts being a background colour
 *  the theme did not choose — the ink ramp is picked for --paper, not for
 *  this. Capped rather than clamped silently at the slider: the fine tuner
 *  simply doesn't go past it. */
export const TINT_MAX = 40
export const TINT_MIN = 1

/** The stored form: `#rrggbb@nn`. One short string, so a Space's existing
 *  `tint` field holds a whole tint with no second field and no id registry. */
export function tintToken(hex: string, opacity: number): string {
  const clean = normalizeHex(hex) ?? '#000000'
  const pct = Math.round(Math.min(TINT_MAX, Math.max(TINT_MIN, opacity)))
  return `${clean}@${pct}`
}

/** null for anything that isn't a tint — an empty field, a hand-edited
 *  settings.json, a token from a build that spelled it differently. Every
 *  caller treats null as "no tint", so a bad value is a plain page, never a
 *  crash and never a colour nobody chose. */
export function parseTint(token: unknown): Tint | null {
  if (typeof token !== 'string') return null
  const at = token.indexOf('@')
  if (at < 0) return null
  const hex = normalizeHex(token.slice(0, at))
  if (!hex) return null
  const pct = Number(token.slice(at + 1))
  if (!Number.isFinite(pct)) return null
  const opacity = Math.round(pct)
  if (opacity < TINT_MIN || opacity > TINT_MAX) return null
  return { hex, opacity }
}

/** **There are deliberately NO tints we ship.** Reuben, 2026-08-30: the
 *  research on which colours and strengths actually help — as against the
 *  popular-but-thin folklore about coloured overlays — has not been done yet,
 *  and shipping seven named swatches would be this app asserting an answer it
 *  does not have. Seven were built and then removed for exactly that reason.
 *
 *  So a tint has one source: **you make it**, from any hex colour at any
 *  strength, in Your collection → Explore → Tints. The wheel was always the
 *  real feature; ours were only starting points.
 *
 *  When the research lands, a named set goes back HERE, and the two places
 *  that would show it are the empty states in Collection.tsx and SpacePage.tsx
 *  — nothing else in the code assumes a tint has a name. */

/** The colour itself is the name. A tint has no name to show — it is a value,
 *  not a catalogue entry — and inventing one ("Custom 3") tells you less than
 *  the hex does. */
export function tintName(token: string): string {
  const t = parseTint(token)
  return t ? t.hex : 'Tint'
}

// --- the collection ---------------------------------------------------------

/** Per list, in settings.json. High enough never to be met by hand, low enough
 *  that a corrupted file can't hand the pickers ten thousand cards. */
export const COLLECTION_CAP = 60

/** Keep only ids this build actually knows how to draw, once each, never past
 *  the cap. Bundled looks are NOT stored — they're in the collection by
 *  definition — so the list holds exactly what was added. */
export function normalizePageLookLibrary(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : []
  const out: string[] = []
  for (const v of list) {
    if (typeof v !== 'string') continue
    const look = findPageLook(v)
    if (!look || look.source !== 'catalogue' || out.includes(v)) continue
    out.push(v)
    if (out.length >= COLLECTION_CAP) break
  }
  return out
}

/** Same rules for tints, except that validity is a parse rather than a lookup
 *  — the whole point of the token format is that there is no registry to check
 *  against. Re-emitted from the parse (`tintToken`) rather than kept as typed,
 *  so '#FBF0D9@16' and '#fbf0d9@16' can't sit in the collection as two cards
 *  of the same colour. Unlike page looks there is nothing to exclude: every
 *  tint is one you made (see above). */
export function normalizeTintLibrary(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : []
  const out: string[] = []
  for (const v of list) {
    const t = parseTint(v)
    if (!t) continue
    const token = tintToken(t.hex, t.opacity)
    if (out.includes(token)) continue
    out.push(token)
    if (out.length >= COLLECTION_CAP) break
  }
  return out
}
