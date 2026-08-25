import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { EditorView } from '@codemirror/view'
import { tags as t } from '@lezer/highlight'

// ported from legacy/src/livePreview.js
const c = (name: string, alpha?: number): string =>
  alpha == null ? `rgb(var(${name}))` : `rgb(var(${name}) / ${alpha})`

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
    fontFamily: 'var(--note-font-sans)',
    fontSize: '16px',
    lineHeight: '1.7',
    overflow: 'auto',
    padding: '24px 0 40vh'
  },
  // reads the --editor-max-width set per-space by settings/model.ts's
  // applySettings (theme.css's `[data-editor-width]` block) — Settings →
  // Customisation/Spaces → Appearance → Editor width.
  // The 28px gutter MUST live on `.cm-line`, not on `.cm-content` — it was the
  // other way round until 2026-08-24 and that is what made a multi-line
  // selection ragged (reported as "why is this selection like it is": a notch
  // at the top-left of the block and a small tab hanging off the bottom-left).
  //
  // CodeMirror works out where the text starts by reading the LINE's padding,
  // not the content's (`rectanglesForRange`, @codemirror/view):
  //
  //     leftSide  = contentRect.left  + parseInt(lineStyle.paddingLeft)
  //     rightSide = contentRect.right - parseInt(lineStyle.paddingRight)
  //
  // With the padding on `.cm-content` that reads 0, so `leftSide` came out as
  // the content's BORDER box — 28px left of any possible text. The full-line
  // pieces of a selection were drawn to that edge while the first and last
  // partial lines used `coordsAtPos`, which knows the truth. Two different left
  // edges, 28px apart, on the same selection.
  //
  // Moving it changes no layout whatsoever: `.cm-content` is border-box, so the
  // text still starts 28px inside `--editor-max-width` and is still the same
  // width (verified — the caret does not move, the text column stays 680px at
  // the 46rem default). Only the rectangles change, and they become correct.
  '.cm-content': { maxWidth: 'var(--editor-max-width, 46rem)', margin: '0 auto', padding: '0' },
  '.cm-line': { padding: '0 28px' },
  '.cm-bullet': { color: 'var(--ed-bullet)', paddingRight: '0.4em' },
  // slash-command / completion popup — ported from legacy/src/livePreview.js's
  // editorTheme, which restyles @codemirror/autocomplete's own plain
  // grey-and-square baseTheme into one of this app's floating panels.
  '.cm-tooltip.cm-tooltip-autocomplete': {
    border: `1px solid ${c('--wash', 0.14)}`,
    borderRadius: '12px',
    background: c('--surface', 0.97),
    boxShadow: 'var(--shadow-float)',
    overflow: 'hidden',
    padding: '5px',
    backdropFilter: 'blur(6px)'
  },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li': {
    padding: '6px 10px',
    borderRadius: '8px',
    fontFamily: 'var(--note-font-sans)',
    color: c('--ink-800')
  },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]': {
    background: c('--wash', 0.12),
    color: c('--brand-600')
  },
  '.cm-completionLabel': { fontWeight: '500' },
  '.cm-completionDetail': {
    color: c('--ink-500'),
    fontStyle: 'normal',
    marginLeft: '0.5em',
    fontSize: '0.85em'
  }
})

export const editorStyling = [syntaxHighlighting(mdHighlight), editorTheme]
