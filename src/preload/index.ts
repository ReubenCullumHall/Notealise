import { contextBridge, ipcRenderer } from 'electron'
import { CH } from '../shared/channels'
import type { VaultApi, VaultChange } from '../shared/types'

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
  deleteEntry: (p) => ipcRenderer.invoke(CH.deleteEntry, p),
  getSettings: () => ipcRenderer.invoke(CH.getSettings),
  setSettings: (partial) => ipcRenderer.invoke(CH.setSettings, partial),
  getSpaces: () => ipcRenderer.invoke(CH.getSpaces),
  updateSpace: (name, partial) => ipcRenderer.invoke(CH.updateSpace, name, partial),
  reorderSpaces: (names) => ipcRenderer.invoke(CH.reorderSpaces, names),
  renameSpace: (oldName, newName) => ipcRenderer.invoke(CH.renameSpace, oldName, newName),
  deleteSpace: (name) => ipcRenderer.invoke(CH.deleteSpace, name),
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
