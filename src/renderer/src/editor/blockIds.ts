import { EditorState, type ChangeSpec } from '@codemirror/state'
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import type { SyntaxNode, Tree } from '@lezer/common'
import { blockLabel, frontmatterEnd, indexBlocks, newBlockId, tagOf } from '../../../shared/blocks'
import { toggleMarkdown } from './toggleModel'

// What in a note can be linked to, and the hidden tag that makes a block
// linkable (`[[Waves#^k3x9]]` — the format is in shared/blocks.ts).
//
// Two callers want the same answer: the `[[` picker, listing another note's
// headings and blocks, and the grip's "Copy link to block", asking about the
// line you are on. Both read the SYNTAX TREE rather than counting lines, so
// "where does this list item end" is the parser's answer, the same one the
// editor draws from.
//
// Stage 1 (2026-09-29): headings, paragraphs, list items and quotes. Their tag
// ends their last line. Tables, maths boxes, code blocks and toggles take the
// tag on a line of its own, which needs that line hidden whole — not yet.
//
// Pure — EditorState and the parser, no view — so all of it is unit-tested.
// Hiding the tag on screen is `blockTags.ts`.

export interface LinkTarget {
  kind: 'heading' | 'block'
  /** a heading's text as written — what `[[Note#…]]` names. Null for a block. */
  heading: string | null
  /** what the picker row, and a link to it, reads as */
  label: string
  /** 1-based first line: where following a link lands */
  line: number
  /** the last line that belongs to it (the grip asks "which one am I on?") */
  endLine: number
  /** the line whose end carries the tag */
  tagLine: number
  /** the tag it already has, if any */
  id: string | null
  /** sits under a heading — the picker indents it */
  nested: boolean
  /** a heading's level, 1–6; 0 for a block */
  level: number
}

/** A heading's text, as the heading jump reads it (`CodeEditor`'s effect). */
const HEADING_TEXT = /^#{1,6}\s+(.*)$/

/** A tree for the whole note. The editor parses lazily past what is on screen,
 *  and a picker listing a long note's blocks must see all of them. */
function fullTree(state: EditorState): Tree {
  return ensureSyntaxTree(state, state.doc.length, 500) ?? syntaxTree(state)
}

/** An editor state for a note that isn't open, so a closed note is read by the
 *  same parser as an open one. `EditorState` is pure — no view, no DOM. */
export function stateForText(text: string): EditorState {
  return EditorState.create({
    doc: text,
    extensions: [markdown({ base: markdownLanguage, extensions: [toggleMarkdown] })]
  })
}

/** Every heading and linkable block in the note, top to bottom. */
export function linkTargets(state: EditorState): LinkTarget[] {
  const doc = state.doc
  const out: LinkTarget[] = []
  let nested = false
  // Nothing in a note's frontmatter is linkable (`frontmatterEnd`).
  const fm = frontmatterEnd(doc.toString().split('\n'))
  const fmEnd = fm ? doc.line(fm).to : -1

  const block = (from: number, textTo: number): void => {
    const first = doc.lineAt(from)
    const last = doc.lineAt(textTo)
    // A maths box (`$$` alone on its first line) is a "paragraph" to the parser,
    // which knows no maths — but a tag on its closing `$$` would break the
    // formula. Its tag goes on a line of its own: stage 3.
    if (first.text.trim() === '$$') return
    const tag = tagOf(last.text)
    // A line that is nothing but a tag belongs to the block above it — it is
    // not a block of its own to link to.
    if (tag?.own && first.number === last.number) return
    out.push({
      kind: 'block',
      heading: null,
      label: blockLabel(first.text),
      line: first.number,
      endLine: last.number,
      tagLine: last.number,
      id: tag && !tag.own ? tag.id : null,
      nested,
      level: 0
    })
  }

  const items = (list: SyntaxNode): void => {
    for (let item = list.firstChild; item; item = item.nextSibling) {
      if (item.name !== 'ListItem') continue
      let text: SyntaxNode | null = null
      for (let c = item.firstChild; c && !text; c = c.nextSibling) {
        if (c.name === 'Paragraph' || c.name === 'Task') text = c
      }
      if (text) block(item.from, text.to)
      for (let c = item.firstChild; c; c = c.nextSibling) {
        if (c.name === 'BulletList' || c.name === 'OrderedList') items(c)
      }
    }
  }

  for (let node = fullTree(state).topNode.firstChild; node; node = node.nextSibling) {
    if (node.from <= fmEnd) continue
    const name = node.name
    if (/^ATXHeading\d$/.test(name)) {
      const line = doc.lineAt(node.from)
      const text = HEADING_TEXT.exec(line.text)?.[1].trim()
      // `|` would end the link's target, `]]` the link itself.
      if (text && !text.includes('|') && !text.includes(']]')) {
        out.push({
          kind: 'heading',
          heading: text,
          label: blockLabel(line.text, text),
          line: line.number,
          endLine: line.number,
          tagLine: line.number,
          id: null,
          nested: false,
          level: Number(name.slice(-1))
        })
      }
      nested = true
    } else if (name === 'Paragraph' || name === 'Blockquote') {
      block(node.from, node.to)
    } else if (name === 'BulletList' || name === 'OrderedList') {
      items(node)
    }
  }
  return out
}

/** What the grip on line `n` would link to: the smallest heading or block that
 *  holds it — a list item rather than the whole list. */
export function targetAtLine(state: EditorState, n: number): LinkTarget | null {
  let best: LinkTarget | null = null
  for (const t of linkTargets(state)) {
    if (t.line > n || t.endLine < n) continue
    if (!best || t.endLine - t.line < best.endLine - best.line) best = t
  }
  return best
}

/** The id to link a block by, and the edit that writes its tag when it has
 *  none yet. A heading needs no tag — its text is its address. */
export function tagFor(state: EditorState, t: LinkTarget): { id: string; changes: ChangeSpec | null } {
  if (t.id) return { id: t.id, changes: null }
  const id = newBlockId(indexBlocks(state.doc.toString()).map((b) => b.id))
  const line = state.doc.line(t.tagLine)
  return { id, changes: { from: line.to, insert: ' ^' + id } }
}

/** The `#…` part of a link to it: `^id` for a block; for a heading, see
 *  `headingAnchor`. `targets` is every target in the note. */
export const anchorOf = (targets: LinkTarget[], t: LinkTarget, id: string | null): string =>
  t.kind === 'heading' ? headingAnchor(targets, t) : '^' + id

const sameWords = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase()

/**
 * What a link to heading `t` says after the `#`. Its words, when no other heading
 * in the note shares them. When one does, the words alone would land on the
 * FIRST of them (Reuben, 2026-09-29: a link to a small "testing" heading landed
 * on the big "testing" above it) — so the link names the headings above it too,
 * `[[Note#testing#testing]]`, which is Obsidian's own way to write it.
 *
 * Two headings with the same words under the same parent can't be told apart
 * that way either, in this app or in Obsidian; the link lands on the first.
 */
export function headingAnchor(targets: LinkTarget[], t: LinkTarget): string {
  const heads = targets.filter((x) => x.kind === 'heading')
  if (heads.filter((h) => sameWords(h.heading!, t.heading!)).length <= 1) return t.heading!
  // By LINE, never by object: `t` may come from a different reading of the
  // note than `targets` (the grip's does), and two readings are two sets of
  // objects describing the same headings.
  const at = heads.findIndex((h) => h.line === t.line)
  const chain = [t]
  let level = t.level
  for (let i = at - 1; i >= 0 && level > 1; i--) {
    if (heads[i].level < level) {
      chain.unshift(heads[i])
      level = heads[i].level
    }
  }
  const path = chain.map((h) => h.heading).join('#')
  return findHeading(heads, path)?.line === t.line ? path : t.heading!
}

/**
 * The heading a link's `#…` names, or null. Its exact words first — which is
 * also what keeps a heading like "C# tips" working — and only then as a path:
 * `A#B` is the first heading B anywhere under the first heading A.
 */
export function findHeading(targets: LinkTarget[], anchor: string): LinkTarget | null {
  const heads = targets.filter((x) => x.kind === 'heading')
  const exact = heads.find((h) => sameWords(h.heading!, anchor))
  if (exact) return exact
  const parts = anchor.split('#').filter((p) => p.trim())
  if (parts.length < 2) return null
  let lo = 0
  let hi = heads.length
  let found: LinkTarget | null = null
  for (const part of parts) {
    let k = -1
    for (let i = lo; i < hi && k === -1; i++) if (sameWords(heads[i].heading!, part)) k = i
    if (k === -1) return null
    found = heads[k]
    // The next part has to be inside this heading's section: after it, and
    // before the next heading at its own level or above.
    let end = k + 1
    while (end < hi && heads[end].level > heads[k].level) end++
    lo = k + 1
    hi = end
  }
  return found
}

/** A pasted or dropped COPY of a tagged block loses its tag. Two blocks with one
 *  tag would leave every link to it landing on whichever comes first, and the
 *  one you copied from is the one those links meant. A MOVE keeps its tag — the
 *  block is still the only one — because the check is "does this id now appear
 *  twice", not "was a tag pasted". */
export const dropCopiedTags = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged || !(tr.isUserEvent('input.paste') || tr.isUserEvent('input.drop'))) return tr
  const inserted: { from: number; to: number }[] = []
  tr.changes.iterChanges((_fa, _ta, fromB, toB, text) => {
    if (text.length && text.toString().includes('^')) inserted.push({ from: fromB, to: toB })
  })
  if (!inserted.length) return tr
  const doc = tr.newDoc
  const seen = new Map<string, number>()
  for (const b of indexBlocks(doc.toString())) {
    const k = b.id.toLowerCase()
    seen.set(k, (seen.get(k) ?? 0) + 1)
  }
  const drop: { from: number; to: number }[] = []
  for (const r of inserted) {
    for (let n = doc.lineAt(r.from).number; n <= doc.lineAt(r.to).number; n++) {
      const line = doc.line(n)
      const tag = tagOf(line.text)
      if (!tag || tag.own) continue
      const at = line.from + tag.start
      if (at >= r.from && line.to <= r.to && (seen.get(tag.id.toLowerCase()) ?? 0) > 1) drop.push({ from: at, to: line.to })
    }
  }
  return drop.length ? [tr, { changes: drop, sequential: true }] : tr
})
