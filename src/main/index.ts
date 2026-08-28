import { app, BrowserWindow, ipcMain } from 'electron'
import path from 'node:path'
import { CH } from '../shared/channels'
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

  win.on('ready-to-show', () => win.show())

  // electron-vite provides ELECTRON_RENDERER_URL in dev; load the built file otherwise.
  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  return win
}

app.whenReady().then(async () => {
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
app.on('before-quit', (e) => {
  if (quitting) {
    void stopWatching()
    return
  }
  const win = BrowserWindow.getAllWindows()[0]
  if (!win || win.webContents.isDestroyed()) return
  e.preventDefault()
  quitting = true
  const finish = (): void => {
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
