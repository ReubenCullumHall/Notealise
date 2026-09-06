import { app, BrowserWindow, ipcMain, session } from 'electron'
import path from 'node:path'
import { CH } from '../shared/channels'
import { openAllowedExternal } from './externalLinks'
import {
  getHasOnboarded,
  getOnboardingStep,
  getSavedVault,
  setHasOnboarded,
  vaultLooksEstablished
} from './config'
import { activateVault, registerIpc } from './ipc'
import { installMenu } from './menu'
import { initUpdater } from './updater'
import { stopWatching } from './watcher'
import { startRecoverySweep } from './workspace'
import { sweepStaleExtractions } from './importers/notionZip/extractZip'

// The Content-Security-Policy is injected into the renderer's HTML at build
// time — see the `csp` plugin in electron.vite.config.ts, which is also where
// the policy itself and the reasoning for each directive live.
//
// It is a <meta> tag rather than a response header set here via
// `session.webRequest.onHeadersReceived`, which was the first attempt: a
// packaged build loads the renderer with `loadFile`, i.e. `file://`, and a
// file:// request is served by Chromium's protocol handler rather than its
// network stack, so webRequest listeners are not a reliable place to attach a
// header to it. A header that fires in dev over http://localhost and silently
// does nothing in the shipped app is the worst shape a security control can
// have — it would test clean every time.

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false // preload needs require() for the contextBridge setup
    }
  })

  // Neither of these has a live route into it today: the renderer contains no
  // <a href> at all, the editor routes every link click through
  // `openAllowedExternal`, and main.tsx already blocks drop-to-navigate. They
  // are here because the preload bridge RE-ATTACHES on navigation — so the day
  // any anchor becomes clickable, one link in a note would hand an attacker's
  // page the whole window.api surface: readNote, writeNote, trashEntries,
  // exportTransfer. This is the layer that contains that mistake instead of
  // rewarding it.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void openAllowedExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    // The renderer's own document reloading (dev-server HMR, and the in-app
    // reload after a vault reset) is the one navigation that is legitimate.
    if (url === win.webContents.getURL()) return
    e.preventDefault()
    void openAllowedExternal(url)
  })

  win.on('ready-to-show', () => win.show())

  // electron-vite provides ELECTRON_RENDERER_URL in dev; load the built file otherwise.
  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  return win
}

// One instance per machine. Two copies open on the same vault are not two
// readers — `workspace.json` is written whole, on a debounce, so the second one
// to flush silently replaces the first's pins, ordering, bin and recovery net,
// and both run their own watcher and their own hourly recovery sweep on the
// same files. macOS refuses a second copy of the same .app on its own; Windows
// will happily run the .exe twice, which is where this actually bites.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const existing = BrowserWindow.getAllWindows()[0]
    if (!existing) return
    if (existing.isMinimized()) existing.restore()
    existing.focus()
  })
}

app.whenReady().then(async () => {
  // Nothing in this app asks for a camera, a microphone, a location or a
  // notification, so every such request is either a mistake or someone else's
  // idea. Deny by default rather than leaving Chromium to prompt.
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) =>
    callback(false)
  )

  installMenu()

  const saved = await getSavedVault()

  // Self-heal the onboarding flag — BEFORE the window exists, so the renderer's
  // first `getOnboarded()` already sees the healed value. If this machine's
  // config still points at a vault but has lost the `hasOnboarded` mark (an old
  // install predating onboarding, or userData partially cleared), and that vault
  // visibly has a prior setup in it, treat the flow as done rather than dropping
  // the user into it on top of their real notes. The renderer's Vault step
  // handles the harder case — config gone entirely, folder re-picked by hand.
  //
  // `!onboardingStep` matters: a genuine first run that quit part-way (after
  // Spaces, say) has ALREADY written `.mdnotes/settings.json`, so it "looks
  // established" too — but it left a resume step behind, and healing here would
  // strand it before Write / Fonts / the welcome notes. An absent step means
  // the flow either never started or finished, and only the latter leaves a
  // set-up vault.
  if (
    saved &&
    !(await getHasOnboarded()) &&
    !(await getOnboardingStep()) &&
    (await vaultLooksEstablished(saved))
  ) {
    await setHasOnboarded(true)
  }

  const win = createWindow()
  registerIpc(win)

  // Open straight into the saved vault if it still exists; otherwise the
  // renderer shows the folder picker (getVault() returns null).
  if (saved) activateVault(saved)

  // Parks in `unsupported` in dev and on macOS; never throws, never blocks boot.
  void initUpdater()

  // The recovery safety net's 7-day expiry — one process-wide timer, not tied
  // to any one window.
  startRecoverySweep()

  // Extraction folders from earlier Notion imports. Never blocks boot, and a
  // failure here is not worth reporting to anyone.
  void sweepStaleExtractions().catch(() => {})

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const w = createWindow()
      registerIpc(w)
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// Give the renderer a chance to flush unsaved edits before we exit. Hold the
// quit until it reports back (or a short timeout), then let it through.
let quitting = false
let flushDone = false
app.on('before-quit', (e) => {
  if (quitting) {
    // A SECOND Cmd+Q while the first is still waiting must not overtake it.
    // This used to fall straight through and let the process go — so an
    // impatient double-press beat the very flush the first press was holding
    // the quit open for, and the last few hundred milliseconds of typing were
    // gone. `flushDone` is set by whichever of the two paths below wins.
    if (!flushDone) {
      e.preventDefault()
      return
    }
    void stopWatching()
    return
  }
  const win = BrowserWindow.getAllWindows()[0]
  if (!win || win.webContents.isDestroyed()) return
  e.preventDefault()
  quitting = true
  const finish = (): void => {
    flushDone = true
    void stopWatching()
    app.quit()
  }
  const timer = setTimeout(finish, 1500)
  ipcMain.once(CH.flushed, () => {
    clearTimeout(timer)
    finish()
  })
  win.webContents.send(CH.beforeQuit)
})
