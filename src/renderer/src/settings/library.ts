import type { AppSettings, Space } from '../../../shared/settings'

// The two writes that "take this out of my collection" has to make, in one
// place because they are made from two pages (Collection.tsx's shelves and
// Explore.tsx's catalogue) and getting only half of it right is invisible
// until much later.
//
// **Removing a look or a tint also takes it OFF every space wearing it.** A
// space left pointing at something its own picker no longer lists is a control
// that appears to do nothing — the worst bug this settings window can have
// (Customisation.tsx has the long version of why). The alternative, refusing
// to remove something in use, trades that for a dead button and a hunt for
// which space is holding it.

export function withoutPageLook(settings: AppSettings, id: string): Partial<AppSettings> {
  return {
    pageLookLibrary: settings.pageLookLibrary.filter((x) => x !== id),
    spaces: settings.spaces.map((s) => (s.pageLook === id ? { ...s, pageLook: '' } : s))
  }
}

export function withoutTint(settings: AppSettings, token: string): Partial<AppSettings> {
  return {
    tintLibrary: settings.tintLibrary.filter((x) => x !== token),
    spaces: settings.spaces.map((s) => (s.tint === token ? { ...s, tint: '' } : s))
  }
}

/** How many spaces are currently wearing it — for the "this will also…" tip on
 *  the Remove button, so the consequence is stated before it happens rather
 *  than discovered afterwards. */
export function spacesWearing(settings: AppSettings, key: 'pageLook' | 'tint', value: string): number {
  return settings.spaces.filter((s) => s[key] === value).length
}

/** A font is the third collectable, and removing one has the same obligation
 *  — with one extra wrinkle: a font is THREE independent fields on a space
 *  (interface, notes, easier-reading), so all three have to be checked.
 *
 *  Unlike a look or a tint, an uncleared font field is not merely confusing:
 *  the bytes are gone from disk, so the space renders in the fallback face
 *  while its picker shows nothing selected and offers no way to say what
 *  happened. */
export function withoutFont(settings: AppSettings, id: string): Partial<AppSettings> {
  const clear = (s: Space): Space => ({
    ...s,
    font: s.font === id ? '' : s.font,
    uiFont: s.uiFont === id ? '' : s.uiFont,
    dyslexiaFont: s.dyslexiaFont === id ? '' : s.dyslexiaFont
  })
  return { spaces: settings.spaces.map(clear) }
}

/** Spaces using this font in any of its three roles. Counted once per space,
 *  not once per role — the warning is about spaces, not fields. */
export function spacesWearingFont(settings: AppSettings, id: string): number {
  return settings.spaces.filter((s) => s.font === id || s.uiFont === id || s.dyslexiaFont === id).length
}
