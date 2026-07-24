import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { EditorView } from '@codemirror/view'
import { tags as t } from '@lezer/highlight'

// Visual styling for the markdown syntax tree — headings look like headings,
// bold is bold, etc. Colours and fonts reference theme tokens (--ed-*, --font-*
// in theme.css) so light and dark both track the active [data-theme].
const mdHighlight = HighlightStyle.define([
  { tag: t.heading1, fontSize: '1.7em', fontWeight: '700', lineHeight: '1.3' },
  { tag: t.heading2, fontSize: '1.4em', fontWeight: '700', lineHeight: '1.3' },
  { tag: t.heading3, fontSize: '1.2em', fontWeight: '600' },
  { tag: [t.heading4, t.heading5, t.heading6], fontWeight: '600' },
  { tag: t.strong, fontWeight: '700' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through', color: 'var(--ed-muted)' },
  {
    tag: t.monospace,
    fontFamily: 'var(--font-mono)',
    color: 'var(--ed-code)'
  },
  { tag: t.quote, color: 'var(--ed-muted)', fontStyle: 'italic' },
  { tag: [t.link, t.url], color: 'var(--ed-link)', textDecoration: 'underline' }
])

const editorTheme = EditorView.theme({
  '&': { height: '100%', backgroundColor: 'transparent' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    fontFamily: 'var(--font-sans)',
    fontSize: '16px',
    lineHeight: '1.7',
    overflow: 'auto',
    padding: '24px 0 40vh'
  },
  '.cm-content': { maxWidth: '46rem', margin: '0 auto', padding: '0 28px' },
  '.cm-line': { padding: '0' },
  '.cm-bullet': { color: 'var(--ed-bullet)', paddingRight: '0.4em' }
})

export const editorStyling = [syntaxHighlighting(mdHighlight), editorTheme]
