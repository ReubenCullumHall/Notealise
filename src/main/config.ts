import { app } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'

// App-level config (the chosen vault path) lives in userData — NEVER inside the
// vault itself. In-vault config belongs in <vault>/.mdnotes/ (a later prompt).
const configPath = (): string => path.join(app.getPath('userData'), 'config.json')

interface AppConfig {
  vaultPath?: string
}

async function read(): Promise<AppConfig> {
  try {
    let raw = await fs.readFile(configPath(), 'utf8')
    if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1) // tolerate a UTF-8 BOM
    return JSON.parse(raw) as AppConfig
  } catch {
    return {}
  }
}

async function write(cfg: AppConfig): Promise<void> {
  await fs.writeFile(configPath(), JSON.stringify(cfg, null, 2), 'utf8')
}

/** The saved vault path, but only if it still exists and is a directory.
 *  A vault that was moved/deleted while the app was closed reads as "unset",
 *  so the app falls back to the folder picker instead of crashing. */
export async function getSavedVault(): Promise<string | null> {
  const { vaultPath } = await read()
  if (!vaultPath) return null
  try {
    const st = await fs.stat(vaultPath)
    return st.isDirectory() ? vaultPath : null
  } catch {
    return null
  }
}

export async function saveVault(vaultPath: string): Promise<void> {
  await write({ vaultPath })
}
