import { EditorView } from '@codemirror/view'
import type { Extension } from '@codemirror/state'
import { ensureSyntaxTree } from '@codemirror/language'
import { baseName } from '../../../shared/links'
import { lineOfEmbed, resolveVaultPath } from '../../../shared/attachments'
import { clockOf, momentMarkdown, parseMoment } from './momentModel'
import { linkEnv, notifyUser } from './linkEnv'
import { copyText } from './copyBlockLink'
import { flashLines } from './blockFlash'
import { playerFor } from './voicePlayer'
import { voiceNotesIn } from './audioPass'

// A link to a moment in a voice note (Reuben, 2026-11-05: "yes" to "right-click
// the waveform → Copy link to 1:23; the link opens the note and plays from
// there"). It is an ordinary Markdown link to the recording, with the W3C media
// fragment for a time on the end:
//
//     [Explain it · 1:23](Explain%20it.m4a#t=83)
//
// so the note still reads anywhere (rule 4): another editor shows a link to the
// sound file, and a browser opening it starts at 1:23. Here, a click finds the
// voice note holding that recording — this note if it is in it, else another
// note — scrolls to it and plays from the time.

export { clockOf, isMomentHref } from './momentModel'

// --- copying ---------------------------------------------------------------------

/** The link last copied, and the note it was written for — so pasting it into a
 *  note in another folder re-points it (`momentPasteFilter`), the way a picture
 *  dragged between notes is re-pointed (attachMove.ts). */
let copied: { text: string; name: string; file: string; t: number } | null = null

/** Copy a link to `seconds` into the recording `file` (a voice note in `view`'s note). */
export function copyMomentLink(view: EditorView, name: string, file: string, seconds: number, lineFrom?: number): void {
  const notePath = view.state.field(linkEnv, false)?.path ?? ''
  if (!notePath) return
  const t = Math.max(0, Math.floor(seconds))
  const text = momentMarkdown(name, file, t, notePath)
  copied = { text, name, file, t }
  if (lineFrom !== undefined) flashLines(view, lineFrom, lineFrom)
  void copyText(text).then((ok) => {
    notifyUser(view.state, ok ? `Link to ${clockOf(t)} copied — paste it into any note` : "Couldn't copy the link")
  })
}

/** Pasting the link just copied into another note: written for THAT note, so it
 *  still reaches the recording from a different folder. Anything else pasted is
 *  left exactly as it came. */
export const momentPasteFilter: Extension = EditorView.clipboardInputFilter.of((text, state) => {
  if (!copied || text !== copied.text) return text
  const to = state.field(linkEnv, false)?.path ?? ''
  return to ? momentMarkdown(copied.name, copied.file, copied.t, to) : text
})

// --- following one -----------------------------------------------------------------

/** How long to wait for a recording to load before giving up on playing it. */
const LOAD_WAIT = 10_000

/** Scroll to the voice note holding `file` in this note and play it from `t`.
 *  False when the note has no voice note for that recording. */
export function playMomentHere(view: EditorView, file: string, t: number): boolean {
  const notePath = view.state.field(linkEnv, false)?.path ?? ''
  const n = lineOfEmbed(view.state.doc.toString(), notePath, file)
  if (!n) return false
  const line = view.state.doc.line(n)
  // A long note may not be read that far yet: read it, so the voice note's own
  // settings (speed, volume) are found. The scroll's transaction brings the
  // newly read part into the state.
  ensureSyntaxTree(view.state, line.to, 500)
  view.dispatch({ effects: EditorView.scrollIntoView(line.from, { y: 'center' }) })
  flashLines(view, line.from, line.from)
  const span = voiceNotesIn(view.state, line.from, line.to).find((s) => resolveVaultPath(s.src, notePath) === file)
  const settings = span?.settings
  const p = playerFor(file)
  const go = (): void => {
    p.seek(t)
    void p.play(settings)
  }
  if (p.state === 'ready') go()
  else {
    // Still loading (a note just opened): play once it can. A recording that
    // turns out to be missing or unplayable says so on its own block.
    let done = false
    const stop = p.subscribe(() => {
      if (done || p.state === 'loading') return
      done = true
      stop()
      if (p.state === 'ready') go()
    })
    setTimeout(() => {
      if (!done) {
        done = true
        stop()
      }
    }, LOAD_WAIT)
  }
  return true
}

/** What a click on a moment link does when the recording isn't in this note:
 *  App finds a note that holds it (LinkHandlers.moment). Without App behind the
 *  editor (onboarding, the tests) it just says so. */
export function followMoment(
  view: EditorView,
  href: string,
  elsewhere: ((file: string, t: number) => void) | undefined
): boolean {
  const notePath = view.state.field(linkEnv, false)?.path ?? ''
  const m = parseMoment(href, notePath)
  if (!m) return false
  if (playMomentHere(view, m.file, m.t)) return true
  if (elsewhere) elsewhere(m.file, m.t)
  else notifyUser(view.state, `${baseName(m.file)} isn't in this note`)
  return true
}
