import { app, BrowserWindow, shell } from 'electron'
import { existsSync } from 'node:fs'
import path from 'node:path'
import electronUpdater from 'electron-updater'
import { CH } from '../shared/channels'
import { getUpdatePrefs, saveUpdatePrefs } from './config'
import { BETA_CHANNEL, RELEASES_URL, shouldFollowBeta, type UpdateStatus } from '../shared/update'

// The only file that imports electron-updater. It reads the `latest.yml` that
// electron-builder already publishes beside Notes-Setup.exe on every GitHub
// release, verifies the sha512, and (thanks to the .blockmap) fetches only the
// changed chunks rather than the whole ~100 MB installer.
//
// Behaviour is "download quietly, install on quit": nothing ever interrupts
// writing. `autoInstallOnAppQuit` is electron-updater's default and we keep it.

// electron-updater ships as CommonJS; the named export isn't reachable through
// the ESM interop that electron-vite applies, so go through the default.
//
// `autoUpdater` is a LAZY GETTER: touching it constructs an NsisUpdater, which
// reads `electron.app` in its constructor. Destructuring it at module scope
// would therefore build the updater at import time — before `app.whenReady()`,
// and on every platform, defeating the guards below. So resolve it on first
// real use instead; in dev and on macOS it is never touched at all.
let cached: typeof electronUpdater.autoUpdater | null = null
function updater(): typeof electronUpdater.autoUpdater {
  if (!cached) cached = electronUpdater.autoUpdater
  return cached
}

/** Opt-in dev testing. `AppUpdater.js:278` enables the updater when
 *  `app.isPackaged || forceDevUpdateConfig`, falling back to `dev-app-update.yml`
 *  at `app.getAppPath()` — the repo root in dev. So `NOTES_TEST_UPDATER=1
 *  npm run dev` exercises the real check → download → sha512 verify path without
 *  packaging or publishing anything. Off by default: nobody wants a dev run
 *  quietly downloading 100 MB.
 *
 *  To see it actually FIND something, temporarily lower `version` in
 *  package.json — in dev the updater compares against that. */
const devTest = process.env.NOTES_TEST_UPDATER === '1'

/** Two reasons the app can't update itself, both of which must be reported
 *  rather than thrown:
 *   - dev: autoUpdater has no update config and throws if asked to check
 *     (unless devTest above supplies dev-app-update.yml).
 *   - macOS: the build is unsigned (electron-builder.yml `identity: null`) and
 *     Squirrel.Mac REFUSES to apply an unsigned update. That is a signature
 *     check, not a warning — it needs an Apple Developer ID + notarization. */
function unsupportedReason(): string | null {
  if (!app.isPackaged && !devTest) return 'Updates are disabled in development builds.'
  if (process.platform === 'darwin') {
    return 'Automatic updates need a signed macOS build. Download the new version instead.'
  }
  // `npm run package:dir` (gate 1) produces a genuinely packaged app — isPackaged
  // is true — but electron-builder only writes app-update.yml when it builds an
  // installer target, so there is no feed to read. Without this the gate-1 smoke
  // test shows a scary "Cannot find app-update.yml" error that means nothing.
  if (app.isPackaged && !existsSync(path.join(process.resourcesPath, 'app-update.yml'))) {
    return 'This is an unpackaged test build (package:dir), so it has no update feed.'
  }
  return null
}

let status: UpdateStatus = { state: 'idle' }
let wired = false

export function currentStatus(): UpdateStatus {
  return status
}

function setStatus(next: UpdateStatus): void {
  status = next
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.webContents.isDestroyed()) win.webContents.send(CH.updateStatus, next)
  }
}

/** Wire the autoUpdater events onto our flat status union. Called once, lazily,
 *  and only when updating is actually possible. */
function wire(): void {
  if (wired) return
  wired = true

  const au = updater()
  au.autoInstallOnAppQuit = true
  au.logger = null
  // `&& !app.isPackaged` matters: in a packaged build this would send
  // electron-updater looking for dev-app-update.yml *inside the asar*, where it
  // does not exist, silently breaking updates for anyone who happened to have
  // the variable set in their environment.
  if (devTest && !app.isPackaged) au.forceDevUpdateConfig = true

  au.on('checking-for-update', () => setStatus({ state: 'checking' }))
  au.on('update-not-available', () => setStatus({ state: 'none' }))
  au.on('update-available', (info) =>
    setStatus({
      // With auto-download on, electron-updater starts fetching immediately, so
      // report `downloading` straight away rather than flashing `available`.
      state: au.autoDownload ? 'downloading' : 'available',
      version: info.version,
      percent: 0
    })
  )
  au.on('download-progress', (p) =>
    setStatus({ state: 'downloading', version: status.version, percent: Math.round(p.percent) })
  )
  au.on('update-downloaded', (info) => setStatus({ state: 'ready', version: info.version }))
  au.on('error', (err) => setStatus({ state: 'error', message: err?.message ?? String(err) }))
}

/** Point the updater at the stable or the beta feed.
 *
 *  Setting `channel` also sets `allowDowngrade = true`. That is wanted in both
 *  directions: leaving beta means stepping 0.2.0-beta.2 → 0.2.0, which is a
 *  downgrade in semver terms and would otherwise strand the tester; and on
 *  stable it is what makes the rollback in docs/release-checklist.md work — when
 *  a bad release is demoted, `releases/latest` falls back and installs move
 *  *down* onto the last good version. */
function applyChannel(pref: boolean): void {
  const beta = shouldFollowBeta(pref, app.getVersion())
  const au = updater()
  au.channel = beta ? BETA_CHANNEL : 'latest'
  au.allowPrerelease = beta
}

/** Prepare the updater and, if auto-update is on, start the background schedule.
 *  Safe to call in dev and on macOS — it just parks in `unsupported`. */
export async function initUpdater(): Promise<void> {
  const reason = unsupportedReason()
  if (reason) {
    setStatus({ state: 'unsupported', message: reason })
    return
  }
  wire()
  const { autoUpdate, betaChannel } = await getUpdatePrefs()
  applyChannel(betaChannel)
  updater().autoDownload = autoUpdate
  if (!autoUpdate) return

  // Delayed so a check never competes with first paint, then every 6 hours for
  // a long-running window.
  setTimeout(() => void checkNow(), 10_000).unref()
  setInterval(() => void checkNow(), 6 * 60 * 60 * 1000).unref()
}

/** Manual "Check now". Reports errors as status rather than throwing, so the
 *  button can never take the renderer down with it. */
export async function checkNow(): Promise<UpdateStatus> {
  const reason = unsupportedReason()
  if (reason) {
    setStatus({ state: 'unsupported', message: reason })
    return status
  }
  wire()
  try {
    await updater().checkForUpdates()
  } catch (e) {
    setStatus({ state: 'error', message: (e as Error).message })
  }
  return status
}

/** Explicit download, for when auto-download is off and the user opts in. */
export async function downloadUpdate(): Promise<UpdateStatus> {
  if (unsupportedReason()) {
    await shell.openExternal(RELEASES_URL)
    return status
  }
  wire()
  try {
    setStatus({ state: 'downloading', version: status.version, percent: 0 })
    await updater().downloadUpdate()
  } catch (e) {
    setStatus({ state: 'error', message: (e as Error).message })
  }
  return status
}

/** Apply a staged update now. Quits the app; the before-quit flush in index.ts
 *  still runs first, so unsaved edits are written before the installer starts. */
export function installNow(): void {
  if (status.state !== 'ready') return
  // A dev run can download and verify an update but cannot replace itself — the
  // installer needs a real install to write over. Say so rather than failing
  // somewhere confusing inside Squirrel.
  if (!app.isPackaged) {
    setStatus({
      state: 'error',
      message: 'Downloaded and verified, but a dev build cannot install itself. Use a packaged build.'
    })
    return
  }
  // isSilent=false so the NSIS installer shows its progress; isForceRunAfter=true
  // so the app comes back up on the new version.
  updater().quitAndInstall(false, true)
}

// Both setters read-modify-write the whole prefs object. Saving a single field
// would drop the other one — the same clobber that used to live in saveVault.

export async function setAutoUpdate(on: boolean): Promise<UpdateStatus> {
  const prefs = await getUpdatePrefs()
  await saveUpdatePrefs({ ...prefs, autoUpdate: on })
  if (!unsupportedReason()) {
    wire()
    updater().autoDownload = on
    if (on) void checkNow()
  }
  return status
}

/** Opt this install in or out of prerelease builds. Checks immediately, because
 *  the whole point is to see the other channel's version straight away.
 *
 *  Turning it ON is refused on a stable build. Settings hides the control there,
 *  but the renderer is not a trust boundary — the rule is enforced here, so
 *  neither a crafted IPC call nor a hand-edited config.json opts a stranger into
 *  test builds. Turning it OFF is always allowed, or a tester would be stuck. */
export async function setBetaChannel(on: boolean): Promise<UpdateStatus> {
  const next = shouldFollowBeta(on, app.getVersion())
  const prefs = await getUpdatePrefs()
  await saveUpdatePrefs({ ...prefs, betaChannel: next })
  if (!unsupportedReason()) {
    wire()
    applyChannel(next)
    void checkNow()
  }
  return status
}

/** Open the releases page — the fallback when the app can't update itself. */
export async function openReleasesPage(): Promise<void> {
  await shell.openExternal(RELEASES_URL)
}
