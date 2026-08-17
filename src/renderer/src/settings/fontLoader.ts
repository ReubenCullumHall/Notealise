// Registers a downloaded or custom font with the browser so any CSS that
// names its family actually renders in it — bundled fonts never come through
// here, they're already static @font-face rules in theme.css (see
// shared/fonts.ts's file header for the three-source split).
//
// Uses the CSS Font Loading API (`FontFace` + `document.fonts.add`) instead
// of writing `<style>` tags: one JS call per font, no DOM element to track or
// clean up, and `document.fonts.ready` lets applySettings (settings/model.ts)
// know when it's safe to assume a family will actually paint rather than
// silently falling back for one frame.

import type { FontFallback, InstalledFont } from '../../../shared/fonts'

const loaded = new Set<string>()

/** id -> {family, fallback} for every installed font, custom ones included.
 *  `shared/fonts.ts`'s `findFont` only knows the static catalogue — a custom
 *  import has no entry there at all, so applyFont (settings/model.ts) needs
 *  somewhere else to resolve one from an id. Populated as fonts load, which
 *  is also why the space that reference a custom font sees its family/
 *  fallback resolve as soon as `ensureInstalledFontsLoaded` finishes, not
 *  before. */
const registry = new Map<string, { family: string; fallback: FontFallback }>()

export function findInstalledFont(id: string): { family: string; fallback: FontFallback } | undefined {
  return id ? registry.get(id) : undefined
}

/** Load one font into the document. Safe to call more than once for the same
 *  id — a second call is a no-op, which is what lets `downloadFont`/
 *  `importCustomFont` call this immediately after installing, without either
 *  them or the startup sweep below having to coordinate who goes first. */
export async function loadInstalledFont(font: InstalledFont): Promise<void> {
  if (loaded.has(font.id)) return
  try {
    const face = new FontFace(font.family, `url(data:font/woff2;base64,${font.base64})`)
    await face.load()
    document.fonts.add(face)
    loaded.add(font.id)
    registry.set(font.id, { family: font.family, fallback: font.fallback })
  } catch {
    // A corrupt cache entry or an unsupported file shouldn't break the rest
    // of startup — the font just stays unavailable, same as an unrecognised
    // id (shared/fonts.ts's findFont returns undefined and nothing paints
    // with it, rather than the app failing to open).
  }
}

let started: Promise<void> | null = null

/** Load every installed (downloaded + custom) font once, the first time
 *  anything asks — settings/model.ts's applySettings calls this
 *  fire-and-forget on every run, but the module-level `started` guard means
 *  only the very first call actually hits IPC. Deliberately not wired into
 *  App.tsx's own startup effects: this keeps the font system self-contained,
 *  with nothing outside settings/ needing to know it exists. */
export function ensureInstalledFontsLoaded(): Promise<void> {
  if (!started) {
    started = (async () => {
      if (typeof window === 'undefined' || !window.api) return
      const fonts = await window.api.listInstalledFonts()
      await Promise.all(fonts.map(loadInstalledFont))
    })()
  }
  return started
}
