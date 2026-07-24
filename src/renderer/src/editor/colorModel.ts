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

function parseSpans(text: string, tag: 'mark' | 'span'): Span[] {
  const prefix = tag === 'mark' ? 'hl' : 'tc'
  const re = new RegExp('<' + tag + ' class="' + prefix + '-([a-z]+)">', 'g')
  const closeTag = '</' + tag + '>'
  const spans: Span[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (!COLOR_NAMES.has(m[1])) continue
    const contentStart = m.index + m[0].length
    const close = text.indexOf(closeTag, contentStart)
    if (close === -1) continue
    spans.push({
      openStart: m.index,
      contentStart,
      contentEnd: close,
      closeEnd: close + closeTag.length,
      name: m[1]
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
 */
export function recolor(
  text: string,
  selFrom: number,
  selTo: number,
  tag: 'mark' | 'span',
  name: string | null
): RegionChange {
  const prefix = tag === 'mark' ? 'hl' : 'tc'
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
    if (colour !== null) out += '<' + tag + ' class="' + prefix + '-' + colour + '">'
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
