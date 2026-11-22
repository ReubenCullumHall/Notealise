// "Edit in Excel": the real app, lined up beside Notealise (docs/plans/file-tabs.md).
// The arithmetic and the words, with no Electron in them, so main can use them and a
// test can pin them.

export interface Box {
  x: number
  y: number
  width: number
  height: number
}

/** Notealise's own smallest width (main/index.ts `minWidth`). */
export const OUR_MIN_WIDTH = 640
/** Narrower than this and the other app isn't worth lining up. */
export const THEIR_MIN_WIDTH = 480

/** Notealise on the left, the other app on the right, half each. Null when the
 *  screen can't hold both at a usable size. */
export function splitScreen(work: Box): { ours: Box; theirs: Box } | null {
  if (work.width < OUR_MIN_WIDTH + THEIR_MIN_WIDTH) return null
  const oursWidth = Math.max(OUR_MIN_WIDTH, Math.floor(work.width / 2))
  return {
    ours: { x: work.x, y: work.y, width: oursWidth, height: work.height },
    theirs: { x: work.x + oursWidth, y: work.y, width: work.width - oursWidth, height: work.height }
  }
}

/** Notealise's box once the other app has settled. An app can refuse the width it
 *  was asked for, so Notealise fills what is left, never going under its minimum. */
export function oursBeside(work: Box, theirs: Box): Box {
  const left = Math.min(theirs.x, work.x + work.width) - work.x
  return { x: work.x, y: work.y, width: Math.max(OUR_MIN_WIDTH, left), height: work.height }
}

/** "Microsoft Excel.app" → "Excel": what fits on the button. */
export function shortAppName(name: string): string {
  return name.replace(/\.app$/i, '').replace(/^Microsoft\s+/i, '').trim()
}

/** How "Edit in …" went.
 *  'permission' — the Mac needs the person's yes first (its box is up);
 *  'no-app' — nothing on this computer opens this kind of file;
 *  'narrow' — opened, but the screen is too small to line the two up;
 *  'not-placed' — opened, but its window couldn't be moved;
 *  'failed' — not opened. */
export type EditBeside =
  | { ok: true; app: string }
  | { ok: false; why: 'permission' | 'no-app' | 'narrow' | 'not-placed' | 'failed'; app?: string }
