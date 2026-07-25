import { contextBridge, ipcRenderer } from 'electron'
import { CH } from '../shared/channels'
import type { VaultApi, VaultChange } from '../shared/types'
import type { UpdateStatus } from '../shared/update'

// The single, typed bridge between renderer and main. With contextIsolation the
// renderer can only reach the filesystem through these calls — every path is
// validated against the vault root in the main process.
const api: VaultApi = {
  getVault: () => ipcRenderer.invoke(CH.getVault),
  pickVault: () => ipcRenderer.invoke(CH.pickVault),
  listTree: () => ipcRenderer.invoke(CH.listTree),
  readNote: (p) => ipcRenderer.invoke(CH.readNote, p),
  writeNote: (p, content) => ipcRenderer.invoke(CH.writeNote, p, content),
  createNote: (dir, name) => ipcRenderer.invoke(CH.createNote, dir, name),
  createFolder: (p) => ipcRenderer.invoke(CH.createFolder, p),
  renameEntry: (from, to) => ipcRenderer.invoke(CH.renameEntry, from, to),
  getSettings: () => ipcRenderer.invoke(CH.getSettings),
  setSettings: (partial) => ipcRenderer.invoke(CH.setSettings, partial),
  getWorkspace: () => ipcRenderer.invoke(CH.getWorkspace),
  updateEntry: (p, partial) => ipcRenderer.invoke(CH.updateEntry, p, partial),
  updateEntries: (paths, partial) => ipcRenderer.invoke(CH.updateEntries, paths, partial),
  reorderEntries: (paths) => ipcRenderer.invoke(CH.reorderEntries, paths),
  trashEntries: (paths) => ipcRenderer.invoke(CH.trashEntries, paths),
  restoreEntries: (ids) => ipcRenderer.invoke(CH.restoreEntries, ids),
  purgeEntries: (ids) => ipcRenderer.invoke(CH.purgeEntries, ids),
  getUpdateState: () => ipcRenderer.invoke(CH.getUpdateState),
  checkForUpdate: () => ipcRenderer.invoke(CH.checkForUpdate),
  downloadUpdate: () => ipcRenderer.invoke(CH.downloadUpdate),
  installUpdate: () => ipcRenderer.send(CH.installUpdate),
  setAutoUpdate: (on) => ipcRenderer.invoke(CH.setAutoUpdate, on),
  openReleases: () => ipcRenderer.send(CH.openReleases),
  onUpdateStatus: (cb) => {
    const listener = (_e: unknown, status: UpdateStatus): void => cb(status)
    ipcRenderer.on(CH.updateStatus, listener)
    return () => {
      ipcRenderer.removeListener(CH.updateStatus, listener)
    }
  },
  onVaultChanged: (cb) => {
    const listener = (_e: unknown, change: VaultChange): void => cb(change)
    ipcRenderer.on(CH.changed, listener)
    return () => {
      ipcRenderer.removeListener(CH.changed, listener)
    }
  },
  onMenuCommand: (cb) => {
    const listener = (_e: unknown, cmd: string): void => cb(cmd)
    ipcRenderer.on(CH.menuCommand, listener)
    return () => {
      ipcRenderer.removeListener(CH.menuCommand, listener)
    }
  },
  onBeforeQuit: (cb) => {
    const listener = (): void => cb()
    ipcRenderer.on(CH.beforeQuit, listener)
    return () => {
      ipcRenderer.removeListener(CH.beforeQuit, listener)
    }
  },
  notifyFlushed: () => ipcRenderer.send(CH.flushed)
}

contextBridge.exposeInMainWorld('api', api)

// Fetched synchronously (before the renderer's first paint) so index.html can set
// [data-theme]/[data-density] on <html> immediately — no flash of the wrong theme.
let themeCache: { theme: string; density: string } = { theme: 'dark', density: 'cozy' }
try {
  const c = ipcRenderer.sendSync(CH.settingsCache) as { theme: string; density: string } | undefined
  if (c && typeof c === 'object') themeCache = c
} catch {
  /* main handler not ready — dark default is already applied statically */
}
contextBridge.exposeInMainWorld('mdnotesTheme', themeCache)
