import { app } from 'electron'
import { promises as fs, readFileSync } from 'node:fs'
import path from 'node:path'
import { getVaultRoot } from './vault'
import {
  activeSpace,
  type AppSettings,
  normalizeSettings,
  normalizeThemeCache,
  settingsFromThemeCache,
  type ThemeCache
} from '../shared/settings'

// Settings persistence. The source of truth is <vault>/.mdnotes/settings.json
// (rule 2: app config lives in the vault; rule 6: only main touches fs). A tiny
// theme+density mirror is kept in userData ONLY so the pre-vault picker can paint
// the right theme before any vault is open — it is a cache, never the source.

const SETTINGS_FILE = 'settings.json'
const themeCachePath = (): string => path.join(app.getPath('userData'), 'theme-cache.json')

function settingsPathFor(root: string | null): string | null {
  return root ? path.join(root, '.mdnotes', SETTINGS_FILE) : null
}

async function readSettingsFrom(root: string | null): Promise<AppSettings> {
  const p = settingsPathFor(root)
  if (p) {
    try {
      let raw = await fs.readFile(p, 'utf8')
      if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1) // tolerate a UTF-8 BOM
      return normalizeSettings(JSON.parse(raw))
    } catch {
      /* no settings file yet — fall through to cache/defaults */
    }
  }
  return settingsFromThemeCache(readThemeCacheSync())
}

/** Full settings for the active vault. With no vault (or no file yet) this
 *  reflects the userData theme/density cache so the picker matches last use. */
export async function getSettings(): Promise<AppSettings> {
  return readSettingsFrom(getVaultRoot())
}

// Serialise writes: each setSettings does read-modify-write, so overlapping
// calls (e.g. several quick changes) must queue or a later write clobbers an
// earlier field with stale state. The chain also absorbs rejections so one
// failed write can't wedge the queue.
let writeTail: Promise<unknown> = Promise.resolve()

/** Merge `partial` over current settings, persist to the vault, and refresh the
 *  userData theme cache. Returns the full, normalised result. Writes are
 *  serialised so concurrent calls can't lose each other's fields. */
export function setSettings(partial: Partial<AppSettings>): Promise<AppSettings> {
  // Captured HERE, not inside applyWrite: `writeTail.then(...)` defers the
  // callback until every earlier write has drained, so resolving the vault in
  // there resolves it at drain time rather than at call time. Change a setting
  // in vault A while another write is still in flight, switch to vault B, and
  // the queued callback wakes up in B and merges A's partial into B's
  // settings.json. The vault a write belongs to is the one it was REQUESTED in,
  // which is what capturing synchronously pins down. Same discipline
  // workspace.ts follows with `latestRoot` (captured at schedule time, flushed
  // to that root across a switch).
  const root = getVaultRoot()
  const run = writeTail.then(() => applyWrite(root, partial))
  writeTail = run.catch(() => {})
  return run
}

async function applyWrite(root: string | null, partial: Partial<AppSettings>): Promise<AppSettings> {
  // `root` is used for both the read and the write. Resolving getVaultRoot()
  // separately either side of an await is a read-modify-write across a boundary
  // the vault can move under: a write in flight when the user switches folders
  // would read the OLD vault's settings and save them into the NEW vault's
  // settings.json — handing it the previous vault's `spaces` list, so the
  // sidebar shows spaces that don't exist there.
  const current = await readSettingsFrom(root)
  const next = normalizeSettings({ ...current, ...partial })
  const p = settingsPathFor(root)
  if (p) {
    await fs.mkdir(path.dirname(p), { recursive: true })
    await fs.writeFile(p, JSON.stringify(next, null, 2), 'utf8')
  }
  // The cache mirrors the ACTIVE space — that's what the user will see next
  // launch. Note this also means switching space refreshes the cache for free,
  // because a switch is a setSettings({activeSpaceFolder}) that lands here: don't
  // "optimise" this to fire only when the theme changed, or relaunching after a
  // switch paints the previous space's colours.
  const a = activeSpace(next)
  //
  // Guarded, though, on this write's vault still being the open one. The cache
  // is what `renderer/index.html` paints from before React exists, so it has to
  // describe the vault the user will actually reopen. A write belonging to the
  // vault they just left must not repaint the one they switched to — the same
  // "a write outlives its vault" hazard the captured `root` fixes for
  // settings.json, needing its own guard here because the cache is the one file
  // in this function NOT scoped by `root`. `===` rather than rule 7's
  // path.relative: both sides come from getVaultRoot(), so this is an identity
  // check on one stored string, not a comparison of two derived paths — the
  // same check workspace.ts makes against `latestRoot`.
  if (getVaultRoot() === root) {
    await writeThemeCache({
      theme: a.theme,
      density: a.density,
      textTone: a.textTone,
      buttonDefinition: a.buttonDefinition
    })
  }
  return next
}

/** Synchronous read of the pre-paint cache — called from the preload bridge
 *  (via sendSync) before the renderer's first paint, so it must not be async. */
export function readThemeCacheSync(): ThemeCache {
  try {
    let raw = readFileSync(themeCachePath(), 'utf8')
    if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1)
    // Its own validator, NOT normalizeSettings — the cache is a flat
    // {theme, density}, not an AppSettings, and running it through the settings
    // normaliser would read two keys that no longer exist there and silently
    // paint the default theme on every launch.
    return normalizeThemeCache(JSON.parse(raw))
  } catch {
    return normalizeThemeCache(null)
  }
}

async function writeThemeCache(c: ThemeCache): Promise<void> {
  try {
    await fs.writeFile(themeCachePath(), JSON.stringify(c, null, 2), 'utf8')
  } catch {
    /* non-fatal: a missed cache write only risks a one-frame flash next launch */
  }
}
