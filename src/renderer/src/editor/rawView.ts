import { Facet, type Extension } from '@codemirror/state'

// "Markdown pro": show the file as it really is.
//
// Live preview hides the syntax marks — `**`, `#`, `|`, `$` — so text just looks
// formatted. That is the whole point of the editor, and it is also the one thing
// that makes a note harder to reason about when you WANT to see the source: what
// exactly is in this line, why is that table drawn like that, what did the
// importer actually write.
//
// The switch is a Facet rather than a StateField because nothing inside the
// editor ever changes it: the answer comes from React (the note's own
// `workspace.json` flag), is pushed in by reconfiguring the editor, and is read
// by every decoration producer. A Facet is exactly "a value configured from
// outside that extensions read".
//
// **What raw view does NOT do is change the styling.** Bold still looks bold and
// a heading is still large — the marks simply stop being hidden. That was the
// user's call over a flat monospace view, and it is also the cheaper contract:
// `highlight.ts` is untouched, so there is no second set of colours to keep in
// step, and toggling cannot reflow the note into something unrecognisable.
export const rawView = Facet.define<boolean, boolean>({
  // `some` rather than `every`: with no value configured the default is false,
  // and a single `true` from the one place that sets it wins.
  combine: (values) => values.some(Boolean)
})

/** Read it wherever decorations are built. Takes anything with a `facet`
 *  accessor so a `ViewUpdate`'s state, a plain `EditorState` and a view's state
 *  all work without three call shapes. */
export const isRaw = (state: { facet: (f: typeof rawView) => boolean }): boolean =>
  state.facet(rawView)

export const rawViewOf = (on: boolean): Extension => rawView.of(on)
