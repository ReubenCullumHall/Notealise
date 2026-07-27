import type { Extension } from '@codemirror/state'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { drawSelection, EditorView, keymap } from '@codemirror/view'
import { editorStyling } from './highlight'
import { livePreview } from './livePreview'
import { applyColor } from './colorCommands'
import { completionExtension } from './completions'
import { bold, insertMath, italic, strike, underline } from './formatCommands'
import { DEFAULT_HL } from './palette'

// The base editor extension set. `markdownLanguage` as the base enables GFM
// (strikethrough, tables, task lists) so those marks appear in the syntax tree.
export function baseExtensions(): Extension[] {
  return [
    history(),
    // Our formatting bindings come first so they win over any defaults.
    keymap.of([
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
    livePreview,
    editorStyling,
    completionExtension()
  ]
}
