// Blocks stuck together in a note's text are put back on their own lines when the note opens
// (Reuben, 2026-11-08). A bug on 2026-11-07 left `…</audio><audio …>` on one line in a real note:
// that line's six dots then picked both voice notes, and they were drawn over each other. Words
// typed onto a block's line before the cursor was kept off it (`test<audio …>`) are the same
// shape. The rules: docs/feature-done-checklist.md "Blocks — spacing and page looks", 4 and 5.
//
//   • every voice note and video on a line with anything else gets a line of its own;
//   • words before it go on the line above, words after it on the line below;
//   • a line of nothing but pictures puts each picture on its own line. A picture INSIDE a
//     sentence is ordinary Markdown and is left alone;
//   • a list item keeps its marker (`- <audio …>` is a voice note inside a list item — fine);
//   • code (fenced or in backticks), quotes, the properties at the top, and a tag inside other
//     HTML are never touched — splitting those would change what they are.
//
// Pure, so it is tested without an editor (separateBlocks.test.ts).

const TAG = /<(audio|video)\b[^>\n]*>\s*<\/\1>/gi
const IMAGE = /!\[[^\]\n]*\]\([^)\n]*\)/g
const FENCE = /^\s{0,3}(`{3,}|~{3,})/
/** What may come before a block on its line and still leave it a block: indent, a list marker,
 *  a task box. */
const MARKER = /^\s*(?:(?:[-*+]|\d{1,9}[.)])\s+)?(?:\[[ xX]\]\s+)?$/

function splitLine(line: string): string[] | null {
  if (line.includes('`') || /^\s*>/.test(line)) return null
  const indent = /^\s*/.exec(line)![0]
  TAG.lastIndex = 0
  const tags = [...line.matchAll(TAG)]
  if (!tags.length) {
    // A line of two or more pictures and nothing else.
    const pics = [...line.matchAll(IMAGE)]
    if (pics.length < 2 || line.replace(IMAGE, '').trim() !== '') return null
    return pics.map((m) => indent + m[0])
  }
  const prefix = line.slice(0, tags[0].index)
  const last = tags[tags.length - 1]
  const suffix = line.slice(last.index! + last[0].length)
  const gaps = tags.slice(1).map((m, i) => line.slice(tags[i].index! + tags[i][0].length, m.index))
  // Already one block alone on its line (with a list marker, maybe).
  if (tags.length === 1 && MARKER.test(prefix) && suffix.trim() === '') return null
  // A tag inside other HTML (`<div><audio …></audio></div>`) — not ours to rearrange.
  if ([prefix, suffix, ...gaps].some((t) => t.includes('<'))) return null

  const out: string[] = []
  let lead: string
  if (MARKER.test(prefix)) {
    // `- <audio …>` stays the list item; anything after it lines up under the item's text.
    out.push(prefix + tags[0][0])
    lead = prefix.trim() ? ' '.repeat(prefix.length) : indent
  } else {
    out.push(prefix.trimEnd())
    out.push(indent + tags[0][0])
    lead = indent
  }
  tags.slice(1).forEach((m, i) => {
    if (gaps[i].trim()) out.push(lead + gaps[i].trim())
    out.push(lead + m[0])
  })
  if (suffix.trim()) out.push(lead + suffix.trim())
  return out
}

/** The note's text with every stuck block on its own line, or null when nothing needed moving. */
export function separateBlocks(text: string): string | null {
  const lines = text.split('\n')
  let fence: string | null = null
  let changed = false
  const out: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    // The properties block at the top (`---` … `---`) is never touched.
    if (i === 0 && line.trim() === '---') {
      let end = i + 1
      while (end < lines.length && !/^(---|\.\.\.)\s*$/.test(lines[end])) end++
      if (end < lines.length) {
        out.push(...lines.slice(0, end + 1))
        i = end
        continue
      }
    }
    const f = FENCE.exec(line)
    if (fence) {
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length) fence = null
      out.push(line)
      continue
    }
    if (f) {
      fence = f[1]
      out.push(line)
      continue
    }
    const split = splitLine(line)
    if (split) {
      out.push(...split)
      changed = true
    } else out.push(line)
  }
  return changed ? out.join('\n') : null
}
