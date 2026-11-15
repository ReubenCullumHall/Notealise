// What the window says when a folder can't be read (no permission, or something
// else has hold of it). Wording approved by Reuben, 2026-11-13 — change it only
// with him. Main marks such a folder `unreadable` (readDir, vault.ts); when the
// notes folder itself can't be read, the tree never arrives at all (App.tsx).

/** Where the folder's notes would be: inside the opened folder in the sidebar,
 *  or in place of "No notes yet." for a space whose own folder can't be read. */
export const UNREADABLE_FOLDER = "Couldn't open this folder"

/** The hover label on that line (a `data-tip`, never `title`). */
export const UNREADABLE_FOLDER_TIP = "Its notes are still on your computer — the app isn't allowed to read them."

/** The "Choose folder…" screen, when the notes folder itself can't be read —
 *  at launch, or straight after picking one. */
export const UNREADABLE_VAULT =
  "Couldn't open your notes folder — this computer isn't letting the app read it. Choose it again, or pick another."
