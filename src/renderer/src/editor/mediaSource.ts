import { Facet, type Extension } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { notifyUser } from './linkEnv'

// The eye, beside a note: show the code that puts each photo and video there.
//
// Distinct from raw view (rawView.ts), and deliberately so. Raw view is the
// Markdown pro's switch — it reveals every syntax mark in the whole note, so
// `#`, `**` and `|` all come back and the note stops reading as prose. This
// shows ONE thing: the exact source line behind each picture and player, printed
// under it, with everything else left formatted. It is for the question "what
// file is this actually pointing at, and what did the app write to put it here"
// — which is the question that comes up when a photo won't load, when a note has
// been moved, or when a file has been renamed underneath it.
//
// A Facet for exactly the reasons rawView is one: nothing inside the editor ever
// changes it, React pushes it in by reconfiguring a Compartment, and the
// decoration builders read it. Same mechanism, same shape, so the two toggles
// can't drift into behaving differently.
export const mediaSource = Facet.define<boolean, boolean>({
  // `some`, matching rawView: unset means off, and the single place that sets
  // it wins.
  combine: (values) => values.some(Boolean)
})

/** Read it wherever a media widget is built. Same permissive parameter shape as
 *  `isRaw`, so a ViewUpdate's state, an EditorState and a view's state all fit. */
export const isMediaSource = (state: { facet: (f: typeof mediaSource) => boolean }): boolean =>
  state.facet(mediaSource)

export const mediaSourceOf = (on: boolean): Extension => mediaSource.of(on)

/** The source line, as a caption under the picture it belongs to.
 *
 *  Built here rather than in each pass so the image and video versions cannot
 *  drift — they show the same thing in the same place, and only the text
 *  differs. Not selectable-looking and not editable: it is a read-out of the
 *  document, and the document itself is right there to edit. */
export function sourceCaption(text: string, view: EditorView): HTMLElement {
  const el = document.createElement('span')
  el.className = 'cm-attach-source'
  el.setAttribute('aria-hidden', 'true')
  // Sighted discoverability only — the caption looks like a read-out, so nothing
  // says it does anything until you try it. `data-tip`, never `title` (see
  // CLAUDE.md: the OS tooltip goes stale and can't be styled).
  el.setAttribute('data-tip', 'Click to copy this link')
  el.textContent = text

  // Copying this line was the whole point of showing it, and it was the one
  // thing you could not do. A mousedown anywhere inside the widget — caption
  // included — reached `imageClick`, which put the cursor on the embed: the
  // selection collapsed the instant you finished dragging, the picture took its
  // ring, and the view jumped back to the cursor.
  //
  // `stopPropagation` on mousedown is what keeps that handler (and CodeMirror's
  // own position mapping) out of a gesture that is about the caption, not the
  // document.
  el.addEventListener('mousedown', (e) => e.stopPropagation())

  // A plain click takes the whole line, since that is what anyone clicking a
  // one-line path wants. A DRAG is left alone: if the user has already made a
  // selection of their own inside this caption, replacing it with everything
  // would be the tool overriding an explicit choice.
  el.addEventListener('click', (e) => {
    e.stopPropagation()
    const sel = window.getSelection()
    if (!sel) return
    const own =
      !sel.isCollapsed &&
      sel.rangeCount > 0 &&
      el.contains(sel.getRangeAt(0).commonAncestorContainer)
    if (own) return
    // After the current task, not during it. CodeMirror re-asserts the DOM
    // selection from its own editor state while handling the click, so a range
    // set synchronously is wiped a moment later and the line only flashes.
    // Measured, not guessed: synchronously AND on the next animation frame both
    // came back as the empty string, while the same range set from a later task
    // survived. A timeout runs after CodeMirror's sync; a frame does not.
    setTimeout(() => {
      const now = window.getSelection()
      if (!now) return
      const range = document.createRange()
      range.selectNodeContents(el)
      now.removeAllRanges()
      now.addRange(range)
      // Selecting the line was only ever half of what anyone clicking a path
      // wants. The selection stays regardless of whether the copy lands: it is
      // what shows you WHICH text was taken, and it leaves Cmd+C as the manual
      // route if the clipboard refuses.
      void copyToClipboard(text).then((ok) => {
        notifyUser(
          view.state,
          ok ? 'Link copied — now ready to create shared media' : 'Could not copy the link'
        )
      })
    }, 0)
  })
  return el
}

/** Put one line on the clipboard, from a renderer that is not always allowed the
 *  modern API.
 *
 *  `navigator.clipboard` exists only in a **secure context**, and a PACKAGED
 *  build loads the renderer off the disk with `loadFile` (`main/index.ts`), i.e.
 *  from `file://` — which Chromium does not count as one. Dev runs from
 *  `http://localhost` and does. So relying on it alone gives a copy that works
 *  every single time it is tested and never once for a real user, which is the
 *  worst shape a bug can have.
 *
 *  `execCommand('copy')` carries no such gate, and it copies the current DOM
 *  selection — which the caller has just set to this caption. Deprecated, and
 *  kept second for that reason, but it is the branch that actually runs in the
 *  shipped app. Both need transient user activation, which a `setTimeout(…, 0)`
 *  out of a real click still has (Chromium allows five seconds). */
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // denied or unavailable — fall through to the selection-based copy
  }
  try {
    return document.execCommand('copy')
  } catch {
    return false
  }
}
