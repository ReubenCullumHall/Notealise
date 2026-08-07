import { promises as fs } from 'fs'
import path from 'path'
import { writeAsset } from '../vault'

export function isRemoteUrl(target: string): boolean {
  return /^[a-z]+:\/\//i.test(target)
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
  try {
    const data = await fs.readFile(resolvedSource)
    const name = path.basename(target)
    await writeAsset(path.posix.join(vaultNoteDir, name), data)
    return name
  } catch {
    return null
  }
}
