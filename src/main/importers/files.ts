import { promises as fs } from 'fs'
import path from 'path'

export interface FoundFile {
  /** absolute path on disk */
  abs: string
  /** folder segments relative to the picked root — empty for a picked file */
  rel: string[]
}

/** Expand what the user picked into a flat list of files with the extensions we
 *  want, remembering each one's folder path so the structure can be rebuilt.
 *
 *  Folders matter as much as files here: a Google Takeout or an Obsidian vault
 *  is a folder of hundreds of notes, and asking someone to multi-select them in
 *  a file dialog is not an import feature. Hidden entries (`.obsidian`,
 *  `.git`, macOS `__MACOSX`) are skipped — they're app plumbing, not notes. */
export async function collectFiles(picked: string[], exts: string[]): Promise<FoundFile[]> {
  const want = new Set(exts.map((e) => e.toLowerCase()))
  const out: FoundFile[] = []

  const walk = async (dir: string, rel: string[]): Promise<void> => {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name === '__MACOSX') continue
      const abs = path.join(dir, e.name)
      if (e.isDirectory()) await walk(abs, [...rel, e.name])
      else if (want.has(path.extname(e.name).toLowerCase())) out.push({ abs, rel })
    }
  }

  for (const p of picked) {
    const st = await fs.stat(p).catch(() => null)
    if (!st) continue
    if (st.isDirectory()) await walk(p, [])
    else if (want.has(path.extname(p).toLowerCase())) out.push({ abs: p, rel: [] })
  }
  return out
}
