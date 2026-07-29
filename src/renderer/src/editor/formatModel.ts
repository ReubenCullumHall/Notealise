// Pure model for the format-toolbar commands, so wrap/unwrap logic is unit tested
// without a live editor. `formatCommands.ts` wraps this for CodeMirror.

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

/**
 * Toggle `kind` across `lines`. Every line already carrying it means the user is
 * asking to turn it off, so the marker is stripped; otherwise it is applied to
 * all of them, replacing whatever marker was there. Numbered lists renumber from
 * 1 down the block.
 *
 * A blank line BESIDE text is left alone — marking it would turn a paragraph gap
 * into an empty list item. But when there is no text at all (the cursor sitting
 * on an empty line, or a brand-new note) the blank line IS the target: skipping
 * it there made the list buttons do nothing whatsoever, which is exactly when
 * you reach for one — you press Enter and ask for a list before typing it.
 */
export function toggleMarker(lines: string[], kind: MarkerKind): string[] {
  const touched = lines.filter((l) => l.trim() !== '')
  const blankOnly = touched.length === 0
  const off = touched.length > 0 && touched.every((l) => isKind(splitMarker(l).marker, kind))
  let n = 0
  return lines.map((line) => {
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
