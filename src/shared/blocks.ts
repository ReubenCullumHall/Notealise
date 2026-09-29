// Block links: `[[Waves#^k3x9]]`, and the ` ^k3x9` tag at the end of the block it
// points at. Obsidian's syntax, not an invented one (rule 4): Obsidian follows
// these links, and GitHub or VS Code show the tag as a few characters of plain
// text — Reuben's call, 2026-09-29, with that trade put to him.
//
// Shared for the reason `links.ts` is: main reads every note's tags into the link
// index (so a link elsewhere can say which block it points at), and the renderer
// reads the one it is showing. Pure text, no syntax tree — main has none. The
// renderer's tree-based half, which decides WHERE a new tag goes, is
// `renderer/src/editor/blockIds.ts`.
//
//   A wave carries energy. ^k3x9        a paragraph, list item or quote: the tag
//                                        ends the block's last line
//   | a | b |                            a table, maths box or code block: the
//                                        tag sits on its own line under it, after
//   ^k3x9                                a blank line (Obsidian's rule for those)

import { toPlainText } from './plainText'

/** A tag at the end of a line: whitespace (or the line's start), `^`, then
 *  letters, digits and dashes — the characters Obsidian allows. The whitespace
 *  in front is part of the match so that hiding the tag hides it too.
 *
 *  At least three characters, and not only digits: a line ending "E = mc ^2"
 *  or "see note ^1" is somebody's writing, and hiding it as a tag would make
 *  their words vanish (found by the bug check, 2026-09-29). The tags this app
 *  and Obsidian make are six characters, and hand-made ones are words. */
const ID = '(?![0-9]+(?:[ \\t]*$))[A-Za-z0-9-]{3,}'
const TAG_AT_END = new RegExp('(^|[ \\t]+)\\^(' + ID + ')[ \\t]*$')

/** Only the one-line `$$` that opens or closes a maths box, not `$$x$$`. */
const MATH_FENCE = /^\s*\$\$\s*$/
/** Opens or closes a ``` / ~~~ block (same test as `links.ts`). */
const FENCE = /^\s{0,3}(`{3,}|~{3,})/
const LIST_ITEM = /^\s*(?:[-*+]|\d{1,9}[.)])(?:\s|$)/
const HEADING = /^\s{0,3}#{1,6}(?:\s|$)/
const TABLE_ROW = /^\s*\|/

/** The id in `^k3x9`, when a link's `#…` part is a block rather than a heading. */
export function blockIdOf(heading: string | null): string | null {
  if (!heading || heading[0] !== '^') return null
  const id = heading.slice(1).trim()
  return new RegExp('^' + ID + '$').test(id) ? id : null
}

/** The tag ending `line`, if it has one. `start` is where the hidden part begins
 *  — the ONE space right before the `^`, however many there are; `own` is true
 *  when the tag is the whole line.
 *
 *  One space, not the whole run: a space typed at the end of a tagged line
 *  lands right beside the tag's own, and if the hidden part grew to take it in,
 *  the cursor would be inside what's hidden and the next word typed would land
 *  AFTER the tag (found by the stress test, 2026-09-29). */
export function tagOf(line: string): { id: string; start: number; own: boolean } | null {
  const m = TAG_AT_END.exec(line)
  if (!m) return null
  const own = line.slice(0, m.index).trim() === ''
  return { id: m[2], start: own ? 0 : m.index + m[1].length - 1, own }
}

/** A new tag that isn't already used in the note. Six lowercase letters and
 *  digits, the shape Obsidian itself generates. */
export function newBlockId(taken: Iterable<string>, rand: () => number = Math.random): string {
  const used = new Set([...taken].map((t) => t.toLowerCase()))
  const abc = 'abcdefghijklmnopqrstuvwxyz0123456789'
  for (;;) {
    let id = ''
    for (let i = 0; i < 6; i++) id += abc[Math.floor(rand() * abc.length)]
    if (!used.has(id)) return id
  }
}

/** How much of a block a link shows: enough to recognise it by. */
const LABEL_MAX = 48

/** What a link to this block reads as — the first words of it, as a reader sees
 *  them. `fallback` is for a block with no words (a picture on its own). */
export function blockLabel(line: string, fallback = 'Block'): string {
  const plain = toPlainText(line).replace(/\s+/g, ' ').trim()
  if (!plain) return /!\[/.test(line) ? 'Picture' : fallback
  return plain.length <= LABEL_MAX ? plain : plain.slice(0, LABEL_MAX - 1).trimEnd() + '…'
}

/** One tagged block, as the link index remembers it. */
export interface BlockInfo {
  id: string
  /** 1-based line the block starts on — where following a link lands */
  line: number
  /** what a link to it shows after the note's name */
  label: string
}

/**
 * Every tagged block in a note. Lines inside a code block or a maths box are
 * never tags — `^x` is perfectly good LaTeX — but a tag on its own line straight
 * after one of them names that block.
 */
export function indexBlocks(text: string): BlockInfo[] {
  // `\r?\n`: main reads the file as it is on disk, and a note written on
  // Windows ends every line in CRLF. Split on `\n` alone, each line would keep
  // its `\r` and no tag would ever be found at a line's end.
  const lines = text.split(/\r?\n/)
  const out: BlockInfo[] = []
  // Where each code block / maths box that has closed began, keyed by the line
  // it closed on — what an own-line tag under it needs to find its start.
  const openedAt = new Map<number, { line: number; kind: 'code' | 'maths' }>()
  let fence: { mark: string; line: number } | null = null
  let maths: number | null = null

  for (let i = frontmatterEnd(lines); i < lines.length; i++) {
    const line = lines[i]
    const f = FENCE.exec(line)
    if (fence) {
      if (f && f[1][0] === fence.mark[0] && f[1].length >= fence.mark.length) {
        openedAt.set(i, { line: fence.line, kind: 'code' })
        fence = null
      }
      continue
    }
    if (maths !== null) {
      if (MATH_FENCE.test(line)) {
        openedAt.set(i, { line: maths, kind: 'maths' })
        maths = null
      }
      continue
    }
    if (f) {
      fence = { mark: f[1], line: i }
      continue
    }
    if (MATH_FENCE.test(line)) {
      maths = i
      continue
    }
    const tag = tagOf(line)
    if (!tag) continue
    if (!tag.own) {
      const start = paragraphStart(lines, i)
      out.push({ id: tag.id, line: start + 1, label: blockLabel(lines[start]) })
      continue
    }
    // On its own line: it names the block above it, across blank lines.
    let above = i - 1
    while (above >= 0 && lines[above].trim() === '') above--
    if (above < 0) continue
    const code = openedAt.get(above)
    if (code) {
      out.push({ id: tag.id, line: code.line + 1, label: code.kind === 'code' ? 'Code block' : 'Formula' })
    } else if (TABLE_ROW.test(lines[above])) {
      let top = above
      while (top > 0 && TABLE_ROW.test(lines[top - 1])) top--
      out.push({ id: tag.id, line: top + 1, label: 'Table' })
    } else {
      const start = paragraphStart(lines, above)
      out.push({ id: tag.id, line: start + 1, label: blockLabel(lines[start]) })
    }
  }
  return out
}

/** The first line after a note's frontmatter (the `---` block of settings at
 *  the very top some apps write), or 0 when it has none. Nothing in there is
 *  a paragraph, and a tag written into it would break the settings. */
export function frontmatterEnd(lines: string[]): number {
  if (lines[0]?.trim() !== '---') return 0
  for (let i = 1; i < lines.length; i++) if (/^(---|\.\.\.)\s*$/.test(lines[i])) return i + 1
  return 0
}

/** The first line of the paragraph (or list item) that line `i` belongs to. */
function paragraphStart(lines: string[], i: number): number {
  let start = i
  while (start > 0 && !LIST_ITEM.test(lines[start])) {
    const prev = lines[start - 1]
    if (prev.trim() === '' || HEADING.test(prev) || FENCE.test(prev) || MATH_FENCE.test(prev)) break
    start--
  }
  return start
}

/** Every heading's words in a note, as a heading link names them (outside code,
 *  maths and frontmatter). The link index carries them so a link written as a
 *  path of headings — `[[Note#testing#testing]]`, for two headings with the
 *  same words — can be shown as just the one it lands on, while a heading that
 *  really has a `#` in it ("C# tips") is still shown whole. */
export function indexHeadings(text: string): string[] {
  const lines = text.split(/\r?\n/)
  const out: string[] = []
  let fence: string | null = null
  let maths = false
  for (let i = frontmatterEnd(lines); i < lines.length; i++) {
    const line = lines[i]
    const f = FENCE.exec(line)
    if (fence) {
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length) fence = null
      continue
    }
    if (f) {
      fence = f[1]
      continue
    }
    if (MATH_FENCE.test(line)) {
      maths = !maths
      continue
    }
    if (maths) continue
    const m = /^#{1,6}\s+(.*)$/.exec(line)
    if (m && m[1].trim()) out.push(m[1].trim())
  }
  return out
}

/** What a heading link's `#…` shows. A path of headings (`testing#testing`)
 *  shows the last one — the one it lands on — the way a folder path shows only
 *  the note. `known` is the target note's headings; without them, or when the
 *  words are a real heading of their own, the words show whole. */
export function headingShown(heading: string, known: readonly string[] | undefined): string {
  const parts = heading.split('#').filter((p) => p.trim())
  if (parts.length < 2 || !known) return heading
  const want = heading.trim().toLowerCase()
  if (known.some((h) => h.toLowerCase() === want)) return heading
  return parts[parts.length - 1].trim()
}

/** The 1-based line a link to `id` should land on, or null when no block in the
 *  note carries that tag any more. */
export function blockLineOf(text: string, id: string): number | null {
  const want = id.toLowerCase()
  return indexBlocks(text).find((b) => b.id.toLowerCase() === want)?.line ?? null
}
