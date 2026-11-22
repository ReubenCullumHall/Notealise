// Where the message at the bottom of the window ("Moved … to Cells. Undo") goes
// so it never sits on a note's corner buttons (CLAUDE.md, "Nothing covers a
// control"). It stays centred. In a narrow window or a split, a note's corner
// can be right behind it, so it rises just clear of whatever it would touch.

export interface Box {
  left: number
  right: number
  top: number
  bottom: number
}

/** How many px the message must rise to touch none of `controls`, never going
 *  higher than `ceiling` (the top of the space it may use). */
export function noticeLift(notice: Box, controls: Box[], gap = 8, ceiling = 8): number {
  const inColumn = controls.filter((c) => c.left < notice.right + gap && c.right > notice.left - gap)
  // Lowest first, so rising past one button then checks the one above it.
  const upward = [...inColumn].sort((a, b) => b.bottom - a.bottom)
  let lift = 0
  for (const c of upward) {
    const top = notice.top - lift
    const bottom = notice.bottom - lift
    if (c.top < bottom + gap && c.bottom > top - gap) lift = notice.bottom - c.top + gap
  }
  return Math.max(0, Math.min(lift, notice.top - ceiling))
}

/** A note's corner buttons: the eye, Markdown pro's switch, and the cassette
 *  with its card when open. */
export const CORNER_CONTROLS = '.edit-layer > button.btn-edge, .edit-layer > div.absolute.right-3'

/** Put the message where it touches none of them. Uses a margin because the
 *  message's own `bottom` and `transform` already place it. */
export function placeNotice(el: HTMLElement): void {
  el.style.marginBottom = ''
  const controls = [...document.querySelectorAll<HTMLElement>(CORNER_CONTROLS)]
    .map((c) => c.getBoundingClientRect())
    .filter((r) => r.width > 0 && r.height > 0)
  const lift = noticeLift(el.getBoundingClientRect(), controls)
  if (lift > 0) el.style.marginBottom = `${lift}px`
}
