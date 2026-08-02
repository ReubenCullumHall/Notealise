// Type-only, deliberately: nothing here calls an EditorView static, and keeping
// it a type import is what lets the whole registry be exercised against a plain
// EditorState with no DOM (see formatCommands.test.ts's harness). Make it a value
// import and the test file pulls in CodeMirror's DOM build and dies.
import type { EditorView } from '@codemirror/view'
import { Icon } from '../icons'
import type { MarkerKind } from './formatModel'
import {
  codeBlock,
  inlineCode,
  insertMath,
  link,
  table,
  toggleBlock,
  horizontalRule,
  wikiLink
} from './formatCommands'

// ---------------------------------------------------------------------------
// THE editor command registry. One list, three surfaces:
//
//   • the four programmable format-bar slots   (FormatToolbar → SlotPicker)
//   • the picker in Settings → Spaces → Shortcuts (the same SlotPicker)
//   • the "/" menu inside the editor            (completions.ts)
//
// **Every new command goes here and appears in all three automatically.** Until
// 2026-08-01 there were two catalogues — this one and a separate SLASH_COMMANDS
// in completions.ts — which reimplemented the same nine commands with different
// code and no shared ids. A command added to one simply didn't exist in the
// other, and nothing anywhere said so. Don't start a second list: if a surface
// needs something the others don't, add a field here.
//
// **Ids are a file format.** They are persisted in settings.json as a Space's
// `toolbarSlots`; rename one and every vault that used it silently empties that
// slot. `commands.test.ts` pins the existing ids for exactly that reason.
//
// Bold / italic / underline / strikethrough are deliberately absent: they have
// permanent buttons in the middle of the bar and keystrokes of their own, and a
// slot — or a menu row — spent duplicating one of them is wasted.
// ---------------------------------------------------------------------------

/** The text a "/" invocation typed to summon the command (`/h1`), which the
 *  command must remove before acting. Absent for a button click or a keystroke. */
export interface SlashRange {
  from: number
  to: number
}

export interface EditorCommand {
  id: string
  label: string
  /** what it does: the button tooltip, the line under the label in the picker,
   *  and the detail beside the label in the "/" menu */
  hint: string
  group: string
  /** the button face — short text where a word reads better than any icon */
  glyph: React.ReactNode
  /** extra words the "/" menu matches on, beyond the label ("ul" → Bulleted list) */
  terms: string[]
  run: (view: EditorView, slash?: SlashRange) => void
  /** set false to keep a command out of the "/" menu. Nothing needs it yet; it
   *  exists so a button-only command has somewhere to say so, rather than
   *  someone starting a parallel list again. */
  slash?: boolean
}

/** Delete the `/query` that summoned a command, so it acts on the line the user
 *  meant rather than on the line plus the text they typed to get here. */
function consume(view: EditorView, slash?: SlashRange): void {
  if (!slash) return
  view.dispatch({
    changes: { from: slash.from, to: slash.to, insert: '' },
    selection: { anchor: slash.from }
  })
}

/**
 * A block command (heading / list / quote).
 *
 * The one genuine semantic difference between the old two catalogues: the button
 * TOGGLES (press H1 twice and the heading goes away) while "/" SETS (you typed
 * the command's name; you asked for a heading). Both are right for their own
 * gesture — pressing a button again is a retraction, typing a name is not — so
 * the direction follows the invocation rather than the command.
 */
const block =
  (kind: MarkerKind) =>
  (view: EditorView, slash?: SlashRange): void => {
    consume(view, slash)
    toggleBlock(view, kind, slash ? 'set' : 'toggle')
  }

/** Everything else: the same behaviour either way, once the query is gone. */
const insert =
  (fn: (view: EditorView) => void) =>
  (view: EditorView, slash?: SlashRange): void => {
    consume(view, slash)
    fn(view)
  }

// Lowercase on purpose: these build a button *face*, not a component — naming
// them `T`/`I` would have the linter (and fast refresh) treat them as components.
/** A text face, for the commands where a word reads better than any icon. */
const textFace = (s: string, cls = ''): React.ReactNode => (
  <span className={'text-[11.5px] font-semibold leading-none tracking-tight ' + cls}>{s}</span>
)
const iconFace = (name: Parameters<typeof Icon>[0]['name']): React.ReactNode => (
  <Icon name={name} className="h-4 w-4" />
)

export const EDITOR_COMMANDS: EditorCommand[] = [
  {
    id: 'h1',
    label: 'Heading 1',
    hint: 'Biggest heading',
    group: 'Headings',
    glyph: textFace('H1'),
    terms: ['h1', 'heading', 'title', 'big'],
    run: block('h1')
  },
  {
    id: 'h2',
    label: 'Heading 2',
    hint: 'Section heading',
    group: 'Headings',
    glyph: textFace('H2'),
    terms: ['h2', 'heading', 'subtitle', 'section'],
    run: block('h2')
  },
  {
    id: 'h3',
    label: 'Heading 3',
    hint: 'Sub-section heading',
    group: 'Headings',
    glyph: textFace('H3'),
    terms: ['h3', 'heading', 'small'],
    run: block('h3')
  },
  {
    id: 'bullet',
    label: 'Bulleted list',
    hint: 'Turn the selected lines into a bulleted list',
    group: 'Lists',
    glyph: iconFace('listBullet'),
    terms: ['bullet', 'list', 'ul', 'point'],
    run: block('bullet')
  },
  {
    id: 'numbered',
    label: 'Numbered list',
    hint: 'Turn the selected lines into a numbered list',
    group: 'Lists',
    glyph: iconFace('listNumber'),
    terms: ['number', 'ordered', 'ol', 'list'],
    run: block('numbered')
  },
  {
    id: 'checklist',
    label: 'Checklist',
    hint: 'Tickable task list',
    group: 'Lists',
    glyph: iconFace('listCheck'),
    terms: ['todo', 'task', 'checkbox', 'tick', 'list'],
    run: block('checklist')
  },
  {
    id: 'quote',
    label: 'Quote',
    hint: 'Indented quote block',
    group: 'Blocks',
    glyph: iconFace('quote'),
    terms: ['quote', 'blockquote', 'cite'],
    run: block('quote')
  },
  {
    id: 'code',
    label: 'Inline code',
    hint: 'Monospaced `code` inside a line',
    group: 'Blocks',
    glyph: iconFace('code'),
    terms: ['code', 'mono', 'inline'],
    run: insert(inlineCode)
  },
  {
    id: 'codeBlock',
    label: 'Code block',
    hint: 'Fenced block for several lines of code',
    group: 'Blocks',
    glyph: iconFace('codeBlock'),
    terms: ['code', 'fence', 'block', 'snippet'],
    run: insert(codeBlock)
  },
  {
    id: 'math',
    label: 'LaTeX formula',
    hint: 'A $$…$$ maths block  (Ctrl/Cmd+Shift+L)',
    group: 'Blocks',
    glyph: textFace('ƒx', 'font-display italic'),
    terms: ['math', 'latex', 'formula', 'equation', 'tex'],
    run: insert(insertMath)
  },
  {
    // Ahead of the web link, so "/link" offers the note link first: linking notes
    // to each other is the everyday case, linking out to a URL the occasional one.
    id: 'wikilink',
    label: 'Link to a note',
    hint: 'Insert [[ ]] and pick a note',
    group: 'Insert',
    glyph: iconFace('noteLink'),
    terms: ['link', 'note', 'wiki', 'wikilink', 'connect', 'reference', '[['],
    run: insert(wikiLink)
  },
  {
    // Relabelled from plain "Link" when the note link arrived: two commands
    // called "Link" in the same group would be a coin toss. The ID is untouched —
    // it is in every vault's settings.json.
    id: 'link',
    label: 'Web link',
    hint: 'Insert [text](url)',
    group: 'Insert',
    glyph: iconFace('link'),
    terms: ['link', 'url', 'web', 'href', 'external'],
    run: insert(link)
  },
  {
    id: 'table',
    label: 'Table',
    hint: 'A starter two-column table',
    group: 'Insert',
    glyph: iconFace('table'),
    terms: ['table', 'grid', 'row', 'column'],
    run: insert(table)
  },
  {
    id: 'rule',
    label: 'Divider',
    hint: 'A horizontal rule across the page',
    group: 'Insert',
    glyph: iconFace('rule'),
    terms: ['divider', 'rule', 'hr', 'line', 'separator'],
    run: insert(horizontalRule)
  }
]

/** The command a saved slot id refers to, or null for an empty slot. Unknown ids
 *  (an older vault, a hand-edited file) read as empty rather than throwing. */
export function findAction(id: string): EditorCommand | null {
  return EDITOR_COMMANDS.find((a) => a.id === id) ?? null
}

/** Catalogue in picker order, split into its labelled groups. */
export const ACTION_GROUPS: { group: string; actions: EditorCommand[] }[] = EDITOR_COMMANDS.reduce(
  (acc: { group: string; actions: EditorCommand[] }[], a) => {
    const last = acc[acc.length - 1]
    if (last && last.group === a.group) last.actions.push(a)
    else acc.push({ group: a.group, actions: [a] })
    return acc
  },
  []
)

/** What the "/" menu offers, in catalogue order. */
export const SLASH_COMMANDS: EditorCommand[] = EDITOR_COMMANDS.filter((c) => c.slash !== false)

/** Whether a typed "/" query matches a command. The catalogue's own order is the
 *  ranking — the same order the picker shows — so this only ever filters. */
export function matchesQuery(c: EditorCommand, typed: string): boolean {
  if (!typed) return true
  const q = typed.toLowerCase()
  return c.label.toLowerCase().includes(q) || c.terms.some((t) => t.includes(q))
}

/** Where each slot sits, for the labels in Settings. */
export const SLOT_LABELS = ['Far left', 'Left', 'Right', 'Far right']
