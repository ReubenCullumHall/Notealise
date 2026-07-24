import { app, BrowserWindow, ipcMain } from 'electron'
import path from 'node:path'
import { CH } from '../shared/channels'
import { getSavedVault } from './config'
import { activateVault, registerIpc } from './ipc'
import { installMenu } from './menu'
import { stopWatching } from './watcher'

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
  const win = createWindow()
  registerIpc(win)

  // Open straight into the saved vault if it still exists; otherwise the
  // renderer shows the folder picker (getVault() returns null).
  const saved = await getSavedVault()
  if (saved) activateVault(saved)

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
