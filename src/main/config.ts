import { app } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { DEFAULT_UPDATE_PREFS, normalizeUpdatePrefs, type UpdatePrefs } from '../shared/update'

// App-level config lives in userData — NEVER inside the vault itself. In-vault
// config belongs in <vault>/.mdnotes/. These qualify, for the same reason:
// the app must know them *before* any vault is open.
//   - vaultPath:   which vault to reopen
//   - autoUpdate:  a property of this install, not of a folder of notes
//
// The space-preset library belongs in userData for the same reason, but it has a
// file of its own (`presets.json`, main/presets.ts) rather than a key here: it
// is a list that grows, not a setting.
const configPath = (): string => path.join(app.getPath('userData'), 'config.json')

interface AppConfig {
  vaultPath?: string
  autoUpdate?: boolean
  /** Has this install ever finished the onboarding flow? App-level, not
   *  per-vault, like vaultPath — triggers once ever, not "no vault open". */
  hasOnboarded?: boolean
  /** Which step to resume at if the app quit mid-onboarding. Absent/undefined
   *  means start (or restart) at 'welcome' — cleared once onboarding finishes,
   *  and by the dev "replay"/reset hooks, so a completed or freshly-reset
   *  install never resumes into a stale mid-flow step. */
  onboardingStep?: string
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

/** Whether this install has ever finished onboarding. Absent key = false, the
 *  same "missing means never happened" reading as every other flag here. */
export async function getHasOnboarded(): Promise<boolean> {
  return (await read()).hasOnboarded === true
}

/** Has `root` been set up with the app before — does it carry the appearance
 *  file the app writes on first real use?
 *
 *  `.mdnotes/settings.json` specifically, NOT just the `.mdnotes/` directory:
 *  `ensureMdnotes` makes the empty folder the instant any vault is activated
 *  (onboarding's own Vault step included), so the folder alone proves nothing.
 *  `settings.json` is only written once `setSettings` has run — which for a
 *  genuine first run doesn't happen until the flow is underway — so its
 *  presence means this folder has a real prior setup in it.
 *
 *  This is the durable "have we onboarded" signal that `hasOnboarded` in
 *  userData is not: it travels INSIDE the vault (rule 2), so an app-cleaner
 *  wiping this machine's config, or a move to a new machine, can't take it
 *  with them. `config.ts` is the right home for it — like `getSavedVault`, it
 *  is a question the app must answer before any vault module is wired up. */
export async function vaultLooksEstablished(root: string): Promise<boolean> {
  try {
    const st = await fs.stat(path.join(root, '.mdnotes', 'settings.json'))
    return st.isFile()
  } catch {
    return false
  }
}

/** Set or clear the flag. Clearing it is the dev "replay onboarding" hook
 *  (Settings → General → Developer) — go through different first-run setups
 *  without reinstalling or hand-editing config.json. */
export async function setHasOnboarded(value: boolean): Promise<void> {
  await update({ hasOnboarded: value })
}

/** The step to resume onboarding at, if the app quit mid-flow. Null (not
 *  undefined) when there's nothing saved — Onboarding.tsx's caller falls back
 *  to 'welcome' either way, but null reads more honestly as "no answer" than
 *  reusing undefined for both "not fetched yet" and "fetched, nothing there". */
export async function getOnboardingStep(): Promise<string | null> {
  return (await read()).onboardingStep ?? null
}

/** Persist the current step on every advance/back, or clear it (`null`) once
 *  onboarding finishes or a dev hook resets the flow — `update`'s merge drops
 *  an `undefined` value from the written JSON entirely (JSON.stringify's own
 *  behaviour), so `null` here really does erase the key rather than storing
 *  the string `"null"`. */
export async function setOnboardingStep(step: string | null): Promise<void> {
  await update({ onboardingStep: step ?? undefined })
}

/** A disposable vault for repeatedly testing onboarding — one fixed path
 *  under the OS temp dir, wiped and recreated empty on every call. Never the
 *  user's real vault (`vaultPath` isn't touched until the caller explicitly
 *  points at this folder), so there's nothing to confirm before running it. */
export async function freshOnboardingTestVault(): Promise<string> {
  const dir = path.join(app.getPath('temp'), 'notealise-onboarding-test')
  await fs.rm(dir, { recursive: true, force: true })
  await fs.mkdir(dir, { recursive: true })
  return dir
}

/** Update preferences for this install (not for the open vault). */
export async function getUpdatePrefs(): Promise<UpdatePrefs> {
  const cfg = await read()
  return normalizeUpdatePrefs({
    autoUpdate: cfg.autoUpdate ?? DEFAULT_UPDATE_PREFS.autoUpdate
  })
}

export async function saveUpdatePrefs(prefs: UpdatePrefs): Promise<void> {
  await update({ autoUpdate: prefs.autoUpdate })
}
