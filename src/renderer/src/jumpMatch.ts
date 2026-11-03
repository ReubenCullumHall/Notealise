// Go to a note (Cmd/Ctrl+P): the matching behind the pop-up. Pure, so it is
// tested on its own (jumpMatch.test.ts).
//
// It is the archive search's matcher (organise/archiveSearch.ts) pointed at note
// NAMES and the folders they sit in — and, with the sidebar Search's "titles /
// contents" toggle on, at what the notes say. So the rules are the ones the
// archive already has: every word you type has to be found, in any order,
// capitals and accents don't matter, a word at the start of a name beats one in
// the middle of it, and a name beats the text.

import { prepare, searchArchive, type Mark, type PreparedDoc } from './organise/archiveSearch'

/** One note the pop-up can jump to. */
export interface JumpNote {
  path: string
  /** the name as the sidebar shows it — no `.md` */
  title: string
  /** the folders it sits in below its space, "Physics › Waves"; '' at the top */
  where: string
  /** the top-level folder (space) it lives in; '' for a note loose at the root */
  spaceFolder: string
  /** true for a note in the space you are in */
  here: boolean
  /** the note's text as a reader sees it, once it has been read (contents search) */
  text?: string
  /** the space's name and emoji — set only when it is NOT the space you are in */
  spaceTag?: string
  spaceEmoji?: string
}

export interface JumpHit {
  note: JumpNote
  titleMarks: Mark[]
  /** a line of the note around the first match in its text — only when the words
   *  were found in the text and not in the name */
  snippet?: { text: string; marks: Mark[] }
}

/** Fold every note's name once, when the pop-up opens — a keystroke then only searches. */
export interface JumpIndex {
  /** names + folders only */
  titleDocs: PreparedDoc[]
  /** names + folders + text, for the contents search */
  docs: PreparedDoc[]
  byPath: Map<string, JumpNote>
}

export function indexNotes(notes: JumpNote[]): JumpIndex {
  const doc = (n: JumpNote, withText: boolean): PreparedDoc =>
    prepare({ path: n.path, type: 'file', title: n.title, where: n.where, text: withText ? n.text : undefined })
  return {
    titleDocs: notes.map((n) => doc(n, false)),
    docs: notes.map((n) => doc(n, true)),
    byPath: new Map(notes.map((n) => [n.path, n]))
  }
}

/** How many results the pop-up lists. A vault of thousands would otherwise draw
 *  thousands of rows on every keystroke, and nobody scrolls past the first few. */
export const JUMP_LIMIT = 50

/** The notes matching `query`, best first. `deep` also looks at what the notes
 *  say (the ones whose text has been read). Among equally good matches the ones
 *  in the space you are in come before the others. Nothing for an empty query. */
export function findNotes(index: JumpIndex, query: string, deep = false): JumpHit[] {
  const hits = searchArchive(deep ? index.docs : index.titleDocs, query)
  const out = hits.map((h) => ({
    note: index.byPath.get(h.doc.path)!,
    score: h.score,
    titleMarks: h.titleMarks,
    snippet: h.snippet
  }))
  // A stable sort, so a tie in both keeps the matcher's own order (by name).
  out.sort((a, b) => b.score - a.score || Number(b.note.here) - Number(a.note.here))
  return out.slice(0, JUMP_LIMIT).map(({ note, titleMarks, snippet }) => ({ note, titleMarks, snippet }))
}
