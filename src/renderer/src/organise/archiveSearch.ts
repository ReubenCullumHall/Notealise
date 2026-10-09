// The archive's own search (Reuben, 2026-10-08: "its own search bar that works
// well"). Pure — no React, no IPC — so the matching and the ranking are tested
// on their own (archiveSearch.test.ts).
//
// What "works well" means here, because the archive is long-term storage: you
// are looking for something you put away weeks ago and half remember.
//  - Every word you type has to be found, in any order, anywhere in the note:
//    its name, the folders it sits in, where it was archived from, or its text.
//    "waves physics" finds "Waves" in a Physics folder.
//  - Capitals and accents don't matter: "cafe" finds "Café".
//  - The best matches come first — a word at the start of a name beats one in
//    the middle of it, a name beats a folder, a folder beats the text — then
//    the most recently archived.
//  - Each result says WHY it matched: the matched letters are marked in the name
//    and in a line of the note's text around the first match.
//
// It searches what a reader sees (`toPlainText`), not the raw file: a search for
// "rose" must not find every note with a `<mark class="hl-rose">` in it.

import { toPlainText } from '../../../shared/plainText'

/** One thing in the archive that a search can find. */
export interface ArchiveDoc {
  path: string
  type: 'file' | 'dir'
  /** the name as the sidebar shows it — no `.md` */
  title: string
  /** the folders between the archive and this entry, "Year 12 › Physics";
   *  '' when it sits at the top of the archive */
  where: string
  /** where it was archived from, "Revision › Physics", when that is known */
  from?: string
  /** the note's text as a reader sees it, once it has been read */
  text?: string
  archivedAt?: number
}

/** [start, end) of a marked stretch of text. */
export type Mark = [number, number]

export interface ArchiveHit {
  doc: ArchiveDoc
  score: number
  /** what to mark in the name */
  titleMarks: Mark[]
  /** a line of the note around the first match in its text — only when a word
   *  was found in the text and not in the name */
  snippet?: { text: string; marks: Mark[] }
}

/** A doc with its strings folded once, so a keystroke only searches. */
export interface PreparedDoc {
  doc: ArchiveDoc
  title: string
  place: string
  text: string
}

/**
 * Lower-case one string and drop its accents, KEEPING ITS LENGTH, so a match
 * found in the folded copy marks the same letters in the original. Character by
 * character, because folding a whole string at once can change its length
 * (a decomposed "é" is two characters and folds to one) and the marks would
 * then land a letter or two out.
 */
export function fold(s: string): string {
  let out = ''
  for (const ch of s) {
    // A character outside the basic plane is two UTF-16 units; it can't be a
    // letter with an accent, so it is kept as it is, both units.
    if (ch.length > 1) {
      out += ch
      continue
    }
    const base = ch.normalize('NFD').charAt(0).toLowerCase()
    out += base.length === 1 ? base : ch
  }
  return out
}

/** The words of a query, folded, each once, longest first so a short word
 *  inside a longer one doesn't take its marks. */
export function words(query: string): string[] {
  const seen = new Set<string>()
  for (const w of fold(query).split(/\s+/)) if (w) seen.add(w)
  return [...seen].sort((a, b) => b.length - a.length)
}

/** Fold everything a search looks at, once. */
export function prepare(doc: ArchiveDoc): PreparedDoc {
  return {
    doc,
    title: fold(doc.title),
    place: fold(`${doc.where} ${doc.from ?? ''}`),
    text: doc.text ? fold(doc.text) : ''
  }
}

const isWordChar = (c: string | undefined): boolean => !!c && /[\p{L}\p{N}]/u.test(c)

/** Does `w` start a word somewhere in `hay`? Returns that index, or -1. */
function wordStart(hay: string, w: string): number {
  for (let i = hay.indexOf(w); i !== -1; i = hay.indexOf(w, i + 1)) {
    if (!isWordChar(hay[i - 1])) return i
  }
  return -1
}

/** Every stretch of `text` matching one of `ws`, merged where they touch. */
export function marksIn(text: string, ws: string[]): Mark[] {
  const hay = fold(text)
  const raw: Mark[] = []
  for (const w of ws) {
    for (let i = hay.indexOf(w); i !== -1; i = hay.indexOf(w, i + w.length)) raw.push([i, i + w.length])
  }
  raw.sort((a, b) => a[0] - b[0])
  const out: Mark[] = []
  for (const m of raw) {
    const last = out[out.length - 1]
    if (last && m[0] <= last[1]) last[1] = Math.max(last[1], m[1])
    else out.push([m[0], m[1]])
  }
  return out
}

/** A line of `text` around the first of `ws`, cut on word breaks, with an
 *  ellipsis wherever it was cut. */
export function snippetAround(text: string, ws: string[], width = 96): { text: string; marks: Mark[] } | undefined {
  const flat = text.replace(/\s+/g, ' ').trim()
  const hay = fold(flat)
  let at = -1
  for (const w of ws) {
    const i = hay.indexOf(w)
    if (i !== -1 && (at === -1 || i < at)) at = i
  }
  if (at === -1) return undefined
  // Some context before the match — about a third of the line — then the rest
  // after it. Snapped to spaces so no word is cut in half.
  let start = Math.max(0, at - Math.floor(width / 3))
  if (start > 0) {
    const sp = flat.indexOf(' ', start)
    start = sp !== -1 && sp < at ? sp + 1 : start
  }
  let end = Math.min(flat.length, start + width)
  if (end < flat.length) {
    const sp = flat.lastIndexOf(' ', end)
    if (sp > at) end = sp
  }
  const body = flat.slice(start, end)
  const lead = start > 0 ? '…' : ''
  const out = lead + body + (end < flat.length ? '…' : '')
  return { text: out, marks: marksIn(out, ws) }
}

/**
 * Find and rank. Every word must be found somewhere in the doc; a doc missing
 * one is not a result. Score, per word: 6 at the start of a word in the name,
 * 3 anywhere else in the name, 2 in the folders or where it came from, 1 in
 * the text. Then bonuses for the whole query: +20 if it IS the name, +10 if the
 * name starts with it, +5 if the name contains it as typed.
 */
export function searchArchive(docs: PreparedDoc[], query: string): ArchiveHit[] {
  const ws = words(query)
  if (!ws.length) return []
  const phrase = fold(query.trim().replace(/\s+/g, ' '))
  const hits: ArchiveHit[] = []
  for (const d of docs) {
    let score = 0
    let inText = false
    let ok = true
    for (const w of ws) {
      if (wordStart(d.title, w) !== -1) score += 6
      else if (d.title.includes(w)) score += 3
      else if (d.place.includes(w)) score += 2
      else if (d.text.includes(w)) {
        score += 1
        inText = true
      } else {
        ok = false
        break
      }
    }
    if (!ok) continue
    if (d.title === phrase) score += 20
    else if (d.title.startsWith(phrase)) score += 10
    else if (phrase.includes(' ') && d.title.includes(phrase)) score += 5
    hits.push({
      doc: d.doc,
      score,
      titleMarks: marksIn(d.doc.title, ws),
      snippet: inText && d.doc.text ? snippetAround(d.doc.text, ws) : undefined
    })
  }
  return hits.sort(
    (a, b) =>
      b.score - a.score ||
      (b.doc.archivedAt ?? 0) - (a.doc.archivedAt ?? 0) ||
      a.doc.title.localeCompare(b.doc.title)
  )
}

/** The id a result row carries, so the search box can say which row the arrow
 *  keys are on (`aria-activedescendant`). */
export const archRowId = (path: string): string => 'arch-hit-' + encodeURIComponent(path)

/** The note text a search looks at: what a reader sees, as one string. */
export function searchableText(markdown: string): string {
  return toPlainText(markdown)
}
