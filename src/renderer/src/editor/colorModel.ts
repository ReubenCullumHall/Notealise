import { COLOR_NAMES } from './palette'

// Pure model for colour spans — no CodeMirror imports, so the fiddly cases
// (partial-overlap split, replace-without-nesting, toggle off, merge) are unit
// tested in plain Node. `colorCommands.ts` wraps this for the live editor.

export interface RegionChange {
  /** replace [from,to) in the document with `insert` */
  from: number
  to: number
  insert: string
  /** selection to set afterward (absolute doc offsets) */
  selFrom: number
  selTo: number
}

interface Span {
  openStart: number
  contentStart: number
  contentEnd: number
  closeEnd: number
  name: string
}

/** The CSS property each layer paints with, for the custom-colour form. */
const propFor = (tag: 'mark' | 'span'): string =>
  tag === 'mark' ? 'background-color' : 'color'

/** A colour is either a palette NAME (`sage`) or a literal `#rrggbb`. The two
 *  are told apart by the `#`, everywhere, and nothing else in this file needs
 *  to know which it is holding. */
const isHex = (colour: string): boolean => colour.startsWith('#')

/** The opening tag for a colour on this layer. The two forms are not
 *  interchangeable: a NAME resolves through `--tc-NAME` / `--hl-NAME`, which
 *  have separate light and dark values, while a hex is the same colour on every
 *  theme — which is exactly what the user asked for when they typed one. */
const openTagFor = (tag: 'mark' | 'span', colour: string): string =>
  isHex(colour)
    ? '<' + tag + ' style="' + propFor(tag) + ': ' + colour + '">'
    : '<' + tag + ' class="' + (tag === 'mark' ? 'hl' : 'tc') + '-' + colour + '">'

function parseSpans(text: string, tag: 'mark' | 'span'): Span[] {
  const prefix = tag === 'mark' ? 'hl' : 'tc'
  // One regex over both forms, so a run of text carrying a named colour and one
  // carrying a custom hex are the same kind of thing to everything below — that
  // is what makes "select across both and recolour" work rather than splitting
  // into two passes that disagree about the region.
  const re = new RegExp(
    '<' + tag + ' (?:class="' + prefix + '-([a-z]+)"|style="' + propFor(tag) +
      ': *(#[0-9a-fA-F]{3,8}) *;?")>',
    'g'
  )
  const closeTag = '</' + tag + '>'
  const spans: Span[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    // Exactly one of the two alternatives matched.
    const name = m[1] !== undefined ? m[1] : (m[2] as string).toLowerCase()
    if (m[1] !== undefined && !COLOR_NAMES.has(m[1])) continue
    const contentStart = m.index + m[0].length
    const close = text.indexOf(closeTag, contentStart)
    if (close === -1) continue
    spans.push({
      openStart: m.index,
      contentStart,
      contentEnd: close,
      closeEnd: close + closeTag.length,
      name
    })
    re.lastIndex = close + closeTag.length
  }
  return spans
}

/**
 * Recompute the smallest region around [selFrom,selTo) so the selected text
 * becomes colour `name`. If `name` is null — or the whole selection is already
 * `name` — the selection is cleared instead (toggle off). A span the selection
 * only partially overlaps is split; equal-coloured neighbours merge.
 *
 * `name` is either a palette name (`sage`) or a literal `#rrggbb`. Callers must
 * pass a hex that `normalizeHex` has already accepted — this writes it straight
 * into the user's file and into a `style` attribute, so it is the caller's job
 * to make sure nothing else can get there (`colorCommands.applyColor` does it).
 *
 * NOT handled, and pre-existing: a highlight in the LEGACY `<span
 * style="background-color: …">` form, which `colorTags` reads for display but
 * which this cannot see while looking for `<mark>`. Recolouring over one leaves
 * it in place rather than replacing it. Notes written by this app never contain
 * one — only imports and pre-2026 files do.
 */
export function recolor(
  text: string,
  selFrom: number,
  selTo: number,
  tag: 'mark' | 'span',
  name: string | null
): RegionChange {
  const spans = parseSpans(text, tag)

  // Grow the working region to fully contain any span touching the selection.
  let regionStart = selFrom
  let regionEnd = selTo
  for (const s of spans) {
    if (s.openStart <= selTo && s.closeEnd >= selFrom) {
      regionStart = Math.min(regionStart, s.openStart)
      regionEnd = Math.max(regionEnd, s.closeEnd)
    }
  }
  const regionSpans = spans
    .filter((s) => s.openStart >= regionStart && s.closeEnd <= regionEnd)
    .sort((a, b) => a.openStart - b.openStart)

  // Flatten the region to content characters, each tagged with its current
  // colour and whether it's inside the selection. Tag characters are dropped.
  const chars: { ch: string; colour: string | null; sel: boolean }[] = []
  const pushRange = (from: number, to: number, colour: string | null): void => {
    for (let p = from; p < to; p++) chars.push({ ch: text[p], colour, sel: p >= selFrom && p < selTo })
  }
  let cursor = regionStart
  for (const s of regionSpans) {
    if (s.openStart > cursor) pushRange(cursor, s.openStart, null)
    pushRange(s.contentStart, s.contentEnd, s.name)
    cursor = s.closeEnd
  }
  if (cursor < regionEnd) pushRange(cursor, regionEnd, null)

  // Toggle: if every selected char is already `name`, clear instead of re-wrapping.
  const selected = chars.filter((c) => c.sel)
  const alreadyTarget = name !== null && selected.length > 0 && selected.every((c) => c.colour === name)
  const effective = alreadyTarget ? null : name
  for (const c of chars) if (c.sel) c.colour = effective

  // Emit, merging equal-coloured runs into single tags; record where each content
  // char lands in the output so the resulting selection can be computed.
  let out = ''
  const outPos: number[] = new Array(chars.length)
  let i = 0
  while (i < chars.length) {
    const colour = chars[i].colour
    let j = i
    while (j < chars.length && chars[j].colour === colour) j++
    if (colour !== null) out += openTagFor(tag, colour)
    for (let k = i; k < j; k++) {
      outPos[k] = out.length
      out += chars[k].ch
    }
    if (colour !== null) out += '</' + tag + '>'
    i = j
  }

  const firstSel = chars.findIndex((c) => c.sel)
  let lastSel = -1
  for (let k = chars.length - 1; k >= 0; k--) {
    if (chars[k].sel) {
      lastSel = k
      break
    }
  }
  const selFromOut = firstSel === -1 ? out.length : outPos[firstSel]
  const selToOut = lastSel === -1 ? out.length : outPos[lastSel] + chars[lastSel].ch.length

  return {
    from: regionStart,
    to: regionEnd,
    insert: out,
    selFrom: regionStart + selFromOut,
    selTo: regionStart + selToOut
  }
}
