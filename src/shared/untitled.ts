// "Untitled 17": one count for everything made without a name — notes, folders and voice
// notes — across the whole notes folder (Reuben, 2026-11-07: "make sure it adds to that tally
// so that there are never any ones that are double searchable"). The number is part of the
// NAME, written into the file name or onto the voice note's line, so naming Untitled 17 never
// moves Untitled 18 down to fill the gap ("don't have it so that … untitled 17 is filled in by
// the previous untitled 18"). Gaps are fine; a number is never given out twice.
//
// Notes made before this (plain "Untitled", "Untitled (2)") are left as they are (Reuben,
// 2026-11-07) and don't count — only "Untitled <number>" does.
//
// Pure helpers; main keeps the count (vault.ts `takeUntitled`).

export const UNTITLED = 'Untitled'

/** The most numbers one ask may take: a note with more unnamed voice notes than this
 *  gets the rest on the next pass. */
export const UNTITLED_TAKE_MAX = 200

export function untitledName(n: number): string {
  return `${UNTITLED} ${n}`
}

/** 17 for "Untitled 17" (any case, a note's ".md" allowed), otherwise null. */
export function untitledNumber(name: string): number | null {
  const m = /^untitled (\d{1,9})(?:\.md)?$/i.exec(name.trim())
  if (!m) return null
  const n = Number(m[1])
  return n > 0 ? n : null
}

/** The numbers of the voice notes named "Untitled N" in a note's text — the tag form's
 *  `data-name="Untitled 3"` and the markdown form's `![Untitled 3](memo.m4a)`. */
export function voiceUntitledNumbers(text: string): number[] {
  const out: number[] = []
  const re = /data-name\s*=\s*(?:"untitled (\d{1,9})"|'untitled (\d{1,9})')|!\[untitled (\d{1,9})\]\(/gi
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const n = Number(m[1] ?? m[2] ?? m[3])
    if (n > 0) out.push(n)
  }
  return out
}
