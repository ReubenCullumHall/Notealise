// Markdown in, the words a reader actually sees out.
//
// Shared for the same reason `links.ts` and `color.ts` are: main builds the
// sidebar's one-line preview from it, the renderer counts words with it, and two
// definitions of "what counts as text" would drift — which is precisely how the
// word count came to disagree with the page in the first place.
//
// **Why this exists at all.** The count was `text.trim().match(/\S+/g).length`
// over the RAW file, so every piece of markdown syntax scored as a word: a
// heading's `#`, a table's pipes, and — the one Reuben hit on 2026-08-29 — a
// colour tag. `A <mark class="hl-rose">word</mark> B` reported **4 words** where
// a reader sees 3, because `<mark` and `class="hl-rose">word` and `B</mark>`
// are three whitespace-separated tokens. That was always wrong; concealing the
// tags in the editor is what made it inexplicable rather than merely odd.
//
// Deliberately regex-based and NOT the `@lezer/markdown` tree: main has no
// CodeMirror (rule 6 keeps it dependency-light) and reads only the first 400
// bytes of a file for a preview, where a tree would be parsing a truncated
// document. The trade is that pathological nesting can slip through — acceptable
// for a word count and a preview line, and it is why nothing that MATTERS (the
// decoration engine) is allowed to work this way (see docs/decorations.md).

/** What a reader sees, with every syntax mark removed but the words kept.
 *
 *  Line structure is preserved — callers that want one line collapse it
 *  themselves, and `countWords` doesn't care either way. */
export function toPlainText(md: string): string {
  return (
    md
      // Frontmatter: metadata, never prose. Only at the very top.
      .replace(/^---\r?\n[\s\S]*?\r?\n---/, '')
      // Fenced code: the FENCES and the language tag go, the code stays. Code
      // you wrote is content; ``` and `ts` are not.
      .replace(/^[ \t]*(`{3,}|~{3,}).*$/gm, '')
      // Display maths, whole. A reader sees a formula, not a sentence, and
      // counting `\int_0^1` as two words is worse than counting it as none.
      .replace(/\$\$[\s\S]*?\$\$/g, ' ')
      .replace(/\$[^$\n]+\$/g, ' ')
      // Images go entirely — alt text is a description of a picture, not words
      // on the page. Must run BEFORE links, or `!` is left stranded.
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
      .replace(/!\[\[[^\]]*\]\]/g, ' ')
      // [[wiki links]] → what's shown: the label after a `|`, else the target.
      .replace(/\[\[([^\]|#]*)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g, (_m, target, label) =>
        (label ?? target ?? '').trim()
      )
      // [label](url) → label. Reference links `[label][id]` too.
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]*)\]\[[^\]]*\]/g, '$1')
      // Link reference DEFINITIONS are machinery, not prose.
      .replace(/^[ \t]*\[[^\]]+\]:.*$/gm, '')
      // HTML — the colour tags among them.
      .replace(/<[^>]+>/g, ' ')
      // Horizontal rules, and a table's separator row, before the line-leading
      // strips below get a chance to read them as list bullets.
      .replace(/^[ \t]*([-*_])(?:[ \t]*\1){2,}[ \t]*$/gm, '')
      .replace(/^[ \t]*\|?[ \t]*:?-{2,}:?[ \t]*(\|[ \t]*:?-{2,}:?[ \t]*)*\|?[ \t]*$/gm, '')
      // Line-leading marks: headings, quotes, list bullets, ordered numbers and
      // task boxes. The bullet goes, the item's text stays.
      .replace(/^[ \t]*#{1,6}[ \t]+/gm, '')
      .replace(/^[ \t]{0,3}>[ \t]?/gm, '')
      .replace(/^[ \t]*(?:[-*+]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]*)?/gm, '')
      // Table pipes: the cells are words, the pipes are not.
      .replace(/\|/g, ' ')
      // Inline marks last, so nothing above has to cope with them: backticks,
      // then emphasis/strikethrough, then the `\*` escapes that protect a
      // literal one.
      .replace(/`+/g, '')
      .replace(/[*_~]/g, '')
      .replace(/\\([\\`*_{}[\]()#+\-.!>~|$])/g, '$1')
  )
}

/** Words as a reader would count them.
 *
 *  A token has to carry at least one letter or digit. Stripping a tag leaves a
 *  space behind — it has to, or `a<b>c</b>d` would read as one word — and that
 *  space can strand the punctuation that followed the tag: `now</span>,` becomes
 *  `now ,`, which is two tokens and one word. Found 2026-08-29 when a seven-word
 *  line reported eight. `\p{L}` rather than `a-z` so an accented or non-Latin
 *  word still counts. */
export function countWords(md: string): number {
  const tokens = toPlainText(md).match(/\S+/g) ?? []
  return tokens.filter((t) => /[\p{L}\p{N}]/u.test(t)).length
}

/** One line of a note's opening text, for the sidebar's second row.
 *
 *  The tidy-up after collapsing whitespace is the same stranded-punctuation
 *  problem `countWords` filters out, in its visible form: `now</span>,` strips
 *  to `now ,` and the preview read "now , bold". The count could just ignore the
 *  token; a line someone reads has to close the gap. */
export function toPreviewLine(md: string, max: number): string {
  return toPlainText(md)
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?%)\]}])/g, '$1') // a gap a stripped tag left behind
    .replace(/([([{])\s+/g, '$1')
    .trim()
    .slice(0, max)
}
