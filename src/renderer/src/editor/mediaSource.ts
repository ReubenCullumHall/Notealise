import { Facet, type Extension } from '@codemirror/state'

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
export function sourceCaption(text: string): HTMLElement {
  const el = document.createElement('span')
  el.className = 'cm-attach-source'
  el.setAttribute('aria-hidden', 'true')
  el.textContent = text
  return el
}
