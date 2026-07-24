// Filename sanitisation. Windows is the strict platform, so we apply its rules
// on BOTH platforms — a note titled "Q3: Review" created on a Mac must not become
// unopenable when the vault is copied to Windows.
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
  let out = ''
  for (const ch of raw) {
    if (ch.charCodeAt(0) < 0x20) continue // strip control chars
    out += FORBIDDEN.has(ch) ? '-' : ch
  }
  out = out.trim().replace(/[. ]+$/, '') // no trailing dots or spaces (Windows)

  // Reserved device name check is on the stem (before the first dot).
  if (RESERVED.test(out.split('.')[0])) out = `_${out}`

  if (out === '') out = 'Untitled'

  return { name: out, changed: out !== raw }
}
