import { resolveVaultPath } from '../../../shared/attachments'
import type { LinkRow } from '../../../shared/links'

// Which notes hold which photos.
//
// Built from the same scan that produces the backlink index (`LinkRow.embeds`),
// so it costs one extra field rather than a second pass over the vault, and it
// is live: `liveIndex` overlays the open buffers, so a picture dragged in two
// seconds ago is already in here.
//
// This exists because the app previously did not know that a photo belonged to
// a note. It knew what one note's text said at the moment something was deleted
// — a breadcrumb on the bin row — and nothing more. So a photo shared by two
// notes could be deleted from one and silently break the other, and losing the
// breadcrumb lost the connection entirely.

/** vault path of a photo/video → every note that embeds it, in scan order.
 *
 *  Targets that resolve to nothing (a remote URL, a path climbing out of the
 *  vault) are dropped: there is no file for them to be a use OF. A note that
 *  embeds the same file twice counts once — the question this answers is
 *  "would deleting this file break that note", and twice is no more broken. */
export function mediaUsage(rows: LinkRow[]): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const row of rows) {
    for (const target of row.embeds ?? []) {
      const file = resolveVaultPath(target, row.path)
      if (!file) continue
      const users = out.get(file)
      if (!users) out.set(file, [row.path])
      else if (!users.includes(row.path)) users.push(row.path)
    }
  }
  return out
}

/** Every note OTHER than `note` that also holds `file`.
 *
 *  The exclusion is the point: this is asked when a photo has just been taken
 *  out of `note`, and the index has not necessarily caught up with that removal
 *  yet. Excluding the note being deleted from makes the answer right either
 *  way, which a plain count would not be. */
export function otherNotesUsing(
  usage: Map<string, string[]>,
  file: string | null,
  note: string | undefined
): string[] {
  if (!file) return []
  return (usage.get(file) ?? []).filter((p) => p !== note)
}
