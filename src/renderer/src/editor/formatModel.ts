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
