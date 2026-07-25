import { app, BrowserWindow, shell } from 'electron'
import electronUpdater from 'electron-updater'
import { CH } from '../shared/channels'
import { getUpdatePrefs, saveUpdatePrefs } from './config'
import { RELEASES_URL, type UpdateStatus } from '../shared/update'

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

/** Two reasons the app can't update itself, both of which must be reported
 *  rather than thrown:
 *   - dev: autoUpdater has no dev-app-update.yml and throws if asked to check.
 *   - macOS: the build is unsigned (electron-builder.yml `identity: null`) and
 *     Squirrel.Mac REFUSES to apply an unsigned update. That is a signature
 *     check, not a warning — it needs an Apple Developer ID + notarization. */
function unsupportedReason(): string | null {
  if (!app.isPackaged) return 'Updates are disabled in development builds.'
  if (process.platform === 'darwin') {
    return 'Automatic updates need a signed macOS build. Download the new version instead.'
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

/** Prepare the updater and, if auto-update is on, start the background schedule.
 *  Safe to call in dev and on macOS — it just parks in `unsupported`. */
export async function initUpdater(): Promise<void> {
  const reason = unsupportedReason()
  if (reason) {
    setStatus({ state: 'unsupported', message: reason })
    return
  }
  wire()
  const { autoUpdate } = await getUpdatePrefs()
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
  // isSilent=false so the NSIS installer shows its progress; isForceRunAfter=true
  // so the app comes back up on the new version.
  updater().quitAndInstall(false, true)
}

export async function setAutoUpdate(on: boolean): Promise<UpdateStatus> {
  await saveUpdatePrefs({ autoUpdate: on })
  if (!unsupportedReason()) {
    wire()
    updater().autoDownload = on
    if (on) void checkNow()
  }
  return status
}

/** Open the releases page — the fallback when the app can't update itself. */
export async function openReleasesPage(): Promise<void> {
  await shell.openExternal(RELEASES_URL)
}
