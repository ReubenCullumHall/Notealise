import { promises as fs } from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/** Ensure `<vaultRoot>/.mdnotes/` exists (the in-vault app-config folder,
 *  mirroring Obsidian's `.obsidian/`). A dot prefix hides a folder on macOS but
 *  NOT on Windows, so there we also set the hidden attribute via `attrib +h`
 *  (chosen over a native binding to keep the dependency surface at zero).
 *  Idempotent; failures are non-fatal — the folder still works, it's just visible. */
export async function ensureMdnotes(vaultRoot: string): Promise<void> {
  const dir = path.join(vaultRoot, '.mdnotes')
  await fs.mkdir(dir, { recursive: true })
  if (process.platform === 'win32') {
    try {
      await execFileAsync('attrib', ['+h', dir])
    } catch {
      /* non-fatal */
    }
  }
}
