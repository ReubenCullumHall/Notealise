// Earlier versions of a note — comparing an old copy with the note as it is now,
// line by line, so the box can show what has been removed since and put a piece
// back where it was. Pure; the box is EarlierVersions.tsx, the plan
// docs/plans/note-versions.md.

/** One run of the OLD copy's lines: still in the note, or gone from it since.
 *  A removed piece knows where it would go back: before line `at` of the note now. */
export type Piece =
  | { kind: 'same'; text: string }
  | { kind: 'removed'; text: string; at: number; key: number }

export interface Comparison {
  pieces: Piece[]
  /** lines of the old copy that are no longer in the note */
  removedLines: number
  /** lines in the note now that the old copy didn't have */
  addedLines: number
}

/** Lines, with Windows line endings read as plain ones (a copy is kept exactly as
 *  it was on disk; the editor works in plain ones). */
export function toLines(text: string): string[] {
  return text.replace(/\r\n?/g, '\n').split('\n')
}

/** Above this many line pairs the middle of the two texts is not compared line by
 *  line (a table of that size would be tens of MB); it is shown as removed whole,
 *  which is still true — just coarser. */
const MAX_CELLS = 4_000_000

/** Matched [old line, new line] pairs — the longest run of lines the two share,
 *  in order. */
function matchLines(a: string[], b: string[]): [number, number][] {
  let p = 0
  while (p < a.length && p < b.length && a[p] === b[p]) p++
  let s = 0
  while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++
  const pairs: [number, number][] = []
  for (let i = 0; i < p; i++) pairs.push([i, i])
  const A = a.slice(p, a.length - s)
  const B = b.slice(p, b.length - s)
  if (A.length && B.length && A.length * B.length <= MAX_CELLS) {
    const n = A.length
    const m = B.length
    // lcs[i][j] = longest shared run of A[i..] and B[j..], flattened.
    const w = m + 1
    const lcs = new Uint32Array((n + 1) * w)
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        lcs[i * w + j] = A[i] === B[j] ? lcs[(i + 1) * w + j + 1] + 1 : Math.max(lcs[(i + 1) * w + j], lcs[i * w + j + 1])
      }
    }
    let i = 0
    let j = 0
    while (i < n && j < m) {
      if (A[i] === B[j]) {
        pairs.push([p + i, p + j])
        i++
        j++
      } else if (lcs[(i + 1) * w + j] >= lcs[i * w + j + 1]) i++
      else j++
    }
  }
  for (let k = s; k > 0; k--) pairs.push([a.length - k, b.length - k])
  return pairs
}

/** Is `now` the line `old` with a little changed — words added, a typo fixed —
 *  rather than different text? Measured like a save's removal (shared
 *  `removedChars`): how much of the old line is no longer there. */
function smallEdit(old: string, now: string): boolean {
  const max = Math.min(old.length, now.length)
  let p = 0
  while (p < max && old.charCodeAt(p) === now.charCodeAt(p)) p++
  let s = 0
  while (s < max - p && old.charCodeAt(old.length - 1 - s) === now.charCodeAt(now.length - 1 - s)) s++
  const lost = old.length - p - s
  return old.trim() !== '' && now.trim() !== '' && lost <= Math.max(3, Math.floor(old.length / 10))
}

/** Add to the matched pairs the lines that were only edited a little: in each
 *  stretch between two matched lines, the old and new lines side by side. A line
 *  you added a sentence to is not text you lost, and Put back on it would only
 *  write it twice. */
function pairEdited(a: string[], b: string[], pairs: [number, number][]): [number, number][] {
  const out: [number, number][] = []
  let pi = -1
  let pj = -1
  for (const [i, j] of [...pairs, [a.length, b.length] as [number, number]]) {
    for (let k = 0; pi + 1 + k < i && pj + 1 + k < j; k++) {
      if (smallEdit(a[pi + 1 + k], b[pj + 1 + k])) out.push([pi + 1 + k, pj + 1 + k])
    }
    if (i < a.length) out.push([i, j])
    pi = i
    pj = j
  }
  return out.sort((x, y) => x[0] - y[0])
}

/** The old copy, cut into what is still in the note and what has gone since. */
export function compare(oldText: string, nowText: string): Comparison {
  const a = toLines(oldText)
  const b = toLines(nowText)
  const pairs = pairEdited(a, b, matchLines(a, b))
  const matchOf = new Map(pairs)
  const pieces: Piece[] = []
  let next = 0 // the note-now line a removed piece would go back in front of
  let key = 0
  for (let i = 0; i < a.length; i++) {
    const j = matchOf.get(i)
    const kind = j === undefined ? 'removed' : 'same'
    if (j !== undefined) next = j + 1
    const last = pieces[pieces.length - 1]
    if (last && last.kind === kind) last.text += '\n' + a[i]
    else pieces.push(kind === 'same' ? { kind, text: a[i] } : { kind, text: a[i], at: next, key: key++ })
  }
  return {
    pieces,
    removedLines: a.length - pairs.length,
    addedLines: b.length - pairs.length
  }
}

/** Is there nothing between the two worth showing? */
export function isSame(c: Comparison): boolean {
  return c.removedLines === 0 && c.addedLines === 0
}

/** The note with one removed piece put back where it was. `nowText` must be the
 *  text the comparison was made against. A piece made only of blank lines is
 *  not worth a button, and is never offered. */
export function putBack(nowText: string, piece: Extract<Piece, { kind: 'removed' }>): string {
  const lines = toLines(nowText)
  const at = Math.max(0, Math.min(piece.at, lines.length))
  return [...lines.slice(0, at), ...toLines(piece.text), ...lines.slice(at)].join('\n')
}

/** Removed pieces that hold any words — only these get a Put back button. */
export function hasWords(piece: Piece): boolean {
  return piece.text.trim() !== ''
}
