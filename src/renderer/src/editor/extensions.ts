import type { Extension } from '@codemirror/state'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { drawSelection, EditorView, keymap } from '@codemirror/view'
import { editorStyling } from './highlight'
import { livePreview } from './livePreview'
import { imageClick } from './imagePass'
import { attachInput } from './attachInput'
import { attachDeleteKeys, embedSelectionAttr } from './attachSelect'
import { scrollbarReveal } from './scrollbarReveal'
import { webLinkGestures } from './webLinkPass'
import { taskClick } from './taskPass'
import { blockMath } from './blockMath'
import { blockTable } from './blockTable'
import { lineMove } from './lineMove'
import { registerView } from './viewRegistry'
import { applyColor } from './colorCommands'
import { completionExtension } from './completions'
import { linkEnv, linkHandlersFacet, type LinkHandlersRef } from './linkEnv'
import { linkGestures } from './linkGestures'
import { bold, insertMath, italic, strike, underline } from './formatCommands'
import { DEFAULT_HL } from './palette'

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
    history(),
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
    markdown({ base: markdownLanguage }),
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
    imageClick,
    attachInput,
    webLinkGestures,
    taskClick,
    blockMath,
    blockTable,
    // The six-dot grip beside the active line (lineMove.ts). After the passes,
    // so it never competes with a widget for the same gesture.
    lineMove,
    // Makes this view findable by a drag that starts in another pane
    // (viewRegistry.ts) — the one place in editor/ that looks sideways.
    registerView,
    editorStyling,
    completionExtension()
  ]
}
