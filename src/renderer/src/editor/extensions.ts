import type { Extension } from '@codemirror/state'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { drawSelection, EditorView, keymap } from '@codemirror/view'
import { editorStyling } from './highlight'
import { livePreview } from './livePreview'
import { imageClick } from './imagePass'
import { attachInput } from './attachInput'
import { attachDeleteKeys, embedSelectionAttr } from './attachSelect'
import { webLinkGestures } from './webLinkPass'
import { taskClick } from './taskPass'
import { blockMath } from './blockMath'
import { blockTable } from './blockTable'
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
    drawSelection(),
    // Must come after drawSelection: it marks the editor so the selection that
    // extension paints can be suppressed over a picked embed.
    embedSelectionAttr,
    livePreview,
    imageClick,
    attachInput,
    webLinkGestures,
    taskClick,
    blockMath,
    blockTable,
    editorStyling,
    completionExtension()
  ]
}
