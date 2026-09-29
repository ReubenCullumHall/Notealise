// Pure model for the format-toolbar commands, so wrap/unwrap logic is unit tested
// without a live editor. `formatCommands.ts` wraps this for CodeMirror.

import { isToggleMarkup } from './toggleModel'

export interface WrapResult {
  /** replace [from,to) with `insert` */
  from: number
  to: number
  insert: string
  /** resulting selection */
  selFrom: number
  selTo: number
}

/**
 * Toggle `open`/`close` around [from,to): wrap it, or unwrap when the markers are
 * already there — whether they sit just outside the selection or just inside it.
 * An empty selection wraps and drops the cursor between the markers.
 */
export function wrapRange(doc: string, from: number, to: number, open: string, close: string): WrapResult {
  const inner = doc.slice(from, to)
  const before = doc.slice(Math.max(0, from - open.length), from)
  const after = doc.slice(to, Math.min(doc.length, to + close.length))

  // markers just outside the selection -> unwrap
  if (before === open && after === close) {
    return {
      from: from - open.length,
      to: to + close.length,
      insert: inner,
      selFrom: from - open.length,
      selTo: to - open.length
    }
  }
  // markers inside the selection -> unwrap
  if (inner.length >= open.length + close.length && inner.startsWith(open) && inner.endsWith(close)) {
    const stripped = inner.slice(open.length, inner.length - close.length)
    return { from, to, insert: stripped, selFrom: from, selTo: to - open.length - close.length }
  }
  // otherwise wrap
  return {
    from,
    to,
    insert: open + inner + close,
    selFrom: from + open.length,
    selTo: to + open.length
  }
}

/** One existing span of the style being toggled: its open mark [openFrom, openTo)
 *  and close mark [closeFrom, closeTo), located by the caller from the syntax tree. */
export interface Range {
  from: number
  to: number
}

export interface StyleSpan {
  openFrom: number
  openTo: number
  closeFrom: number
  closeTo: number
}

// A line-leading block marker (`# `, `- `, `1. `, `> `, `- [ ] `), which a style
// must never swallow: `**- item**` is not a bold list item, it is no list at all.
const LEAD_RE = /^[ \t]*(?:(?:#{1,6}|[-*+]|\d+[.)]|>)[ \t]+(?:\[[ xX]\][ \t]+)?)*/

/**
 * Toggle a style over a NON-EMPTY selection the way a word processor does
 * (Reuben, 2026-09-25): if every selected character already has the style, take
 * it off them; otherwise put it on ALL of them — merging with any span the
 * selection touches, so nothing is ever wrapped twice. The old exact-match
 * `wrapRange` wrapped a selection that was one space too wide in a second pair,
 * and `<u><u>words</u> </u>` / `****words** ****` is what then showed.
 *
 * `spans` are the style's existing spans that overlap or touch the selection.
 * `flanked` is true for `*` `**` `~~`: CommonMark will not open or close those on
 * a space, so a span never starts or ends on one, and selected edge spaces are
 * ignored when deciding "already styled?". Returns null when there is nothing to
 * style (the selection is only spaces or line markers).
 */
export function toggleStyle(
  doc: string,
  from: number,
  to: number,
  open: string,
  close: string,
  spans: StyleSpan[],
  flanked: boolean,
  /** Other styles' marks (`</u>`, `**`, colour tags): never styled, and a span
   *  stops at one rather than crossing it — crossing is what tangles the nesting
   *  (`**a *b** c*`) and leaves marks showing. Pieces either side are styled. */
  foreign: Range[] = [],
  /** Things that can't be cut into — inline code, a link, a wiki link: styled
   *  whole or not at all, because marks inside them would be literal text. */
  atoms: Range[] = []
): WrapResult | null {
  // A span touching the selection, or (for * ** ~~) only a space or two away from
  // it — so bolding the word next to a bold word joins them into one span.
  const near = (a: number, b: number): boolean => a <= b && (!flanked ? a === b : /^[ \t]*$/.test(doc.slice(a, b)))
  const involved = spans.filter(
    (s) => (s.openFrom <= to && s.closeTo >= from) || near(s.closeTo, from) || near(to, s.openFrom)
  )
  const hitAtoms = atoms.filter((a) => a.from < to && a.to > from)
  const regionFrom = Math.min(from, ...involved.map((s) => s.openFrom), ...hitAtoms.map((a) => a.from))
  const regionTo = Math.max(to, ...involved.map((s) => s.closeTo), ...hitAtoms.map((a) => a.to))

  // The region as plain text (the involved marks removed), with which of its
  // characters are styled now, and where the selection falls in it.
  const isMark = (p: number): boolean =>
    involved.some((s) => (p >= s.openFrom && p < s.openTo) || (p >= s.closeFrom && p < s.closeTo))
  const inContent = (p: number): boolean => involved.some((s) => p >= s.openTo && p < s.closeFrom)
  let plain = ''
  const styled: boolean[] = []
  const at: number[] = [] // each plain character's position in the doc
  let pf = -1
  let pt = -1
  for (let p = regionFrom; p <= regionTo; p++) {
    if (p === from && pf < 0) pf = plain.length
    if (p === to && pt < 0) pt = plain.length
    if (p === regionTo || isMark(p)) continue
    plain += doc[p]
    styled.push(inContent(p))
    at.push(p)
  }
  const within = (rs: Range[], p: number): boolean => rs.some((r) => p >= r.from && p < r.to)

  // Characters no style may cover: line breaks, and each line's block marker.
  const locked = new Array<boolean>(plain.length).fill(false)
  const atLineStart = regionFrom === 0 || doc[regionFrom - 1] === '\n'
  for (let i = 0; i < plain.length; i++) {
    if (plain[i] === '\n' || within(foreign, at[i])) locked[i] = true
    if ((i === 0 && atLineStart) || (i > 0 && plain[i - 1] === '\n')) {
      const lead = LEAD_RE.exec(plain.slice(i, plain.indexOf('\n', i) === -1 ? undefined : plain.indexOf('\n', i)))
      for (let k = 0; k < (lead?.[0].length ?? 0); k++) locked[i + k] = true
    }
  }
  const isSpace = (i: number): boolean => /\s/.test(plain[i])
  const counts = (i: number): boolean => !locked[i] && !(flanked && isSpace(i))

  let any = false
  let all = true
  for (let i = pf; i < pt; i++) {
    if (!counts(i)) continue
    any = true
    if (!styled[i]) all = false
  }
  if (!any) return null
  for (let i = pf; i < pt; i++) if (!locked[i]) styled[i] = !all
  // An atom the selection reaches into goes the same way, all of it.
  for (const a of hitAtoms) for (let i = 0; i < plain.length; i++) if (at[i] >= a.from && at[i] < a.to) styled[i] = !all
  for (let i = 0; i < plain.length; i++) if (locked[i]) styled[i] = false

  // A flanked span may not begin or end on a space: pull its edges in. And two
  // runs with only spaces between them become one, rather than `**a** **b**`.
  if (flanked) {
    for (let i = 0; i < plain.length; i++) {
      if (styled[i] || !isSpace(i) || locked[i] || i === 0 || !styled[i - 1]) continue
      let j = i
      while (j < plain.length && isSpace(j) && !locked[j] && !styled[j]) j++
      if (j < plain.length && styled[j]) for (let k = i; k < j; k++) styled[k] = true
      i = j
    }
    for (let i = 0; i < plain.length; ) {
      if (!styled[i]) {
        i++
        continue
      }
      let j = i
      while (j < plain.length && styled[j]) j++
      let a = i
      let b = j
      while (a < b && isSpace(a)) styled[a++] = false
      while (b > a && isSpace(b - 1)) styled[--b] = false
      i = j
    }
  }

  // Write it back, one pair per styled run, keeping the same text selected.
  let out = ''
  let inRun = false
  let selFrom = -1
  let selTo = -1
  for (let i = 0; i <= plain.length; i++) {
    const want = i < plain.length && styled[i]
    if (inRun && !want) {
      if (i === pt) selTo = out.length
      out += close
      inRun = false
    }
    if (i === pt && selTo < 0) selTo = out.length
    if (!inRun && want) {
      out += open
      inRun = true
    }
    if (i === pf) selFrom = out.length
    if (i < plain.length) out += plain[i]
  }
  return { from: regionFrom, to: regionTo, insert: out, selFrom: regionFrom + selFrom, selTo: regionFrom + selTo }
}

/** The text a LaTeX-block insertion produces (single-line $$…$$). */
export function mathInsert(inner: string): string {
  return inner ? `$$${inner}$$` : '$$$$'
}

// --- block markers (headings, lists, quote) ------------------------------------
// These are line-leading, and mutually exclusive in practice: turning a bulleted
// list into a numbered one should *replace* the marker, never stack `1. - `. So
// every line is split into indent + marker + body, and only the marker is
// rewritten.

export type MarkerKind = 'h1' | 'h2' | 'h3' | 'bullet' | 'numbered' | 'checklist' | 'quote'

// Order matters: the checklist pattern must be tried before the plain bullet it
// starts with, or `- [ ] x` splits as a bullet with the body `[ ] x`.
const MARKER_RE = /^(\s*)(#{1,6} |[-*+] \[[ xX]\] |[-*+] |\d+[.)] |> )?/

/** Split a line into leading whitespace, its block marker (if any), and the rest. */
export function splitMarker(line: string): { indent: string; marker: string; body: string } {
  const m = MARKER_RE.exec(line)
  const indent = m?.[1] ?? ''
  const marker = m?.[2] ?? ''
  return { indent, marker, body: line.slice(indent.length + marker.length) }
}

/** True when `marker` is the one `kind` writes. A checklist counts as itself
 *  whether or not it is ticked, so toggling doesn't depend on the tick. */
function isKind(marker: string, kind: MarkerKind): boolean {
  switch (kind) {
    case 'h1':
      return marker === '# '
    case 'h2':
      return marker === '## '
    case 'h3':
      return marker === '### '
    case 'bullet':
      return /^[-*+] $/.test(marker)
    case 'numbered':
      return /^\d+[.)] $/.test(marker)
    case 'checklist':
      return /^[-*+] \[[ xX]\] $/.test(marker)
    case 'quote':
      return marker === '> '
  }
}

/** Whether a command should be free to turn its marker back off.
 *
 *  `'toggle'` is what a button does: press H1 twice and the heading goes away.
 *  `'set'` is what a "/" command does: you typed `/h1` and asked for a heading,
 *  so you get one — even on a line that already had one. Pressing a button again
 *  is a retraction; typing a command's name is not. */
export type MarkerMode = 'toggle' | 'set'

/**
 * Apply `kind` across `lines`. In `'toggle'` mode, every line already carrying it
 * means the user is asking to turn it off, so the marker is stripped; otherwise
 * it is applied to all of them, replacing whatever marker was there. Numbered
 * lists renumber from 1 down the block.
 *
 * A blank line BESIDE text is left alone — marking it would turn a paragraph gap
 * into an empty list item. But when there is no text at all (the cursor sitting
 * on an empty line, or a brand-new note) the blank line IS the target: skipping
 * it there made the list buttons do nothing whatsoever, which is exactly when
 * you reach for one — you press Enter and ask for a list before typing it.
 */
export function toggleMarker(lines: string[], kind: MarkerKind, mode: MarkerMode = 'toggle'): string[] {
  // A toggle list's markup lines are left exactly as they are: `- </details>`
  // would end the toggle nowhere, and its title line is not a paragraph.
  const touched = lines.filter((l) => l.trim() !== '' && !isToggleMarkup(l))
  const blankOnly = touched.length === 0
  const off =
    mode === 'toggle' && touched.length > 0 && touched.every((l) => isKind(splitMarker(l).marker, kind))
  let n = 0
  return lines.map((line) => {
    if (isToggleMarkup(line)) return line
    if (line.trim() === '' && !blankOnly) return line
    const { indent, body } = splitMarker(line)
    if (off) return indent + body
    n += 1
    return indent + markerFor(kind, n) + body
  })
}

function markerFor(kind: MarkerKind, n: number): string {
  switch (kind) {
    case 'h1':
      return '# '
    case 'h2':
      return '## '
    case 'h3':
      return '### '
    case 'bullet':
      return '- '
    case 'numbered':
      return `${n}. `
    case 'checklist':
      return '- [ ] '
    case 'quote':
      return '> '
  }
}
