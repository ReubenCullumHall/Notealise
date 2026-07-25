import { app } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { DEFAULT_UPDATE_PREFS, normalizeUpdatePrefs, type UpdatePrefs } from '../shared/update'

// App-level config lives in userData — NEVER inside the vault itself. In-vault
// config belongs in <vault>/.mdnotes/. Two things qualify, for the same reason:
// the app must know them *before* any vault is open.
//   - vaultPath:  which vault to reopen
//   - autoUpdate: a property of this install, not of a folder of notes
const configPath = (): string => path.join(app.getPath('userData'), 'config.json')

interface AppConfig {
  vaultPath?: string
  autoUpdate?: boolean
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

// Read-modify-write, always. A plain overwrite silently dropped every other key,
// which was harmless while vaultPath was the only one and is a data-loss bug the
// moment there are two — switching vaults would have reset the update preference.
let writeTail: Promise<unknown> = Promise.resolve()

function update(partial: AppConfig): Promise<void> {
  const run = writeTail.then(async () => {
    const next = { ...(await read()), ...partial }
    await fs.writeFile(configPath(), JSON.stringify(next, null, 2), 'utf8')
  })
  writeTail = run.catch(() => {}) // one failed write must not wedge the queue
  return run
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
  await update({ vaultPath })
}

/** Update preferences for this install (not for the open vault). */
export async function getUpdatePrefs(): Promise<UpdatePrefs> {
  const cfg = await read()
  return normalizeUpdatePrefs({ autoUpdate: cfg.autoUpdate ?? DEFAULT_UPDATE_PREFS.autoUpdate })
}

export async function saveUpdatePrefs(prefs: UpdatePrefs): Promise<void> {
  await update({ autoUpdate: prefs.autoUpdate })
}
