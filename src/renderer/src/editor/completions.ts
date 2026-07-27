import {
  autocompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult
} from '@codemirror/autocomplete'
import type { EditorView } from '@codemirror/view'
import type { Extension } from '@codemirror/state'

// "/" slash commands — ported from legacy/src/completions.js (SLASH_COMMANDS),
// the same set the old textarea editor offered. Legacy also has a "[[note"
// wiki-link source here; that's left out until this editor has a vault-title
// list to offer completions from.

interface SlashCommand {
  label: string
  hint: string
  terms: string[]
  apply: (view: EditorView, from: number, to: number) => void
}

const STRIP_PREFIX = /^(#{1,6}\s+|>\s+|-\s\[[ xX]\]\s+|[-*]\s+|\d+\.\s+)/

function blockApply(prefix: string): SlashCommand['apply'] {
  return (view, from, to) => {
    const line = view.state.doc.lineAt(from)
    const before = view.state.doc.sliceString(line.from, from).replace(STRIP_PREFIX, '')
    const insert = prefix + before
    view.dispatch({
      changes: { from: line.from, to, insert },
      selection: { anchor: line.from + insert.length }
    })
  }
}

function snippetApply(snippet: string, caretOffset: number): SlashCommand['apply'] {
  return (view, from, to) => {
    view.dispatch({
      changes: { from, to, insert: snippet },
      selection: { anchor: from + caretOffset }
    })
  }
}

const SLASH_COMMANDS: SlashCommand[] = [
  { label: 'Heading 1', hint: 'Big section title', terms: ['h1', 'heading', 'title'], apply: blockApply('# ') },
  { label: 'Heading 2', hint: 'Medium heading', terms: ['h2', 'heading', 'subtitle'], apply: blockApply('## ') },
  { label: 'Heading 3', hint: 'Small heading', terms: ['h3', 'heading'], apply: blockApply('### ') },
  { label: 'Bulleted list', hint: 'A simple bullet', terms: ['bullet', 'list', 'ul'], apply: blockApply('- ') },
  { label: 'Numbered list', hint: 'Ordered 1. 2. 3.', terms: ['number', 'ordered', 'ol'], apply: blockApply('1. ') },
  { label: 'To-do', hint: 'Checkbox item', terms: ['todo', 'task', 'checkbox'], apply: blockApply('- [ ] ') },
  { label: 'Quote', hint: 'Set off a quote', terms: ['quote', 'blockquote'], apply: blockApply('> ') },
  {
    label: 'Code block',
    hint: 'Fenced code',
    terms: ['code', 'fence'],
    apply: snippetApply('```\n\n```\n', 4)
  },
  { label: 'Divider', hint: 'Horizontal line', terms: ['divider', 'rule', 'hr'], apply: snippetApply('\n---\n', 5) }
]

function slashApply(cmd: SlashCommand): Exclude<Completion['apply'], string | undefined> {
  return (view, _completion, from, to) => cmd.apply(view, from, to)
}

// "/command" at the start of a line or after whitespace
function slashSource(context: CompletionContext): CompletionResult | null {
  const m = context.matchBefore(/(?:^|\s)\/[\w-]*/)
  if (!m) return null
  const slashIdx = m.text.indexOf('/')
  const from = m.from + slashIdx
  const typed = m.text.slice(slashIdx + 1).toLowerCase()
  if (!context.explicit && from === m.from && slashIdx > 0) return null
  const options: Completion[] = SLASH_COMMANDS.filter(
    (c) => !typed || c.label.toLowerCase().includes(typed) || c.terms.some((x) => x.includes(typed))
  ).map((c) => ({ label: c.label, detail: c.hint, type: 'keyword', apply: slashApply(c) }))
  return options.length ? { from, options, filter: false } : null
}

export function completionExtension(): Extension {
  return autocompletion({
    override: [slashSource],
    activateOnTyping: true,
    icons: false,
    closeOnBlur: true,
    defaultKeymap: true
  })
}
