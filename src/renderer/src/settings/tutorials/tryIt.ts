import { createContext, useContext } from 'react'
import type { GuideId } from './guides'

// "Try it" — the button on a tutorial card that opens a practice note with that
// card's example already in it, so you do the thing in the real editor instead
// of reading about it (Reuben, 2026-10-07: "for all ones"; the rule is in
// docs/tutorials.md).
//
// A card passes `tryIt={practiceText(...)}`; the button calls whatever App gave
// Settings, and Settings closes itself so the note is there to type in. Held as
// context so a guide never has to know how a note gets opened. Settings also keeps
// where you were (`TutorialSpot`), so the next time it opens it comes back to it.

/** What Try it does with a card's starting text. `null`: the app didn't offer it,
 *  so a card shows no button. */
export const TryItContext = createContext<((text: string) => void) | null>(null)

export const useTryIt = (): ((text: string) => void) | null => useContext(TryItContext)

/** Where in the tutorials Try it was pressed: the guide, and how far down its page
 *  was scrolled. `SettingsButton` keeps it for exactly ONE opening — the next —
 *  which comes back to the guide, and the opening after that is the ordinary one
 *  again (Reuben, 2026-10-07: "only when you trigger it with Try it … on reopen a
 *  second time it shouldn't reopen to any page"). Closing Settings any other way
 *  keeps nothing. */
export interface TutorialSpot {
  guide: GuideId
  scrollTop: number
}

/** The note's name, and the opening line App checks before it ever overwrites one: a
 *  note of yours that merely has this name does not start with it, and is left alone.
 *  It is a sentence, not a `# heading`, because the app already shows a note's name
 *  above the page — a heading with the same words showed the name twice. */
export const PRACTICE_TITLE = 'Tutorial practice'
export const PRACTICE_HEAD = 'This note starts afresh each time you press **Try it** in a tutorial.'

/**
 * The practice note's whole text for one card: a line saying the note starts
 * afresh each time, what to do, then `start` (a sentence to select, a table to
 * poke at, a toggle to shut) — or nothing, leaving an empty line to type on.
 * The cursor is put at the end. `stay` ends the note ON `start`'s last line
 * instead of on a fresh one below it, for a card that carries on a sentence.
 */
export function practiceText(card: string, ask: string, start = '', stay = false): string {
  const lines = [
    `${PRACTICE_HEAD} Write anything here.`,
    '',
    '---',
    '',
    `**Try it — ${card}.** ${ask}`,
    ''
  ]
  if (start) lines.push(start)
  if (start && !stay) lines.push('')
  return lines.join('\n')
}
