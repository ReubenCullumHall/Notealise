import { promises as fs } from 'fs'
import path from 'path'
import { writeAsset } from '../vault'
import { encodeTarget } from '../../shared/attachments'

/** Anything with a scheme — `https://`, `mailto:`, `tel:` — is not a local file
 *  to copy (two letters or more, so a Windows drive letter isn't one). `mailto:`
 *  used to fall through and add a false "could not be copied" line per link. */
export function isRemoteUrl(target: string): boolean {
  return /^[a-z][a-z0-9+.-]+:/i.test(target)
}

/** A markdown link or picture: `[text](target)` / `![alt](target)`. The target
 *  may hold backslash-escaped characters (turndown writes `photo \(1\).png`) and
 *  balanced brackets (`photo (1).png`, how Obsidian writes it) — `[^)]+` stopped
 *  at the first `)` and broke every such file (bug scan 2026-10-27). */
export const LINK_PATTERN = /(!?\[[^\]]*\]\()((?:\\.|\([^()\s]*\)|[^()\s\\])+)(\))/g

/** The file a link target names: escapes undone, then %-decoded. A stray `%`
 *  (`caf%E9.html`, `50% done`) made decodeURIComponent throw and stopped the
 *  whole import halfway — so a target that won't decode is used as written. */
export function linkTarget(raw: string): string {
  const unescaped = raw.replace(/\\(.)/g, '$1')
  try {
    return decodeURIComponent(unescaped)
  } catch {
    return unescaped
  }
}

/** A vault path written back into a link: %-encoded per segment, brackets too. */
export function encodeLinkPath(rel: string): string {
  return rel.split('/').map(encodeTarget).join('/')
}

/** Which source file each copied name in a note's folder came from, so a second
 *  `image.png` from another page (Notion names every pasted picture that) gets
 *  its own name instead of overwriting the first (bug scan 2026-10-27). */
const copiedFrom = new Map<string, string>()

function freeName(vaultNoteDir: string, name: string, source: string): string {
  const ext = path.extname(name)
  const stem = name.slice(0, name.length - ext.length)
  for (let n = 1; ; n++) {
    const candidate = n === 1 ? name : `${stem} (${n})${ext}`
    const key = path.posix.join(vaultNoteDir, candidate).toLowerCase()
    const owner = copiedFrom.get(key)
    if (owner === undefined || owner === source) {
      copiedFrom.set(key, source)
      return candidate
    }
  }
}

/** Is `target` a path the imported document is allowed to reach — i.e. one that
 *  stays inside the folder being imported?
 *
 *  The document is the attacker here. `target` is lifted straight out of it (an
 *  `<img src>`, a link destination, a Keep attachment's filePath), and
 *  `path.resolve` DISCARDS its first argument when the second is absolute — so
 *  `<img src="/Users/you/.ssh/id_rsa">` resolved to exactly that file, which was
 *  then read and copied into the vault as a note asset. On Windows the same line
 *  accepted a UNC path, and reading it opens an outbound SMB connection to a host
 *  the document chose, leaking the user's NTLM challenge/response.
 *
 *  `path.relative` rather than a prefix test, per rule 7 — and the first segment
 *  rather than the string's prefix, matching `vault.ts`'s own boundary. */
export function isInsideSource(resolved: string, sourceDir: string): boolean {
  const rel = path.relative(path.resolve(sourceDir), resolved)
  if (rel === '') return false // the folder itself is not a file to copy
  if (path.isAbsolute(rel)) return false // another drive, or a UNC path
  return rel.split(path.sep)[0] !== '..'
}

/** Copies a local, relatively-referenced asset (image/file) into the vault
 *  alongside the note that references it, and returns the link to use in its
 *  place (always just the basename, since the asset lands as a sibling of
 *  the note). Returns null if the source file couldn't be read. */
export async function copyLocalAsset(
  target: string,
  sourceDir: string,
  vaultNoteDir: string
): Promise<string | null> {
  const resolvedSource = path.resolve(sourceDir, target)
  // Refused before the read, not after: `fs.readFile` on a UNC path is itself
  // the network request, so checking the bytes afterwards would be too late.
  if (!isInsideSource(resolvedSource, sourceDir)) return null
  try {
    const data = await fs.readFile(resolvedSource)
    const name = freeName(vaultNoteDir, path.basename(target), resolvedSource)
    await writeAsset(path.posix.join(vaultNoteDir, name), data)
    return name
  } catch {
    return null
  }
}
