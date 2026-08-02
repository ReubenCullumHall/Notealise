import {
  autocompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult
} from '@codemirror/autocomplete'
import type { Extension } from '@codemirror/state'
import { matchesQuery, SLASH_COMMANDS } from './commands'
import { linkEnv } from './linkEnv'
import { linkChoices } from '../links/model'

// The editor's two completion menus. Both are thin: neither owns a list.
//
//   "/"   → the command registry in commands.tsx
//   "[["  → the notes in the vault, via the linkEnv StateField
//
// This file used to carry a SLASH_COMMANDS array of its own — a second, slightly
// different implementation of nine commands the format bar already had. See the
// header of commands.tsx for why that is gone and must not come back.

/** "/command" at the start of a line or after whitespace. */
function slashSource(context: CompletionContext): CompletionResult | null {
  const m = context.matchBefore(/(?:^|\s)\/[\w-]*/)
  if (!m) return null
  const slashIdx = m.text.indexOf('/')
  const from = m.from + slashIdx
  const typed = m.text.slice(slashIdx + 1).toLowerCase()
  const options: Completion[] = SLASH_COMMANDS.filter((c) => matchesQuery(c, typed)).map((c) => ({
    label: c.label,
    detail: c.hint,
    type: 'keyword',
    // The command deletes the "/query" itself — it has to, because every command
    // acts on the current selection and would otherwise format the text the user
    // typed to summon it.
    apply: (view, _completion, cFrom, cTo) => c.run(view, { from: cFrom, to: cTo })
  }))
  // `filter: false`: the matching above is ours (labels AND the extra terms, so
  // "ul" finds Bulleted list), and CodeMirror's own filter would then discard
  // everything whose label doesn't literally contain the query.
  return options.length ? { from, options, filter: false } : null
}

/**
 * "[[" — the notes and folders you can link to. This is what makes `/link` a
 * picker without anything having to build one: the wikiLink command inserts
 * `[[]]` and puts the cursor between the brackets, which is precisely the state
 * this source fires on. Typing `[[` by hand gets the same menu, which is the
 * point.
 *
 * **Scoped to the space you're writing in**, with the space's own name as the
 * way out — see `linkChoices`. A picker that listed every note in every space
 * would undo the division the moment you went to link something.
 */
function wikiSource(context: CompletionContext): CompletionResult | null {
  // Up to the cursor, no closing brackets and no line break: a link never spans
  // a line, and matching past a `]]` would keep the menu open after the link is
  // finished.
  const m = context.matchBefore(/\[\[[^\]\n]*/)
  if (!m) return null
  const env = context.state.field(linkEnv, false)
  if (!env || env.notes.length === 0) return null
  const typed = m.text.slice(2)
  // An alias or a heading has been started — the target is already chosen, and
  // offering to replace it would fight the user mid-sentence.
  if (typed.includes('|') || typed.includes('#')) return null

  const options: Completion[] = linkChoices(env.notes, env.spaces, env.path, typed)
    .slice(0, MAX_HITS)
    .map((c) => ({
      label: c.ref.title,
      // The row's quiet second column is the SPACE, pushed to the right-hand
      // edge under a "Space" heading — see `spaceColumn` below. It used to be
      // the raw parent folder, which on a vault whose space is called "New
      // folder" read as an offer to create one; and the space is the thing
      // worth knowing here, because it is what decides whether a bare title
      // will find this at all.
      space: (c.spaceEmoji ? c.spaceEmoji + ' ' : '') + c.space,
      // CodeMirror's own icon classes: `type` becomes `cm-completionIcon-<type>`,
      // which app.css draws as a folder or a page.
      type: c.ref.kind === 'dir' ? 'folder' : 'note',
      apply: c.insert
    }))
  return options.length ? { from: m.from + 2, options, filter: false } : null
}

/** Enough to choose from without the popup becoming a file browser. */
const MAX_HITS = 14

/** The right-hand column of a `[[` row. A rendered element rather than
 *  CodeMirror's own `detail`, because `detail` sits immediately after the label
 *  and this has to sit against the far edge, under its heading. */
const spaceColumn = {
  render(completion: Completion): HTMLElement | null {
    const space = (completion as Completion & { space?: string }).space
    if (!space) return null // the "/" menu's rows have no space
    const el = document.createElement('span')
    el.className = 'cm-wiki-space'
    el.textContent = space
    return el
  },
  // After the label; the CSS pushes it the rest of the way with margin-left:auto.
  position: 90
}

export function completionExtension(): Extension {
  return autocompletion({
    override: [slashSource, wikiSource],
    addToOptions: [spaceColumn],
    // Marks the popup as the note picker so it can wear the Content / Space
    // headings. The "/" menu is one column and needs neither.
    tooltipClass: (state) => {
      const m = state.selection.main
      const line = state.doc.lineAt(m.head)
      return /\[\[[^\]\n]*$/.test(line.text.slice(0, m.head - line.from)) ? 'cm-wiki-menu' : ''
    },
    activateOnTyping: true,
    // The [[ menu shows a folder/page icon per row, so icons stay ON; the "/"
    // menu's rows are all commands and its glyph column would be empty.
    icons: true,
    closeOnBlur: true,
    defaultKeymap: true
  })
}
