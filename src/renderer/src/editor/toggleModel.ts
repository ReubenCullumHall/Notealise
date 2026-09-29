import type { EditorState, Text } from '@codemirror/state'
import { syntaxTree } from '@codemirror/language'
import type { MarkdownConfig } from '@lezer/markdown'

// Toggle lists — the storage format and the pure arithmetic over it.
//
// A toggle is written as the HTML `<details>` element, which is what GitHub,
// VS Code and Notion's own HTML export use for exactly this (CLAUDE.md rule 4:
// where Markdown has no syntax, use inline HTML, never an invented delimiter):
//
//   <details open><summary>Title</summary>
//                                          <- blank: lets GitHub read the body as Markdown
//   anything at all — headings, lists, tables, maths, colour
//                                          <- blank: the same, at the other end
//   </details>
//                                          <- blank (optional): keeps the next line out of it
//
// The blank lines are not decoration. CommonMark ends an HTML block at the first
// blank line, so without them GitHub prints the body as raw text. This app
// hides all three, so nobody editing here ever sees them.
//
// Open or shut is the `open` attribute, IN THE FILE. It is the one standard way
// to say it, it travels with the note to the other machine, and GitHub shows the
// toggle the way it was left. The cost: opening one changes the file.
//
// Only the one-line `<details…><summary>…</summary>` form this app writes is
// drawn as a toggle. Other layouts (the summary on its own line, attributes)
// stay as they are, as HTML source — never rewritten.
//
// This file is state-only (no EditorView value import), so the arithmetic is
// tested against a bare EditorState, the same split as formatCommands.ts.

export const OPEN_PREFIX = '<details open><summary>'
export const SHUT_PREFIX = '<details><summary>'
export const SUFFIX = '</summary>'
export const END = '</details>'

const SUMMARY_RE = /^<details( open)?><summary>(.*)<\/summary>[ \t]*$/
const END_RE = /^<\/details>[ \t]*$/

/** A line that is part of a toggle's markup: its title line or its end line.
 *  Block commands (headings, lists) leave these alone — a `- ` in front of
 *  `</details>` would end the toggle in the middle of nowhere. */
export function isToggleMarkup(line: string): boolean {
  return SUMMARY_RE.test(line) || END_RE.test(line)
}

/** The text of a whole toggle. The body always has at least one line — an open
 *  toggle with nothing inside still needs a line to type into. */
export function toggleText(title: string, body: string[], open: boolean, br = '\n'): string {
  const lines = body.length ? body : ['']
  return (open ? OPEN_PREFIX : SHUT_PREFIX) + title + SUFFIX + br + br + lines.join(br) + br + br + END
}

// ---------------------------------------------------------------------------
// The parser extension. The title line gets its own node so the title's own
// text is parsed as Markdown: bold, colour, maths and links all work in it. As
// a plain HTML block it would be one opaque node, and nothing inside it would
// be styled. `</details>` gets one too, so a line written straight under it is
// read as its own paragraph rather than swallowed into an HTML block.
//
// Top level only, and never indented: a toggle inside a list or a quote would
// need that container's markers on every hidden line, which is a different
// feature.
// ---------------------------------------------------------------------------

export const toggleMarkdown: MarkdownConfig = {
  defineNodes: [{ name: 'ToggleSummary', block: true }, 'ToggleMark', { name: 'ToggleEnd', block: true }],
  parseBlock: [
    {
      name: 'ToggleSummary',
      before: 'HTMLBlock',
      parse(cx, line) {
        if (cx.parentType().name !== 'Document' || line.pos !== 0) return false
        const m = SUMMARY_RE.exec(line.text)
        if (!m) return false
        const from = cx.lineStart
        const prefix = m[1] ? OPEN_PREFIX.length : SHUT_PREFIX.length
        const titleEnd = prefix + m[2].length
        cx.addElement(
          cx.elt('ToggleSummary', from, from + line.text.length, [
            cx.elt('ToggleMark', from, from + prefix),
            ...cx.parser.parseInline(m[2], from + prefix),
            cx.elt('ToggleMark', from + titleEnd, from + titleEnd + SUFFIX.length)
          ])
        )
        cx.nextLine()
        return true
      }
    },
    {
      name: 'ToggleEnd',
      before: 'HTMLBlock',
      parse(cx, line) {
        if (cx.parentType().name !== 'Document' || line.pos !== 0 || !END_RE.test(line.text)) return false
        cx.addElement(cx.elt('ToggleEnd', cx.lineStart, cx.lineStart + line.text.length))
        cx.nextLine()
        return true
      }
    }
  ]
}

// ---------------------------------------------------------------------------
// Finding toggles.
// ---------------------------------------------------------------------------

export interface Toggle {
  /** start of the title line */
  from: number
  titleLine: number
  /** where the title's own text starts (after `<details…><summary>`) */
  prefixEnd: number
  /** where it ends (before `</summary>`) */
  titleEnd: number
  /** end of the title line */
  lineEnd: number
  open: boolean
  /** the lines you write in, or null when there are none */
  body: { first: number; last: number } | null
  /** the `</details>` line */
  endLine: number
  /** the last hidden line after the body: `endLine`, or the blank line after it */
  tailLine: number
  /** how many toggles this one sits inside */
  depth: number
  parent: Toggle | null
  /** some toggle it sits inside is shut, so none of it is on screen */
  hidden: boolean
}

const blank = (doc: Text, n: number): boolean => doc.line(n).text.trim() === ''

/** Every toggle in the note, outer ones before the ones inside them. Read from
 *  the syntax tree, so a `<details>` inside a code block is never one. */
export function findToggles(state: EditorState): Toggle[] {
  const doc = state.doc
  const tree = syntaxTree(state)
  const out: Toggle[] = []
  type Open = { from: number; to: number; parent: Open | null; made?: Toggle }
  const stack: Open[] = []
  const made: { t: Toggle; entry: Open }[] = []

  const cur = tree.cursor()
  if (!cur.firstChild()) return out
  do {
    if (cur.name === 'ToggleSummary') {
      stack.push({ from: cur.from, to: cur.to, parent: stack[stack.length - 1] ?? null })
    } else if (cur.name === 'ToggleEnd') {
      const entry = stack.pop()
      if (!entry) continue // a stray </details>: left as the text it is
      const t = build(doc, entry.from, cur.from)
      entry.made = t
      made.push({ t, entry })
    }
  } while (cur.nextSibling())

  // Parents are only known once every pair is matched: an unmatched outer
  // `<details>` is not a toggle, so what it contains is not inside one.
  for (const { t, entry } of made) {
    let p = entry.parent
    while (p && !p.made) p = p.parent
    t.parent = p?.made ?? null
  }
  made.sort((a, b) => a.t.from - b.t.from)
  for (const { t } of made) {
    t.depth = t.parent ? t.parent.depth + 1 : 0
    t.hidden = !!t.parent && (t.parent.hidden || !t.parent.open)
    out.push(t)
  }
  return out
}

function build(doc: Text, from: number, endFrom: number): Toggle {
  const title = doc.lineAt(from)
  const m = SUMMARY_RE.exec(title.text)!
  const open = !!m[1]
  const prefixEnd = from + (open ? OPEN_PREFIX.length : SHUT_PREFIX.length)
  const titleEnd = prefixEnd + m[2].length
  const endLine = doc.lineAt(endFrom).number
  const a = title.number
  const top = a + 1 < endLine && blank(doc, a + 1) ? a + 1 : null
  const bottom = endLine - 1 > a && endLine - 1 !== top && blank(doc, endLine - 1) ? endLine - 1 : null
  const first = (top ?? a) + 1
  const last = (bottom ?? endLine) - 1
  const tailLine = endLine < doc.lines && blank(doc, endLine + 1) ? endLine + 1 : endLine
  return {
    from,
    titleLine: a,
    prefixEnd,
    titleEnd,
    lineEnd: title.to,
    open,
    body: first <= last ? { first, last } : null,
    endLine,
    tailLine,
    depth: 0,
    parent: null,
    hidden: false
  }
}

/** The first position after everything the toggle hides: the start of the line
 *  after it, or the end of the note when nothing follows. */
export function afterPos(doc: Text, t: Toggle): number {
  return t.tailLine < doc.lines ? doc.line(t.tailLine + 1).from : doc.length
}

/** Whether nothing follows the toggle in the note. */
export const atNoteEnd = (doc: Text, t: Toggle): boolean => t.tailLine >= doc.lines

/** Where the last thing you can see of the toggle ends: its last body line
 *  when open, its title when shut. */
export function visibleEnd(doc: Text, t: Toggle): number {
  return t.open && t.body ? doc.line(t.body.last).to : t.titleEnd
}

/** The toggle whose title line is line `n`, if any (on screen or not). */
export function toggleAtTitle(toggles: Toggle[], n: number): Toggle | null {
  return toggles.find((t) => t.titleLine === n) ?? null
}

/** The innermost toggle whose BODY holds line `n`. */
export function toggleHolding(toggles: Toggle[], n: number): Toggle | null {
  let hit: Toggle | null = null
  for (const t of toggles) if (t.body && n >= t.body.first && n <= t.body.last) hit = t
  return hit
}

/** How far line `n` is indented: 0 outside any toggle, 1 in a toggle's body… */
export function depthOfLine(toggles: Toggle[], n: number): number {
  const t = toggleHolding(toggles, n)
  return t ? t.depth + 1 : 0
}

// ---------------------------------------------------------------------------
// Zones: the stretches of hidden markup a cursor must not rest inside, and an
// edit must not cut into. Only for toggles on screen — one inside a shut toggle
// is covered by its parent's zone.
// ---------------------------------------------------------------------------

export interface Zone {
  kind: 'pre' | 'mid' | 'tail'
  from: number
  to: number
  /** 'pre': the end of the line above, where Left from the title's start goes
   *  (null at the top of the note). */
  back?: number | null
  /** nothing follows the toggle, so `to` is the note's end and is itself hidden */
  last?: boolean
}

export function zones(doc: Text, toggles: Toggle[]): Zone[] {
  const out: Zone[] = []
  for (const t of toggles) {
    if (t.hidden) continue
    const after = afterPos(doc, t)
    const last = atNoteEnd(doc, t)
    out.push({ kind: 'pre', from: t.from, to: t.prefixEnd, back: t.from > 0 ? t.from - 1 : null })
    if (t.open && t.body) {
      out.push({ kind: 'mid', from: t.titleEnd, to: doc.line(t.body.first).from })
      out.push({ kind: 'tail', from: doc.line(t.body.last).to, to: after, last })
    } else {
      out.push({ kind: 'mid', from: t.titleEnd, to: after, last })
    }
  }
  return out
}

/** Where a cursor that landed on `head` (coming from `was`) should really be.
 *  Returns `head` itself when it is somewhere you can type.
 *
 *  Only the step that crossed INTO a zone from its visible edge carries on
 *  through it (Right at the title's end goes to the body; Left at the title's
 *  start goes to the line above). Everything else — a click past the end of the
 *  title, Home, End — lands on the nearest place you can see. */
export function snapHead(list: Zone[], head: number, was: number, pointer: boolean): number {
  let pos = head
  for (let round = 0; round < 4; round++) {
    let moved = false
    for (const z of list) {
      if (z.kind === 'pre') {
        if (pos < z.from || pos >= z.to) continue
        pos = !pointer && was === z.to && pos < z.to && z.back != null ? z.back : z.to
      } else {
        const inside = pos > z.from && (pos < z.to || (z.last === true && pos <= z.to))
        if (!inside) continue
        pos = !pointer && was === z.from && !z.last ? z.to : z.from
      }
      moved = true
      was = -1 // a second hop is never a continuation of the first
      break
    }
    if (!moved) break
  }
  return pos
}

/** Ranges an edit must leave alone — everything hidden, plus the line break in
 *  front of a title — except in toggles the edit takes out whole (`whole(t)`),
 *  whose markup goes with them. `pre` marks the one in front of a title. */
export function guarded(
  doc: Text,
  toggles: Toggle[],
  whole: (t: Toggle) => boolean
): { from: number; to: number; pre: boolean }[] {
  const out: { from: number; to: number; pre: boolean }[] = []
  for (const t of toggles) {
    if (t.hidden || whole(t)) continue
    out.push({ from: t.from > 0 ? t.from - 1 : 0, to: t.prefixEnd, pre: true })
    const after = afterPos(doc, t)
    if (t.open && t.body) {
      out.push({ from: t.titleEnd, to: doc.line(t.body.first).from, pre: false })
      out.push({ from: doc.line(t.body.last).to, to: after, pre: false })
    } else {
      out.push({ from: t.titleEnd, to: after, pre: false })
    }
  }
  return out.sort((a, b) => a.from - b.from)
}

/** Whether line `n` is off screen inside a shut toggle. Tables and maths
 *  blocks there are not drawn at all. */
export function hiddenLine(toggles: Toggle[], n: number): boolean {
  return toggles.some((t) => (t.hidden || !t.open) && n > t.titleLine && n <= t.tailLine)
}

/** The blank line after a toggle may be dropped along with it — unless it is
 *  also the blank line its parent keeps above its own `</details>`. */
export function ownsTailBlank(t: Toggle): boolean {
  return t.tailLine > t.endLine && !(t.parent && t.parent.endLine === t.tailLine + 1)
}

// ---------------------------------------------------------------------------
// Edits. Each returns a plain transaction spec; `filter: false` because the
// guard in toggleList.ts exists to stop edits cutting into markup, and these
// are the edits that write it.
// ---------------------------------------------------------------------------

/** Turn lines `first`–`last` into an open toggle: `title` becomes its title and
 *  any further lines go inside it. The cursor lands at the title's start or end. */
export function wrapSpec(
  state: EditorState,
  first: number,
  last: number,
  title: string,
  cursor: 'start' | 'end'
): { changes: { from: number; to: number; insert: string }; selection: { anchor: number }; filter: false } {
  const doc = state.doc
  const br = state.lineBreak
  const a = doc.line(first)
  const b = doc.line(last)
  const body: string[] = []
  for (let n = first + 1; n <= last; n++) body.push(doc.line(n).text)
  // A line written straight under `</details>` is swallowed into it by GitHub,
  // so a toggle followed by text gets a (hidden) blank line after it.
  const followed = last < doc.lines && doc.line(last + 1).text.trim() !== ''
  const insert = toggleText(title, body, true, br) + (followed ? br : '')
  const at = a.from + OPEN_PREFIX.length
  return {
    changes: { from: a.from, to: b.to, insert },
    selection: { anchor: cursor === 'start' ? at : at + title.length },
    filter: false
  }
}

/** Lines `first`–`last` can become a toggle together only if every toggle they
 *  touch lies wholly inside them. */
export function wrappable(state: EditorState, first: number, last: number): boolean {
  let open = 0
  for (let n = first; n <= last; n++) {
    const text = state.doc.line(n).text
    if (SUMMARY_RE.test(text)) open++
    else if (END_RE.test(text) && --open < 0) return false
  }
  return open === 0
}

/** Take the toggle away and keep its words: the title becomes an ordinary line
 *  and whatever was inside follows it. `offset` is where in the title the
 *  cursor was. */
export function unwrapSpec(
  state: EditorState,
  t: Toggle,
  offset = 0
): { changes: { from: number; to: number; insert: string }; selection: { anchor: number }; filter: false } {
  const doc = state.doc
  const title = doc.sliceString(t.prefixEnd, t.titleEnd)
  const lines = [title]
  if (t.body) {
    const only = t.body.first === t.body.last && doc.line(t.body.first).text.trim() === ''
    if (!only) for (let n = t.body.first; n <= t.body.last; n++) lines.push(doc.line(n).text)
  }
  const end = ownsTailBlank(t) ? doc.line(t.tailLine).to : doc.line(t.endLine).to
  return {
    changes: { from: t.from, to: end, insert: lines.join(state.lineBreak) },
    selection: { anchor: t.from + Math.max(0, Math.min(offset, title.length)) },
    filter: false
  }
}

/** The one-attribute change that opens or shuts a toggle. `<details` is 8
 *  characters and ` open` 5. */
export function flipChange(t: Toggle): { from: number; to?: number; insert?: string } {
  return t.open ? { from: t.from + 8, to: t.from + 13 } : { from: t.from + 8, insert: ' open' }
}
