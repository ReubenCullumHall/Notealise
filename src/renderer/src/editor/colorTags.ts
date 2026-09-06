import { syntaxTree } from '@codemirror/language'
import type { EditorState } from '@codemirror/state'
import { Decoration } from '@codemirror/view'
import { COLOR_NAMES } from './palette'

// Where a colour/highlight tag pair IS, in the document.
//
// Three things need this and they must agree: `livePreview`'s `colorPass`
// (which hides the tags and styles what's between them), the empty-pair cleanup,
// and Backspace/Delete at a tag's edge — both in `colorCommands.ts`. Two
// definitions of "this is a colour tag" would mean the editor concealing
// something the keyboard can't act on, which is the worst possible split now
// that the tags are never shown (see livePreview's colorPass).
//
// Located in the SYNTAX TREE, never a regex over the document — nested and
// escaped markdown break a regex, and `@lezer/markdown` already models it. The
// regexes below only ever test the text of a single `HTMLTag` node the tree has
// already isolated, which is a different and much smaller job.

const decoCache = new Map<string, Decoration>()
const classMark = (cls: string): Decoration => {
  const key = 'c:' + cls
  let d = decoCache.get(key)
  if (!d) {
    d = Decoration.mark({ class: cls })
    decoCache.set(key, d)
  }
  return d
}
const styleMark = (style: string): Decoration => {
  const key = 's:' + style
  let d = decoCache.get(key)
  if (!d) {
    // hex-pinned upstream, so nothing arbitrary reaches the DOM as CSS
    d = Decoration.mark({ attributes: { style } })
    decoCache.set(key, d)
  }
  return d
}

const OPEN_CLASS = /^<(mark|span) class="(hl|tc)-([a-z]+)">$/
const OPEN_COLOR = /^<span style="color: *(#[0-9a-fA-F]{3,8}) *;?">$/
// `<mark …>` accepted since 2026-09-05, when the picker gained custom colours
// (Reuben: "the same preset colours and a custom hex colour interface").
// `<span …>` stays because that is the legacy inline-style form old notes carry
// — and because it is what the Word/Notion importers may have produced. A
// custom highlight WRITTEN by this app is always `<mark>`, matching the named
// form beside it, so the two layers keep using the tag that means them
// (colorModel.ts's `recolor`).
const OPEN_BG = /^<(mark|span) style="background-color: *(#[0-9a-fA-F]{3,8}) *;?">$/

/** Recognise a colour opening tag → the tag name + the decoration for its
 *  content. Both this app's palette classes and the inline-style form a custom
 *  colour takes (and old notes still carry). */
export function detectColorOpen(text: string): { tag: 'mark' | 'span'; deco: Decoration } | null {
  let m = OPEN_CLASS.exec(text)
  if (m) {
    const [, tag, variant, colour] = m
    const ok =
      ((tag === 'mark' && variant === 'hl') || (tag === 'span' && variant === 'tc')) &&
      COLOR_NAMES.has(colour)
    return ok ? { tag: tag as 'mark' | 'span', deco: classMark(`${variant}-${colour}`) } : null
  }
  m = OPEN_COLOR.exec(text)
  if (m) return { tag: 'span', deco: styleMark(`color:${m[1]}`) }
  m = OPEN_BG.exec(text)
  if (m) return { tag: m[1] as 'mark' | 'span', deco: styleMark(`background-color:${m[2]}`) }
  return null
}

/** How far either side of an edit to look for the pair it belongs to. A colour
 *  span is an inline construct — a few words, not a chapter — so this is
 *  generous, while still keeping the per-keystroke cost off a 10k-line note. */
export const SCAN = 4000

/** A matched `<mark …>…</mark>` / `<span …>…</span>`, by position. */
export interface ColorPair {
  /** the decoration for the content between the tags */
  deco: Decoration
  openFrom: number
  openTo: number
  closeFrom: number
  closeTo: number
}

/** Whether the pair wraps nothing at all — what a note is left holding when the
 *  last character inside a highlight is deleted. */
export const isEmptyPair = (p: ColorPair): boolean => p.closeFrom === p.openTo

/** Every complete colour pair found in `[from, to)`, innermost-first as they
 *  close. A stack, so nesting (a highlight inside a text colour) pairs up
 *  correctly rather than matching the first close tag it meets. */
export function colorPairs(state: EditorState, from: number, to: number): ColorPair[] {
  const doc = state.doc
  const out: ColorPair[] = []
  const stack: { tag: string; deco: Decoration; openFrom: number; openTo: number }[] = []
  syntaxTree(state).iterate({
    from,
    to,
    enter: (node) => {
      if (node.name !== 'HTMLTag') return
      const text = doc.sliceString(node.from, node.to)
      const open = detectColorOpen(text)
      if (open) {
        stack.push({ tag: open.tag, deco: open.deco, openFrom: node.from, openTo: node.to })
        return
      }
      if (text !== '</mark>' && text !== '</span>') return
      const tag = text === '</mark>' ? 'mark' : 'span'
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].tag !== tag) continue
        const o = stack[i]
        stack.splice(i, 1)
        out.push({
          deco: o.deco,
          openFrom: o.openFrom,
          openTo: o.openTo,
          closeFrom: node.from,
          closeTo: node.to
        })
        break
      }
    }
  })
  return out
}

/** The pair whose OPEN tag ends at `pos`, or whose CLOSE tag ends at `pos` —
 *  i.e. the tag a Backspace at `pos` is about to eat. `dir: 1` asks the same
 *  question for Delete, where the tag begins at `pos` instead.
 *
 *  Scanned over a window around the cursor rather than the whole document: a
 *  colour span is an inline construct, and parsing a 10k-line note to answer a
 *  single keypress is not worth it. */
export function pairAtEdge(state: EditorState, pos: number, dir: -1 | 1): ColorPair | null {
  const from = Math.max(0, pos - SCAN)
  const to = Math.min(state.doc.length, pos + SCAN)
  for (const p of colorPairs(state, from, to)) {
    if (dir === -1 && (p.openTo === pos || p.closeTo === pos)) return p
    if (dir === 1 && (p.openFrom === pos || p.closeFrom === pos)) return p
  }
  return null
}
