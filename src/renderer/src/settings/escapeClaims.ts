// A ref-counted claim any Settings-nested overlay (a Select dropdown, the
// emoji picker, a confirm dialog) pushes while it's open, so its own Escape
// handler gets first say over the Settings window's own close-on-Escape.
//
// Needed because every one of these binds its own Escape handler to `window`
// in the capture phase — and so does Settings' close handler. Same (target,
// phase) pair, so per spec they fire in REGISTRATION order, not DOM-nesting
// order (see CLAUDE.md's Gotchas). Settings' handler registers the moment
// Settings opens, before any popover inside it exists, so without this it
// always ran FIRST and had already closed the whole window before a nested
// popover's own handler got a chance to stop it — confirmed 2026-08-29 on the
// shipped EmojiPicker, and on SpaceDeleteConfirm when opened from the Spaces
// tab strip.

let claims = 0

/** Call when a nested overlay opens; call the returned function when it
 *  closes (or unmounts while still open). Pair it with the overlay's own
 *  Escape-listener effect so the two always move together — claimed exactly
 *  as long as the overlay would itself act on Escape. */
export function claimEscape(): () => void {
  claims++
  let released = false
  return () => {
    if (released) return
    released = true
    claims = Math.max(0, claims - 1)
  }
}

/** True while at least one nested overlay wants first claim on Escape. An
 *  ancestor's own close-on-Escape handler should check this and do nothing
 *  when it's true — the nested overlay's own handler runs too (it always
 *  registered after this check) and closes itself instead. */
export function escapeClaimed(): boolean {
  return claims > 0
}
