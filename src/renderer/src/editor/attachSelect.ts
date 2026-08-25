import type { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { linkEnv, linkHandlersFacet, notifyUser } from './linkEnv'
import { resolveVaultPath } from './imageAssets'
import { kindForFilename } from '../../../shared/attachments'
import { ANCHOR } from '../../../shared/workspace'

// Selecting a photo/video embed and deleting it as one thing.
//
// Clicking the grip (attachMove's 3x2 dots) selects the WHOLE embed rather than
// placing a cursor, and Backspace/Delete then removes it in one go and asks for
// confirmation afterwards — delete first, confirm second, so what you are being
// asked about is a change you can already see. Cancel puts it back exactly.
//
// The TEXT going is all that happens here. Confirming also bins the file, but
// that is App's half (see `MediaDelete`) — this module's job is to work out
// which file, which only it can do, since an embed's target is written relative
// to the note holding it.
//
// The "selected" state is the ordinary document selection, deliberately, rather
// than a StateField of its own: livePreview already recomputes on `selectionSet`
// (so the ring appears with no new trigger), CodeMirror already draws and
// maintains it, and a click elsewhere already clears it. The single thing that
// has to be taught is that a selection covering an embed EXACTLY means "this is
// selected" and not the reveal-to-edit overlap the passes otherwise obey.

/** An embed alone in its source text. Both forms are what `attachInput` writes:
 *  an image is markdown, a video is HTML (Markdown has no video syntax — see
 *  rule 4). Anchored, because these are matched against a candidate slice, not
 *  searched for inside one. */
const IMAGE_RE = /^!\[[^\]\n]*\]\([^)\n]*\)$/
const VIDEO_RE = /^<video\b[^>\n]*>\s*<\/video>$/i

function isEmbed(text: string): boolean {
  return IMAGE_RE.test(text) || VIDEO_RE.test(text)
}

/** True when the document selection is exactly one embed and nothing else —
 *  i.e. the grip selected it.
 *
 *  Exported because a selected PHOTO is not selected TEXT, and anything that
 *  reacts to "the user has selected something" has to be able to tell the two
 *  apart. The format bar was the first to need it: selecting a picture popped up
 *  the highlight and text-colour swatches, offering to paint a JPEG pink. */
export function selectionIsEmbed(state: EditorState): boolean {
  const r = state.selection.main
  return !r.empty && isEmbed(state.doc.sliceString(r.from, r.to))
}

/** Every embed on the line containing `pos`, as document ranges. Found by
 *  scanning the line's text rather than the syntax tree on purpose: the video
 *  form is raw HTML and has no markdown node to find, so one scan covers both. */
function embedsOnLine(state: EditorState, pos: number): { from: number; to: number }[] {
  const line = state.doc.lineAt(Math.min(Math.max(pos, 0), state.doc.length))
  const out: { from: number; to: number }[] = []
  const scan = /!\[[^\]\n]*\]\([^)\n]*\)|<video\b[^>\n]*>\s*<\/video>/gi
  for (let m = scan.exec(line.text); m; m = scan.exec(line.text)) {
    out.push({ from: line.from + m.index, to: line.from + m.index + m[0].length })
  }
  return out
}

/** The embed at `pos`, if any — what the grip uses to select itself. `pos` comes
 *  from `posAtDOM` on the grip button, so it lands at or inside the embed's own
 *  replaced range. */
export function embedSpanAt(state: EditorState, pos: number): { from: number; to: number } | null {
  return embedsOnLine(state, pos).find((s) => pos >= s.from && pos <= s.to) ?? null
}

/** True when the document selection covers `from`–`to` exactly.
 *
 *  The passes consult this BEFORE their usual `overlapsSelection` check: an
 *  exact cover is "selected, keep showing the picture and ring it", whereas any
 *  other overlap stays reveal-to-edit. Without the distinction, selecting an
 *  embed would flip it to raw markdown, which is the opposite of showing the
 *  user what they are about to delete. */
export function selectionCovers(view: EditorView, from: number, to: number): boolean {
  const r = view.state.selection.main
  return !r.empty && r.from === from && r.to === to
}

/** Whether the selection swallows this embed WHOLE — the exact-cover case above
 *  plus every selection that runs across it and out the other side.
 *
 *  This is the difference between "the user is editing this embed's source" and
 *  "the user has dragged a selection over it on the way past", and getting it
 *  wrong is not cosmetic. Until 2026-08-24 only an EXACT cover kept the picture
 *  on screen, so selecting a photo plus one word of text tore the picture out
 *  and put its raw markdown back — **collapsing a 420px line to 27px while the
 *  pointer was still moving.** Everything below jumped up by the difference, the
 *  drag carried on against content that was no longer under the cursor, and the
 *  selection you ended up with was not the one you drew. It arrived looking like
 *  a selection that had come apart into steps, which is exactly what it was.
 *
 *  Reveal-to-edit is still right for a selection that lands genuinely INSIDE the
 *  markdown (dragging across part of the URL) — that one really is asking to
 *  work with the text, and it moves nothing, because the picture was already
 *  raw for the cursor that started it. */
export function selectionSwallows(view: EditorView, from: number, to: number): boolean {
  const r = view.state.selection.main
  return !r.empty && r.from <= from && r.to >= to
}

/** Whether the selection is genuinely INSIDE this embed, rather than merely
 *  touching its edge.
 *
 *  This replaces `overlapsSelection` for the two media passes. That test is
 *  inclusive at both ends, which is exactly right for `*italic*` — a cursor
 *  sitting on the star should show you the star — and exactly wrong for a
 *  replaced photo. An empty cursor AT the start or end of an embed is beside
 *  it, not in it.
 *
 *  The bug that forced this: drag three photos in at once and they sit on
 *  consecutive lines. Delete one and the caret has to land somewhere — and
 *  under the inclusive rule every available spot (end of the line above, start
 *  of the line below) counted as "inside" a surviving neighbour, so deleting
 *  one photo flipped the one next to it into raw `<video …>` source. There was
 *  no caret position that didn't.
 *
 *  A NON-empty selection touching the edge still counts: dragging a selection
 *  across an embed is asking to work with the text. Only a bare cursor is
 *  treated as adjacent. */
export function insideEmbed(view: EditorView, from: number, to: number): boolean {
  for (const r of view.state.selection.ranges) {
    if (r.empty ? r.from > from && r.from < to : r.from < to && r.to > from) return true
  }
  return false
}

/** Tell CodeMirror to re-measure once an embed's real size is known.
 *
 *  A picture or a video enters the DOM with no dimensions and grows its line
 *  when the bytes land. **CodeMirror caches line geometry in a height map and
 *  has no way to notice that happening** — the map still describes the
 *  collapsed line, so everything computed against it is drawn against a layout
 *  that no longer exists. The most visible casualty is `drawSelection`: its
 *  rectangles tile perfectly against each OTHER while sitting tens or hundreds
 *  of pixels away from the text they claim to cover, which reads as a selection
 *  that has come apart into steps. (Reported 2026-08-24 as "why is this
 *  selection like it is". Measured with a 300px image: the line box correctly
 *  grew to 308px, and the selection still covered 265px of a 366px range.)
 *
 *  This is NOT only a selection bug — the same stale map is what
 *  `posAtCoords`, `coordsAtPos` and scroll-into-view all read, so a click
 *  under a picture lands on the wrong line for the same reason. Selection is
 *  just where it is visible.
 *
 *  `requestMeasure` is the supported way to say "my DOM changed size": it folds
 *  into CodeMirror's own measure cycle instead of forcing a synchronous reflow
 *  per image, which matters when a note opens with a dozen of them. */
export function remeasureWhenSized(view: EditorView, el: HTMLElement, events: string[]): void {
  const measure = (): void => view.requestMeasure()
  // `once` — a still image fires `load` exactly once, and leaving the listener
  // attached would keep a view reference alive after the widget is torn down.
  for (const name of events) el.addEventListener(name, measure, { once: true })
  // An image whose bytes are ALREADY in the browser's cache is `complete`
  // before this line runs, and `load` has therefore been and gone — the
  // listener above would wait forever. Costs one redundant measure in the rare
  // case the size is genuinely known at zero height; `requestMeasure` coalesces
  // that away. Found the hard way: the first version of this fix changed
  // nothing at all when tested against a `data:` URI, because that is exactly
  // the already-complete case.
  if (el instanceof HTMLImageElement && el.complete) measure()
}

/** Marks the whole editor while the selection is exactly one embed, so the CSS
 *  can stop painting a selection over it.
 *
 *  It has to live on the EDITOR, not on the widget: `drawSelection()` renders
 *  into `.cm-selectionLayer`, a SIBLING of `.cm-content`, so nothing scoped to
 *  the picture can reach the rectangle drawn across it. The original attempt
 *  styled `.cm-attach-selected ::selection`, which is the native browser
 *  selection — a different mechanism entirely, and inert while `drawSelection`
 *  is on. The rule looked right and never once applied.
 *
 *  Recomputed on `selection` alone: the doc can change under a selection
 *  without changing whether it covers an embed, and this runs on every
 *  keystroke otherwise. */
export const embedSelectionAttr = EditorView.editorAttributes.compute(
  ['selection'],
  // Annotated because CodeMirror's `Attrs` is `{[name: string]: string}`, and
  // the empty branch infers `{ class?: undefined }`, which does not satisfy it.
  (state): Record<string, string> => (selectionIsEmbed(state) ? { class: 'cm-embed-picked' } : {})
)

/** Select an embed as one object. Focuses, because the Backspace binding below
 *  only ever fires while the editor has focus and the grip is a button. */
export function selectEmbed(view: EditorView, span: { from: number; to: number }): void {
  view.dispatch({ selection: { anchor: span.from, head: span.to }, scrollIntoView: false })
  view.focus()
}

/** What Backspace/Delete actually cuts, and where the cursor goes afterwards.
 *
 *  An embed sitting alone on its line takes the line and its newline with it —
 *  leaving a blank line behind is the same defect `attachMove` had. An embed
 *  written inline in a sentence takes only itself: quietly deleting somebody's
 *  paragraph because they clicked a grip is not a thing this should ever do.
 *
 *  `caret` is the LINE ABOVE, not the start of whatever has moved up into the
 *  gap. Two reasons, and the second is the one that made it a bug rather than a
 *  preference. Dropping the caret onto the following line puts it on the next
 *  thing you did not ask to touch; and with three photos dragged in at once
 *  onto consecutive lines, that next thing is another embed. Positions inside
 *  the line above are safe now that `insideEmbed` treats an edge as adjacent,
 *  which is what stops the survivor showing its raw source. */
function cutRange(
  state: EditorState,
  span: { from: number; to: number }
): { from: number; to: number; caret: number } {
  const doc = state.doc
  const line = doc.lineAt(span.from)
  const alone = line.text.trim() === doc.sliceString(span.from, span.to).trim()
  // Inline in a sentence: the caret belongs exactly where the picture was.
  if (!alone) return { ...span, caret: span.from }
  const isLast = line.number === doc.lines
  // The one case with no line above: the note began with this embed. Position 0
  // is all there is, and if the note begins with a SECOND embed it will show its
  // source — nowhere else exists to put the caret.
  const above = line.number > 1 ? doc.line(line.number - 1).to : 0
  return {
    // Same last-line reasoning as attachMove: with no trailing newline to take,
    // take the one that separated this line from the one above instead.
    from: isLast && line.number > 1 ? doc.line(line.number - 1).to : line.from,
    to: isLast ? line.to : doc.line(line.number + 1).from,
    caret: above
  }
}

/** The path an embed points at, exactly as written: the `(…)` of an image or
 *  the `src="…"` of a video. Null when neither is there to find.
 *
 *  Two shapes `attachInput` never writes but a hand-typed embed can, and both
 *  would otherwise yield a path that matches no file: a title after the
 *  destination — `![](a.png "hi")` — so only the first whitespace-delimited
 *  token counts; and an angle-bracketed destination — `![](<a b.png>)`, the
 *  CommonMark way to allow spaces — so the brackets are stripped. */
function embedTarget(text: string): string | null {
  const img = /^!\[[^\]\n]*\]\(([^)\n]*)\)$/.exec(text)
  if (img) {
    const raw = img[1].trim()
    const inner = /^<(.*)>$/.exec(raw)
    return (inner ? inner[1] : raw.split(/\s+/)[0]) || null
  }
  // The same pattern videoPass uses to find the source it plays, so the file
  // this deletes and the file that was on screen cannot come apart.
  const src = /\bsrc=["']([^"']*)["']/i.exec(text)
  return src ? src[1] || null : null
}

/** The vault-relative file an embed points at, or null when there isn't one to
 *  delete — which is a remote URL, a target that climbs out of the vault, or a
 *  target that is not a photo or video at all.
 *
 *  That last case is the one worth stating plainly: an embed's target is
 *  whatever somebody typed, and `![](Some note.md)` is a perfectly writable
 *  line. Without the extension check, confirming the delete would bin a NOTE.
 *  Returning null instead means the text still goes and the dialog says so
 *  honestly — nothing on disk is deleted on a guess about what a file is.
 *
 *  Pure, and exported, because it decides what gets deleted from the vault and
 *  that is the one thing here worth pinning down in a test. */
export function attachmentFileOf(embedText: string, notePath: string): string | null {
  const target = embedTarget(embedText)
  const resolved = target ? resolveVaultPath(target, notePath) : null
  return resolved && kindForFilename(resolved) ? resolved : null
}

/** Backspace/Delete on a selected embed. Returns false — letting CodeMirror's
 *  own delete run — for every other selection, so ordinary editing is untouched. */
const deleteSelectedEmbed = (view: EditorView): boolean => {
  if (!selectionIsEmbed(view.state)) return false
  const r = view.state.selection.main

  // Resolved BEFORE the cut, while the embed is still in the document and the
  // note it is relative to is still the one on screen.
  const notePath = view.state.field(linkEnv, false)?.path ?? ''
  const file = attachmentFileOf(view.state.doc.sliceString(r.from, r.to), notePath)

  const cut = cutRange(view.state, { from: r.from, to: r.to })
  const text = view.state.doc.sliceString(cut.from, cut.to)
  // Read before the dispatch, for the same reason `file` is: after the cut this
  // line number describes whatever moved up into its place.
  const cutLine = view.state.doc.lineAt(cut.from)
  // The picture's NEIGHBOURS, and they must be read here, BEFORE the dispatch
  // below — `cut.to` is an offset into the document as it stands now, and one
  // line later it points past the end of a document that just got shorter.
  // (It did: `after` came back as an empty string, and only the one-sided
  // fallback in spliceMediaBack kept the restore landing in the right place.)
  //
  // Removing the embed is exactly what joins these two strings, so from the
  // next tick onwards the note literally contains `before + after` — and that
  // stays true however the note is edited elsewhere, which a line number does
  // not. See MediaOrigin for the bug that forced this.
  const before = view.state.doc.sliceString(Math.max(0, cut.from - ANCHOR), cut.from)
  const after = view.state.doc.sliceString(cut.to, Math.min(view.state.doc.length, cut.to + ANCHOR))
  view.dispatch({
    changes: { from: cut.from, to: cut.to, insert: '' },
    selection: { anchor: cut.caret }
  })

  // Confirm AFTER the fact, which is what makes `restore` the whole of Cancel:
  // nothing else can reach the document while the dialog is up, so putting the
  // exact text back at the exact offset is a faithful undo — the embed re-renders
  // from it the same way it did before, because the text IS what it was.
  const handlers = view.state.facet(linkHandlersFacet)?.current
  handlers?.confirmMediaDelete({
    file,
    // Only when there is a file going into the bin. A remote image has nothing
    // to restore later, so recording where it sat would be a note for no one.
    origin: file
      ? {
          note: notePath,
          text,
          line: cutLine.number,
          col: cut.from - cutLine.from,
          before,
          after
        }
      : null,
    restore: () => {
      // The note is pinned for the same reason `attachInput` pins one: CodeEditor
      // builds its view ONCE and swaps the document in place on a note switch, so
      // `cut.from` is an offset into whichever note is on screen at the moment
      // this runs — not necessarily the one the embed came out of. The dialog is
      // not modal to the keyboard (App's shortcut handler runs in the capture
      // phase), and putting a photo back into the wrong note is exactly the
      // silent, wrong-place write rule 1 is about. Belt and braces with App's own
      // guard: this one holds however the switch happened.
      if ((view.state.field(linkEnv, false)?.path ?? '') !== notePath) {
        notifyUser(view.state, 'Couldn’t put that back — you moved to another note')
        return
      }
      view.dispatch({
        changes: { from: cut.from, to: cut.from, insert: text },
        // The line above again, for the same reason: landing on the restored
        // embed's own first character would bring it back as raw source, which
        // is the opposite of what "put it back" should look like.
        selection: { anchor: cut.caret }
      })
      view.focus()
    }
  })
  return true
}

/** Bound ahead of the default keymap in `extensions.ts`, same as the formatting
 *  keys, so it gets first refusal on Backspace/Delete. */
export const attachDeleteKeys = [
  { key: 'Backspace', run: deleteSelectedEmbed },
  { key: 'Delete', run: deleteSelectedEmbed }
]
