import { Compartment, type Extension } from '@codemirror/state'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { search, searchKeymap } from '@codemirror/search'
import { drawSelection, EditorView, keymap } from '@codemirror/view'
import { editorStyling } from './highlight'
import { colorEditing } from './colorCommands'
import { markEditing } from './markEditing'
import { cursorSnap } from './cursorSnap'
import { livePreview } from './livePreview'
import { linkEdges } from './linkEdges'
import { imageClick } from './imagePass'
import { attachInput } from './attachInput'
import { attachDeleteKeys, embedSelectionAttr } from './attachSelect'
import { scrollbarReveal } from './scrollbarReveal'
import { webLinkGestures } from './webLinkPass'
import { taskClick } from './taskPass'
import { blockMath } from './blockMath'
import { ruleSnap } from './ruleSnap'
import { mathEditor } from './mathEditor'
import { blockTable } from './blockTable'
import { toggleList } from './toggleList'
import { toggleMarkdown } from './toggleModel'
import { lineMove } from './lineMove'
import { blockFlash } from './blockFlash'
import { dropCopiedTags } from './blockIds'
import { relink } from './relink'
import { registerView } from './viewRegistry'
import { applyColor } from './colorCommands'
import { completionExtension } from './completions'
import { linkEnv, linkHandlersFacet, type LinkHandlersRef } from './linkEnv'
import { linkGestures } from './linkGestures'
import { bold, insertMath, italic, strike, underline } from './formatCommands'
import { DEFAULT_HL } from './palette'

/** Holds `history()` so it can be swapped for an empty one — see its use below.
 *  Module-level and shared by every editor: a Compartment is only a key, and
 *  each EditorState resolves it against its own contents. */
export const historyBox = new Compartment()

// The base editor extension set. `markdownLanguage` as the base enables GFM
// (strikethrough, tables, task lists) so those marks appear in the syntax tree.
/** `links` is a `{ current }` box owned by the React layer and captured once, the
 *  same idiom CodeEditor uses for `onDocChange` — the view is created once, so a
 *  callback baked in at construction would go stale on the first App render. */
export function baseExtensions(links?: LinkHandlersRef): Extension[] {
  return [
    linkEnv,
    // The facet as well as the closure: linkGestures captures the ref directly,
    // but attachInput/attachFiles reach it through the state instead — see
    // `linkHandlersFacet`. Both read the same box, so they can't disagree.
    ...(links ? [linkHandlersFacet.of(links), linkGestures(links)] : []),
    // In a Compartment so CodeEditor can throw the undo history away when the
    // pane changes note. A pane never rebuilds its CodeMirror (it swaps the
    // document in place, which is what keeps the cursor), so without this the
    // history followed you from one note into the next: one Cmd+Z too many in
    // the note you had just opened undid the SWAP and filled it with the
    // previous note's text — which the autosave then wrote to its file
    // (Reuben's call, 2026-09-19: undo starts fresh in each note).
    historyBox.of(history()),
    // Our formatting bindings come first so they win over any defaults.
    keymap.of([
      // Ahead of defaultKeymap's own Backspace/Delete: these decline (return
      // false) for every selection that isn't a whole embed, so ordinary
      // deleting is untouched.
      ...attachDeleteKeys,
      { key: 'Mod-b', run: (v) => { bold(v); return true } },
      { key: 'Mod-i', run: (v) => { italic(v); return true } },
      { key: 'Mod-u', run: (v) => { underline(v); return true } },
      { key: 'Mod-Shift-x', run: (v) => { strike(v); return true } },
      { key: 'Mod-Shift-l', run: (v) => { insertMath(v); return true } },
      { key: 'Mod-Shift-h', run: (v) => { applyColor(v, 'hl', DEFAULT_HL); return true } },
      ...defaultKeymap,
      ...historyKeymap
    ]),
    // Find & replace, at the top of the note rather than CodeMirror's own
    // default of the bottom — this app's chrome (format bar, tabs) is all
    // above the text already, so a panel appearing there reads as one more
    // toolbar rather than something popping up out of nowhere below whatever
    // is currently on screen.
    search({ top: true }),
    // A SEPARATE keymap extension, placed AFTER the one above — CM6 resolves
    // a key by extension order, so this is what lets our own bindings keep
    // winning collisions rather than searchKeymap's. There is exactly one:
    // Mod-Shift-l is both this app's "insert inline maths" (bound above) and
    // CodeMirror's own "select all matches of the current selection". Ours
    // wins, matching the "our formatting bindings come first" rule already
    // stated above — `selectSelectionMatches` simply never fires. Every other
    // searchKeymap binding (Mod-f open, Mod-g/F3 next, Escape close, Mod-d
    // select-next-occurrence, Mod-Alt-g goto-line) is free.
    keymap.of(searchKeymap),
    // `toggleMarkdown` teaches the parser the `<details>` title and end lines
    // a toggle list is stored as (toggleModel.ts).
    markdown({ base: markdownLanguage, extensions: [toggleMarkdown] }),
    EditorView.lineWrapping,
    // Stop switching the machine's OWN spell checker off. CodeMirror hardcodes
    // `spellcheck: "false"` onto its editable element (view/index.js's
    // updateAttrs), so until this line the OS dictionary was told not to mark a
    // misspelling in a note even where the user had it on everywhere else —
    // "off by default" here was CodeMirror's decision, not ours. This app
    // deliberately ships NO dictionary and NO spell-check setting of its own
    // (docs/product-rulings.md): a machine already has one, and a second one
    // that disagrees with it is worse than none. The facet merges into those
    // defaults rather than fighting them, so this wins over the "false" above.
    //
    // VERIFIED that the attribute flips; NOT verified that macOS then marks
    // anything — measured 2026-08-25, and it did not, while a bare
    // contenteditable on the same machine did. Read the ruling before assuming
    // this feature works, and before "fixing" it: engineering around
    // CodeMirror's DOM to make spell checking happen is explicitly out of
    // scope. This line stays because without it there is no chance at all.
    //
    // `autocorrect` and `autocapitalize` stay off, and that is not an
    // oversight: they REWRITE what was typed. In Markdown that means straight
    // quotes becoming curly ones inside a fenced code block, and a lowercase
    // list item silently capitalised. Underlining a word is advice; changing
    // it is damage.
    EditorView.contentAttributes.of({ spellcheck: 'true' }),
    drawSelection(),
    // Must come after drawSelection: it marks the editor so the selection that
    // extension paints can be suppressed over a picked embed.
    embedSelectionAttr,
    scrollbarReveal,
    livePreview,
    // Backspace/Delete just beside a link edit the text you can see rather
    // than the hidden brackets (linkEdges.ts).
    linkEdges,
    // Backspace at a colour tag's edge + the empty-pair sweep. Beside
    // livePreview because the two are halves of one thing: that hides the tags,
    // this keeps them editable while hidden.
    colorEditing,
    // The same two safety nets for bold/italic/strike/code/<u> and friends,
    // whose marks are also never shown now (markEditing.ts).
    markEditing,
    // Keeps the cursor on the visible side of hidden marks (clicks, End, Home,
    // Enter) — the other half of never showing them (cursorSnap.ts).
    cursorSnap,
    imageClick,
    attachInput,
    webLinkGestures,
    taskClick,
    // Toggle lists: the arrow, the indent and the hidden lines (toggleList.ts).
    // Ahead of blockMath and blockTable, which ask it what is hidden.
    toggleList,
    blockMath,
    // Measures each formula on its own line so the Lined look can round it up
    // to whole rules (ruleSnap.ts, app.css).
    ruleSnap,
    // The maths box: insert or click a formula and edit it in a box under the
    // line while it redraws as you type (mathEditor.ts).
    mathEditor,
    blockTable,
    // The six-dot grip beside the active line (lineMove.ts). After the passes,
    // so it never competes with a widget for the same gesture.
    lineMove,
    // The heading or block a link lands on, lit for a moment (blockFlash.ts).
    blockFlash,
    // A pasted copy of a tagged block drops the copy's tag (blockIds.ts).
    dropCopiedTags,
    // Right-click a link to point it somewhere else (relink.ts).
    relink,
    // Makes this view findable by a drag that starts in another pane
    // (viewRegistry.ts) — the one place in editor/ that looks sideways.
    registerView,
    editorStyling,
    completionExtension()
  ]
}
