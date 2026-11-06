import { baseName } from '../../../shared/links'
import { kindForFilename, relativeTarget, resolveVaultPath } from '../../../shared/attachments'

// The text of a link to a moment in a voice note — what it says, where it
// points, and reading one back. Plain functions, no editor (momentLink.ts uses
// them), so they are tested on their own (momentModel.test.ts).

/** 83 → "1:23"; an hour or more → "1:02:03". */
export function clockOf(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

/** The words of the link: the voice note's name (or its file's), then the time.
 *  Square brackets would end the label early, so they become round ones. */
export function momentLabel(name: string, file: string, seconds: number): string {
  const stem = baseName(file).replace(/\.[^.]+$/, '')
  return `${(name.trim() || stem).replace(/\[/g, '(').replace(/\]/g, ')')} · ${clockOf(seconds)}`
}

/** The whole link, written for a note at `notePath`. */
export function momentMarkdown(name: string, file: string, seconds: number, notePath: string): string {
  const t = Math.max(0, Math.floor(seconds))
  return `[${momentLabel(name, file, t)}](${relativeTarget(file, notePath)}#t=${t})`
}

/** The time fragment: `t=83`, `t=83.5`, `t=83,90`, `t=npt:83`. */
const TIME = /^t=(?:npt:)?(\d+(?:\.\d+)?)(?:,.*)?$/

/** A link's address, read as a moment: the recording (vault path) and the
 *  second it starts at. Null for anything else — a web address, a link to a
 *  document, a recording link with no time. `t=83`, `t=83.5` and the fragment's
 *  other forms (`t=83,90`, `t=npt:83`) all read; only the start is used. */
export function parseMoment(href: string, notePath: string): { file: string; t: number } | null {
  const hash = href.lastIndexOf('#')
  if (hash <= 0) return null
  const m = TIME.exec(href.slice(hash + 1))
  if (!m) return null
  const file = resolveVaultPath(href.slice(0, hash), notePath)
  if (!file || kindForFilename(file) !== 'audio') return null
  return { file, t: Number(m[1]) }
}

/** Is this address shaped like a moment — judged on the text alone, so a link
 *  that climbs out of its folder (`../memo.m4a#t=3`) counts wherever it is.
 *  Whether the recording is really there is found out on a click. */
export function isMomentHref(href: string): boolean {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//')) return false
  const hash = href.lastIndexOf('#')
  if (hash <= 0 || !TIME.test(href.slice(hash + 1))) return false
  let path = href.slice(0, hash)
  try {
    path = decodeURIComponent(path)
  } catch {
    // a stray % — judge it as written
  }
  return kindForFilename(path) === 'audio'
}
