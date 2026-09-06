import { promises as fs } from 'fs'
import path from 'path'
import { writeAsset } from '../vault'

export function isRemoteUrl(target: string): boolean {
  return /^[a-z]+:\/\//i.test(target)
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
    const name = path.basename(target)
    await writeAsset(path.posix.join(vaultNoteDir, name), data)
    return name
  } catch {
    return null
  }
}
