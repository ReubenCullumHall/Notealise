// A voice note's transcript, as it is written into a note (docs/plans/transcribe.md — Reuben,
// 2026-11-05: shown inside the voice note, 10 lines then it scrolls; "Separate transcript from
// audio block" turns it into ordinary lines). Markdown has no fold, so it is the HTML one every
// Markdown reader already understands (rule 4), straight under the voice note's own line:
//
//   <audio controls src="Lecture%203.m4a"></audio>
//   <details data-transcript="Lecture%203.m4a"><summary>Transcript</summary>
//
//   First paragraph of what was said.
//
//   Second paragraph.
//
//   </details>
//
// GitHub and Obsidian show a fold called "Transcript". `data-transcript` is the voice note's
// src exactly as written: when a clip edit saves a new recording the two differ, and the voice
// note can offer Transcribe again (the words stay — they may have been corrected by hand).
//
// Pure string helpers, no DOM: the renderer and the tests use them.

export const TRANSCRIPT_SUMMARY = 'Transcript'

/** The longest recording Transcribe takes: the window holds it decoded at 16 kHz while
 *  sending it (~230 MB an hour). Two hours covers a long lecture. Main enforces it too. */
export const TRANSCRIBE_MAX_SECONDS = 2 * 60 * 60

const OPEN = /^<details\s+data-transcript\s*=\s*"([^"]*)"\s*>\s*<summary>\s*Transcript\s*<\/summary>\s*$/i
const CLOSE = /^\s*<\/details>\s*$/i

/** Characters in spoken words that Markdown (or this app) would read as something else:
 *  `$…$` as maths, `<` as a tag (a spoken "</details>" would end the fold), `[[` as a link,
 *  `*`/`_`/backticks as styling. Each is written escaped, so what was said shows as said. */
function escapeInline(text: string): string {
  return text.replace(/([\\`*_[\]<>$|~])/g, '\\$1')
}

/** A line that STARTS like a heading or a list would become one. A digit can't be escaped
 *  in Markdown (a "\\1." shows its backslash), so a numbered line escapes its dot instead. */
function escapeLineStart(text: string): string {
  return text
    .replace(/^(\s*)(#{1,6}\s|[-+=]\s)/, (_m, sp: string, mark: string) => `${sp}\\${mark}`)
    .replace(/^(\s*\d{1,9})([.)])(\s)/, (_m, num: string, dot: string, sp: string) => `${num}\\${dot}${sp}`)
}

/** Spoken words → a paragraph that reads back as exactly those words. */
export function escapeSpoken(text: string): string {
  return escapeLineStart(escapeInline(text.replace(/\s+/g, ' ').trim()))
}

/** Escape a recording's src for the attribute (it is already percent-encoded; this only
 *  guards a hand-written one). */
function attrValue(src: string): string {
  return src.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

/** The lines that go straight under a voice note's line. */
export function transcriptBlock(src: string, paragraphs: string[]): string {
  const body = paragraphs.map(escapeSpoken).filter(Boolean)
  return [`<details data-transcript="${attrValue(src)}"><summary>${TRANSCRIPT_SUMMARY}</summary>`, '', ...body.flatMap((p) => [p, '']), '</details>'].join('\n')
}

export interface FoundTranscript {
  /** line numbers (0-based) of the `<details …>` line and the `</details>` line */
  open: number
  close: number
  /** the src it was made from, as written */
  src: string
  /** its paragraphs, as written (escapes and any hand edits kept) */
  paragraphs: string[]
}

/** The transcript straight under the voice note on line `audioLine`, or null. Only directly
 *  under it counts — a fold three lines further down belongs to whatever is above it. */
export function findTranscript(lines: readonly string[], audioLine: number): FoundTranscript | null {
  const open = audioLine + 1
  const m = OPEN.exec(lines[open] ?? '')
  if (!m) return null
  for (let i = open + 1; i < lines.length; i++) {
    if (CLOSE.test(lines[i])) {
      const paragraphs: string[] = []
      let cur: string[] = []
      for (const l of lines.slice(open + 1, i)) {
        if (l.trim() === '') {
          if (cur.length) paragraphs.push(cur.join('\n'))
          cur = []
        } else cur.push(l)
      }
      if (cur.length) paragraphs.push(cur.join('\n'))
      return { open, close: i, src: m[1].replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&amp;/g, '&'), paragraphs }
    }
    // Another voice note or another fold before the end: not ours (a broken fold is left alone).
    if (/^<(audio|details)\b/i.test(lines[i])) return null
  }
  return null
}

/** Was this transcript made from a different recording than the voice note now plays? */
export function transcriptIsStale(found: FoundTranscript, audioSrc: string): boolean {
  return found.src !== audioSrc
}

/** "Separate transcript from audio block": the same paragraphs as ordinary lines, the fold
 *  gone. Hand edits are kept exactly. */
export function separatedText(found: FoundTranscript): string {
  return found.paragraphs.join('\n\n')
}
