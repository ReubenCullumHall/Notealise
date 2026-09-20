// Filename sanitisation. Windows is the strict platform, so we apply its rules
// on BOTH platforms — a note titled "Q3: Review" created on a Mac must not become
// unopenable when the vault is copied to Windows.
//
// SHARED, not main-only, since 2026-09-20 — same reason as links.ts and color.ts
// (see shared/'s note in CLAUDE.md): main decides the real filename, and the
// renderer has to reach the same answer to resolve `[[Q3: Review]]` onto the
// note that name actually produced, and to tell the user which characters it
// had to replace. Two copies of this list would drift.
//
// Windows forbids  < > : " / \ | ? *  and control chars (0x00-0x1F), trailing
// dots and trailing spaces, and the reserved device names CON PRN AUX NUL
// COM1-9 LPT1-9 (with or without an extension).

// Backslash via char code so no escaped literal appears in source.
const FORBIDDEN = new Set(['<', '>', ':', '"', '/', String.fromCharCode(92), '|', '?', '*'])
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i

export interface SanitizeResult {
  name: string
  /** true when the result differs from the raw input (surface it to the user). */
  changed: boolean
}

/** Make `raw` safe as a single path segment on every platform. Never returns an
 *  empty string. A `/` or `\` in the input is treated as a forbidden character
 *  (replaced), not a directory boundary. */
export function sanitizeFilename(raw: string): SanitizeResult {
  // Coerce first, because this function is a security boundary reached over IPC
  // and the type annotation is not one. `for (const ch of raw)` over a STRING
  // yields characters; over an ARRAY it yields whole elements, and
  // `FORBIDDEN.has('../../evil')` is false — so every separator in it survived
  // untouched and `createFolder(['../../evil'])` made a directory outside the
  // vault. Structured clone carries an array across the bridge intact, so the
  // renderer could send one; nothing but the annotation said it couldn't.
  const text = typeof raw === 'string' ? raw : String(raw)
  let out = ''
  for (const ch of text) {
    if (ch.charCodeAt(0) < 0x20) continue // strip control chars
    out += FORBIDDEN.has(ch) ? '-' : ch
  }
  out = out.trim().replace(/[. ]+$/, '') // no trailing dots or spaces (Windows)

  // Reserved device name check is on the stem (before the first dot).
  if (RESERVED.test(out.split('.')[0])) out = `_${out}`

  if (out === '') out = 'Untitled'

  return { name: out, changed: out !== text }
}

/** The forbidden characters `raw` actually contains, in the order they appear,
 *  each listed once — so a message can name what the user typed rather than
 *  reciting the whole rule. Empty when the name only lost trailing dots or
 *  spaces, or nothing at all. */
export function forbiddenIn(raw: string): string[] {
  const text = typeof raw === 'string' ? raw : String(raw)
  const hit: string[] = []
  for (const ch of text) {
    if (FORBIDDEN.has(ch) && !hit.includes(ch)) hit.push(ch)
  }
  return hit
}
