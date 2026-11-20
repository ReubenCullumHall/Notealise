/** How long a drag has to sit over something before it opens — a space button,
 *  a closed folder in the sidebar, a tab (with a file from outside). The same
 *  "hold over a folder to open it" gesture an OS file manager uses: long enough
 *  that passing over one on the way somewhere else doesn't open it by accident,
 *  short enough not to feel unresponsive. One number, so the three feel alike
 *  (Reuben, 2026-11-19). */
export const HOLD_TO_OPEN_MS = 600

/** What a drag of several sidebar rows says beside the pointer: "3 notes",
 *  "2 folders", or "3 items" for a mix. `null` for one row — the row itself is
 *  the picture then. */
export function carryLabel(paths: string[]): string | null {
  if (paths.length < 2) return null
  const notes = paths.filter((p) => /\.md$/i.test(p)).length
  if (notes === paths.length) return `${paths.length} notes`
  if (notes === 0) return `${paths.length} folders`
  return `${paths.length} items`
}
