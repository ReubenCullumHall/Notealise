import type { EditorView } from '@codemirror/view'
import { Icon } from '../icons'
import {
  bulletList,
  checklist,
  codeBlock,
  heading,
  horizontalRule,
  inlineCode,
  insertMath,
  link,
  numberedList,
  quote,
  table
} from './formatCommands'

// Everything a custom format-bar slot can be programmed with. One list, read by
// both the bar (FormatToolbar) and the picker in Settings → Shortcuts, so the two
// can never drift. Ids are persisted in settings.json — treat them as a file
// format: rename one and every vault that used it silently empties that slot.
//
// Bold / italic / underline / strikethrough are deliberately absent: they already
// have permanent buttons in the middle of the bar, and a slot spent duplicating
// one of them is a slot wasted.

export interface ToolbarAction {
  id: string
  label: string
  /** what it does, in the tooltip and under the label in the picker */
  hint: string
  group: string
  /** the button face — short text where text reads better than any icon */
  glyph: React.ReactNode
  run: (view: EditorView) => void
}

// Lowercase on purpose: these build a button *face*, not a component — naming
// them `T`/`I` would have the linter (and fast refresh) treat them as components.
/** A text face, for the actions where a word reads better than any icon. */
const textFace = (s: string, cls = ''): React.ReactNode => (
  <span className={'text-[11.5px] font-semibold leading-none tracking-tight ' + cls}>{s}</span>
)
const iconFace = (name: Parameters<typeof Icon>[0]['name']): React.ReactNode => (
  <Icon name={name} className="h-4 w-4" />
)

export const TOOLBAR_ACTIONS: ToolbarAction[] = [
  { id: 'h1', label: 'Heading 1', hint: 'Biggest heading', group: 'Headings', glyph: textFace('H1'), run: heading(1) },
  { id: 'h2', label: 'Heading 2', hint: 'Section heading', group: 'Headings', glyph: textFace('H2'), run: heading(2) },
  { id: 'h3', label: 'Heading 3', hint: 'Sub-section heading', group: 'Headings', glyph: textFace('H3'), run: heading(3) },
  {
    id: 'bullet',
    label: 'Bulleted list',
    hint: 'Turn the selected lines into a bulleted list',
    group: 'Lists',
    glyph: iconFace('listBullet'),
    run: bulletList
  },
  {
    id: 'numbered',
    label: 'Numbered list',
    hint: 'Turn the selected lines into a numbered list',
    group: 'Lists',
    glyph: iconFace('listNumber'),
    run: numberedList
  },
  {
    id: 'checklist',
    label: 'Checklist',
    hint: 'Tickable task list',
    group: 'Lists',
    glyph: iconFace('listCheck'),
    run: checklist
  },
  { id: 'quote', label: 'Quote', hint: 'Indented quote block', group: 'Blocks', glyph: iconFace('quote'), run: quote },
  {
    id: 'code',
    label: 'Inline code',
    hint: 'Monospaced `code` inside a line',
    group: 'Blocks',
    glyph: iconFace('code'),
    run: inlineCode
  },
  {
    id: 'codeBlock',
    label: 'Code block',
    hint: 'Fenced block for several lines of code',
    group: 'Blocks',
    glyph: iconFace('codeBlock'),
    run: codeBlock
  },
  {
    id: 'math',
    label: 'LaTeX formula',
    hint: 'A $$…$$ maths block  (Ctrl/Cmd+Shift+L)',
    group: 'Blocks',
    glyph: textFace('ƒx', 'font-display italic'),
    run: insertMath
  },
  { id: 'link', label: 'Link', hint: 'Insert [text](url)', group: 'Insert', glyph: iconFace('link'), run: link },
  {
    id: 'table',
    label: 'Table',
    hint: 'A starter two-column table',
    group: 'Insert',
    glyph: iconFace('table'),
    run: table
  },
  {
    id: 'rule',
    label: 'Divider',
    hint: 'A horizontal rule across the page',
    group: 'Insert',
    glyph: iconFace('rule'),
    run: horizontalRule
  }
]

/** The action a saved slot id refers to, or null for an empty slot. Unknown ids
 *  (an older vault, a hand-edited file) read as empty rather than throwing. */
export function findAction(id: string): ToolbarAction | null {
  return TOOLBAR_ACTIONS.find((a) => a.id === id) ?? null
}

/** Catalogue in picker order, split into its labelled groups. */
export const ACTION_GROUPS: { group: string; actions: ToolbarAction[] }[] = TOOLBAR_ACTIONS.reduce(
  (acc: { group: string; actions: ToolbarAction[] }[], a) => {
    const last = acc[acc.length - 1]
    if (last && last.group === a.group) last.actions.push(a)
    else acc.push({ group: a.group, actions: [a] })
    return acc
  },
  []
)

/** Where each slot sits, for the labels in Settings. */
export const SLOT_LABELS = ['Far left', 'Left', 'Right', 'Far right']
