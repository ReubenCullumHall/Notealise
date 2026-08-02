import { StateEffect, StateField } from '@codemirror/state'
import type { NoteRef } from '../../../shared/links'
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

/** The App-side actions a link can trigger. Held in a `{ current }` box captured
 *  once when the view is built — React-shaped, but React-free, so `extensions.ts`
 *  stays a plain CodeMirror module. */
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
}

export type LinkHandlersRef = { current: LinkHandlers | null }
