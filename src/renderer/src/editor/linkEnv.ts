import { Facet, StateEffect, StateField, type EditorState } from '@codemirror/state'
import type { NoteRef } from '../../../shared/links'
import type { MediaOrigin } from '../../../shared/workspace'
import type { SpaceMark } from '../links/model'

// What the editor needs to know about the vault in order to render a `[[link]]`:
// which notes exist, which note we're in (a link resolves relative to where it is
// written), and which space each note belongs to (a link that leaves the space
// you're working in shows that space's emoji).
//
// This is a StateField fed by a StateEffect, NOT a ref and NOT a facet.
//
//   • Not a ref, because the decoration work happens inside livePreview's
//     ViewPlugin, which only recomputes on `docChanged || selectionSet ||
//     viewportChanged`. A ref mutated by React changes the ANSWER with no
//     transaction to trigger a repaint — so creating the note a link points at
//     would leave that link dashed until you happened to type. That is exactly
//     CLAUDE.md's bug-class 1: a value written that nothing reads.
//   • Not a facet, because changing a facet's value means reconfiguring the
//     state, which is heavier machinery for the same effect and fights the
//     create-the-view-once pattern in CodeEditor.tsx.
//
// The imperative callbacks (open a note, create one, start a drag) are a separate
// mechanism — see `LinkHandlers` below — because their identity churns on every
// App render and putting them here would dispatch a transaction each time.

export interface LinkEnv {
  /** every note in the WHOLE vault, not just the active space — a link is
   *  allowed to point somewhere the sidebar isn't currently showing */
  notes: NoteRef[]
  spaces: SpaceMark[]
  /** the note this editor is showing; "" before one is open */
  path: string
}

export const EMPTY_ENV: LinkEnv = { notes: [], spaces: [], path: '' }

/** Push a new view of the vault into an editor. Arriving as a transaction is the
 *  whole point: it is what makes the links repaint. */
export const setLinkEnv = StateEffect.define<LinkEnv>()

export const linkEnv = StateField.define<LinkEnv>({
  create: () => EMPTY_ENV,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setLinkEnv)) return e.value
    return value
  }
})

/** How a link asks to be opened. Mirrors the gestures the tab strip already
 *  uses, so a link behaves like every other way of opening a note. */
export type OpenHow = 'replace' | 'tab' | 'split'

/** The App-side actions the editor can trigger. Held in a `{ current }` box
 *  captured once when the view is built — React-shaped, but React-free, so
 *  `extensions.ts` stays a plain CodeMirror module.
 *
 *  Named for links because links are what first needed it; `notify` at the
 *  bottom is not about links at all. Anything else the editor needs App to do
 *  belongs here too rather than in a second parallel channel. */
export interface LinkHandlers {
  open: (path: string, how: OpenHow, heading?: string | null) => void
  /** the target didn't exist: make it, in `dir`, and open it */
  create: (dir: string, title: string, how: OpenHow) => void
  /** jump to a heading inside the note already on screen */
  jump: (heading: string) => void
  /** a folder link: show it in the sidebar, since there is nothing to open */
  reveal: (folder: string) => void
  /** hovering a link in the TEXT — the same card the links strip's chips raise,
   *  so a connection describes itself the same way wherever you meet it. `null`
   *  when the pointer leaves. `unknown` rather than the real type because this
   *  module is plain CodeMirror and must not reach into the React tree. */
  inspect: (at: unknown | null) => void
  dragStart: (path: string) => void
  dragEnd: () => void
  /** Say one line to the user — App's `flash`, the same strip every other
   *  "couldn't do that" in the app uses. The editor has no UI of its own to
   *  report into, so before this existed an attachment that failed to write
   *  left the user with no embed and no explanation: indistinguishable from
   *  the paste simply not working. */
  notify: (message: string) => void
  /** An embed has just been removed from the note and wants confirming.
   *  App owns the dialog, the "ask me about this" setting, and the binning —
   *  see `MediaDelete` for what it is handed. */
  confirmMediaDelete: (req: MediaDelete) => void
}

/** What `confirmMediaDelete` is given. A named type because three layers pass it
 *  around: the editor builds it, App's handler routes it, and the dialog holds
 *  it while it waits for an answer.
 *
 *  Taking a photo out of a note deletes the FILE too — into `.mdnotes/trash`,
 *  the same bin a deleted note goes to, with the same 7-day recovery net under
 *  it. Only the editor can work out which file that is, because an embed's
 *  target is written relative to the note holding it, so the path is resolved
 *  here and handed over rather than re-derived on the App side. */
export interface MediaDelete {
  /** the file, vault-relative — null when there is no file to delete, which is
   *  a remote URL or a target that resolves outside the vault */
  file: string | null
  /** what it takes to put this note back the way it was, recorded now and
   *  stored on the bin row, so Restore returns the picture to the note and not
   *  just the file to the vault. Null exactly when `file` is: nothing is being
   *  binned, so there is nothing for a later restore to undo. */
  origin: MediaOrigin | null
  /** puts the exact text back at the exact offset — it IS the Cancel button.
   *  The file is binned only once the delete is CONFIRMED, so Cancel never has
   *  anything to undo on disk. */
  restore: () => void
}

export type LinkHandlersRef = { current: LinkHandlers | null }

/** The handlers, reachable from ANY editor module that can see the state —
 *  not only the ones handed the ref when the extensions were built. That is the
 *  whole reason this exists alongside the ref: `attachFiles` is invoked from the
 *  command registry (docs/commands.md) with nothing but a view, so a closure
 *  captured at construction can't reach it. A Facet rather than a StateField
 *  because the value never changes for the life of the view. */
export const linkHandlersFacet = Facet.define<LinkHandlersRef, LinkHandlersRef | null>({
  combine: (values) => values[0] ?? null
})

/** Say one line to the user from inside the editor.
 *
 *  Silently does nothing where nothing is listening — the browser preview and
 *  the tests both build editors with no handlers — which is the right failure:
 *  a message is never worth throwing over. */
export function notifyUser(state: EditorState, message: string): void {
  state.facet(linkHandlersFacet)?.current?.notify(message)
}

/** `notifyUser` for a caught error: `<what> — <why>`, with Electron's IPC
 *  wrapper stripped off the message.
 *
 *  An error crossing the IPC bridge arrives as "Error invoking remote method
 *  'asset:write': Error: <the real message>", and putting that in front of
 *  someone who just pasted a photo is worse than saying nothing. What survives
 *  the strip is worth keeping, though: main's own messages are written for
 *  people — including the "this folder is still syncing (OneDrive, Google Drive
 *  or iCloud) — wait a moment and try again" that `renameWithRetry` raises,
 *  which a synced vault hits routinely and which tells the user exactly what to
 *  do about it. */
export function notifyError(state: EditorState, what: string, e: unknown): void {
  const raw = e instanceof Error ? e.message : String(e)
  const why = raw.split('Error: ').pop()?.trim()
  notifyUser(state, why ? `${what} — ${why}` : what)
}
