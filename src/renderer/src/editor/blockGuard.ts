import { EditorSelection, EditorState, Prec, RangeSetBuilder, type Extension, type Text } from '@codemirror/state'
import { syntaxTree } from '@codemirror/language'
import { Decoration, EditorView, keymap, type DecorationSet } from '@codemirror/view'
import { isRaw } from './rawView'
import { findTranscript } from '../../../shared/transcript'

// No cursor on a block's own line (Reuben, 2026-11-07: "for any mathematic blocks and for any
// audio blocks and any bigger blocks other than just headings and actual ones where you type,
// that includes tables as well. Get rid of the ability to have a cursor there"). A voice note,
// a picture or video alone on its line, and a table are one thing on screen with source text
// underneath; a cursor resting beside one types onto its line — `test<audio …>` — and a click
// after those words then lands beyond the player. Maths blocks have had this since 2026-09-27
// (blockMath.ts); this is the same contract for the rest:
//
//   • the cursor can't rest on a block's lines — it steps from the end of the line above
//     straight to the start of the line below (atomic ranges);
//   • Enter is an ordinary Enter everywhere: on the empty line above a block it makes a new line
//     there and everything below moves down (Reuben, 2026-11-07, replacing a first version that
//     jumped the cursor to the line below the block instead);
//   • Backspace from the line below / Delete from the line above never join a line onto a
//     block: on a blank line they remove just that line, otherwise they pick the block, so
//     the next press deletes it the way its six dots do;
//   • typing at the very start or end of a note, beside a block that sits there, goes onto a
//     line of its own.
//
// The block's own controls — a voice note's name, a table's cells, the maths box — are the
// widgets' own and work as before. Markdown pro shows the source, so none of this applies there.

/** An embed the app draws as a block: a voice note, a picture, a video (attachSelect.ts). */
const EMBED = /!\[[^\]\n]*\]\([^)\n]*\)|<video\b[^>\n]*>\s*<\/video>|<audio\b[^>\n]*>\s*<\/audio>/gi

/** Where the embeds that END a line begin, or null: the whole line when it holds only embeds,
 *  or just the tail of one where words come first (`test<audio …>`, written before this). */
export function embedTailStart(text: string): number | null {
  let start: number | null = null
  let end = 0
  EMBED.lastIndex = 0
  for (let m = EMBED.exec(text); m; m = EMBED.exec(text)) {
    const between = text.slice(end, m.index)
    if (start === null || between.trim() !== '') start = m.index
    end = m.index + m[0].length
  }
  if (start === null || text.slice(end).trim() !== '') return null
  return start
}

export interface GuardedBlock {
  /** the block's first position (its line's start, or where a trailing embed starts) */
  from: number
  /** the end of its last line */
  to: number
  /** words before it on its line (an old `test<audio …>` line) — that line stays typeable up to it */
  afterText: boolean
}

/** Every block the cursor must stay off, top to bottom. */
export function guardedBlocks(state: EditorState): GuardedBlock[] {
  if (isRaw(state)) return []
  const doc = state.doc
  const out: GuardedBlock[] = []
  let lines: string[] | null = null
  for (let n = 1; n <= doc.lines; n++) {
    const line = doc.line(n)
    if (!/[<!]/.test(line.text)) continue
    const start = embedTailStart(line.text)
    if (start === null) continue
    const afterText = line.text.slice(0, start).trim() !== ''
    // A voice note's transcript, straight under it, is part of the block (transcriptFold.ts).
    let to = line.to
    if (n < doc.lines && /^<details\s+data-transcript\s*=/i.test(doc.line(n + 1).text)) {
      lines ??= doc.toString().split('\n')
      const t = findTranscript(lines, n - 1)
      if (t) {
        to = doc.line(t.close + 1).to
        n = t.close + 1
      }
    }
    out.push({ from: line.from + start, to, afterText })
  }
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name === 'Table') {
        const first = doc.lineAt(node.from)
        let last = doc.lineAt(node.to)
        while (last.number > first.number && last.text.trim() === '') last = doc.line(last.number - 1)
        out.push({ from: first.from, to: last.to, afterText: false })
        return false
      }
      // Tables only live at the top level or in quotes/lists; skip the rest quickly.
      return node.name === 'Document' || node.name === 'Blockquote' || node.name === 'BulletList' || node.name === 'OrderedList' || node.name === 'ListItem'
    }
  })
  return out.sort((a, b) => a.from - b.from)
}

/** The stretch the cursor may not rest INSIDE: from the end of the line above (or the end of
 *  the words before it) to the start of the line below. Both ends are places to type. */
export function guardOf(doc: Text, b: GuardedBlock): { from: number; to: number } {
  const first = doc.lineAt(b.from)
  const last = doc.lineAt(b.to)
  const from = b.afterText ? b.from : first.number > 1 ? first.from - 1 : 0
  const to = last.number < doc.lines ? last.to + 1 : last.to
  return { from, to }
}

const cache = new WeakMap<Text, { tree: unknown; raw: boolean; blocks: GuardedBlock[] }>()
function blocksOf(state: EditorState): GuardedBlock[] {
  const tree = syntaxTree(state)
  const raw = isRaw(state)
  const hit = cache.get(state.doc)
  if (hit && hit.tree === tree && hit.raw === raw) return hit.blocks
  const blocks = guardedBlocks(state)
  cache.set(state.doc, { tree, raw, blocks })
  return blocks
}

const ATOM = Decoration.mark({})
const guardAtomic = EditorView.atomicRanges.of((view): DecorationSet => {
  const blocks = blocksOf(view.state)
  if (!blocks.length) return Decoration.none
  const out = new RangeSetBuilder<Decoration>()
  let prev = -1
  for (const b of blocks) {
    const g = guardOf(view.state.doc, b)
    const from = Math.max(g.from, prev)
    if (g.to > from) out.add(from, g.to, ATOM)
    prev = Math.max(prev, g.to)
  }
  return out.finish()
})

/** The block whose guard edge a lone cursor sits on, on the side the key reaches towards. */
function blockBeside(state: EditorState, forward: boolean): GuardedBlock | null {
  if (state.selection.ranges.length > 1 || !state.selection.main.empty) return null
  const head = state.selection.main.head
  for (const b of blocksOf(state)) {
    const g = guardOf(state.doc, b)
    if (forward ? head === g.from : head === g.to) return b
  }
  return null
}

/** Pick the block as one thing (the way its six dots do): a voice note or picture by its own
 *  span, so Backspace then deletes it the usual way; a table by its lines. */
function pick(view: EditorView, b: GuardedBlock): void {
  view.dispatch({ selection: EditorSelection.single(b.from, b.to), scrollIntoView: true, userEvent: 'select.pick' })
}

export function backspace(view: EditorView): boolean {
  const { state } = view
  const b = blockBeside(state, false)
  if (!b) return false
  const doc = state.doc
  const below = doc.lineAt(state.selection.main.head)
  if (below.length === 0 && below.number > doc.lineAt(b.to).number) {
    // A blank line under the block: remove just that line.
    const del = below.number < doc.lines ? { from: below.from, to: below.from + 1 } : { from: below.from - 1, to: below.from }
    view.dispatch({ changes: del, selection: { anchor: Math.min(del.from, doc.length) }, userEvent: 'delete.backward' })
    return true
  }
  pick(view, b)
  return true
}

export function del(view: EditorView): boolean {
  const { state } = view
  const b = blockBeside(state, true)
  if (!b) return false
  const doc = state.doc
  const above = doc.lineAt(state.selection.main.head)
  if (!b.afterText && above.length === 0 && above.number < doc.lineAt(b.from).number) {
    // A blank line over the block: remove just that line.
    const d = above.number > 1 ? { from: above.from - 1, to: above.from } : { from: 0, to: 1 }
    view.dispatch({ changes: d, selection: { anchor: d.from }, userEvent: 'delete.forward' })
    return true
  }
  pick(view, b)
  return true
}

// Typing at the note's very start or end, beside a block that sits there, would go onto the
// block's own line (the guard has nowhere else to put the cursor).
const guardTyping = EditorView.inputHandler.of((view, from, to, text) => {
  if (from !== to) return false
  const doc = view.state.doc
  // The browser can't put its caret after a block at the very end of the note, so typing there
  // arrives as typing on the line above it; the editor's own cursor says where it really is
  // (found 2026-11-07: a letter typed after a closing voice note or table landed above it).
  const sel = view.state.selection.main
  const atEnd = from === doc.length || (sel.empty && sel.head === doc.length)
  for (const b of blocksOf(view.state)) {
    const g = guardOf(doc, b)
    if (from === 0 && g.from === 0 && !b.afterText) {
      view.dispatch({ changes: { from: 0, insert: text + '\n' }, selection: { anchor: text.length }, userEvent: 'input.type' })
      return true
    }
    if (atEnd && g.to === doc.length) {
      const at = doc.length
      view.dispatch({ changes: { from: at, insert: '\n' + text }, selection: { anchor: at + 1 + text.length }, userEvent: 'input.type' })
      return true
    }
  }
  return false
})

// A click past the words on an old `test<audio …>` line lands at the line's end, beyond the
// player (Reuben, 2026-11-07: "it appears on the cursor to the far right of the audio bar"). The
// end of the words is where he meant: the cursor goes there, however it arrived.
const guardOldLines = EditorState.transactionFilter.of((tr) => {
  if (!tr.selection || tr.docChanged) return tr
  const sel = tr.selection
  if (sel.ranges.length !== 1 || !sel.main.empty) return tr
  const head = sel.main.head
  for (const b of blocksOf(tr.state)) {
    if (!b.afterText) continue
    if (head > b.from && head <= tr.state.doc.lineAt(b.from).to) {
      return [tr, { selection: EditorSelection.cursor(b.from), sequential: true }]
    }
  }
  return tr
})

/** A selection made with the pointer takes a block whole or not at all. A double-click on the
 *  space above a voice note (still its own row) selected the `<` its line starts with, and the
 *  voice note opened up to show its code (Reuben, 2026-11-07: "make sure the code hides behind
 *  the voicenote"); a drag that stopped part-way into one would copy half its text. Any part
 *  of a block in the selection brings the rest of it. */
export function wholeBlocks(state: EditorState, sel: EditorSelection): EditorSelection | null {
  const blocks = blocksOf(state)
  if (!blocks.length) return null
  let changed = false
  const ranges = sel.ranges.map((r) => {
    if (r.empty) return r
    let from = r.from
    let to = r.to
    for (const b of blocks) {
      if (from < b.to && to > b.from && (from > b.from || to < b.to)) {
        from = Math.min(from, b.from)
        to = Math.max(to, b.to)
      }
    }
    if (from === r.from && to === r.to) return r
    changed = true
    return r.anchor <= r.head ? EditorSelection.range(from, to) : EditorSelection.range(to, from)
  })
  return changed ? EditorSelection.create(ranges, sel.mainIndex) : null
}

const guardPointer = EditorState.transactionFilter.of((tr) => {
  if (!tr.selection || tr.docChanged || !tr.isUserEvent('select.pointer')) return tr
  const whole = wholeBlocks(tr.state, tr.selection)
  return whole ? [tr, { selection: whole, sequential: true }] : tr
})

export const blockGuard: Extension = [
  guardAtomic,
  guardOldLines,
  guardPointer,
  // Highest: markdown() binds Backspace at high precedence and would answer first.
  Prec.highest(
    keymap.of([
      { key: 'Backspace', run: backspace },
      { key: 'Delete', run: del }
    ])
  ),
  guardTyping
]
