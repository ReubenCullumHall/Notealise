import { contextBridge, ipcRenderer } from 'electron'
import { CH } from '../shared/channels'
import type { VaultApi, VaultChange } from '../shared/types'
import type { UpdateStatus } from '../shared/update'
import type { ImportProgress } from '../shared/notesImport'

// The single, typed bridge between renderer and main. With contextIsolation the
// renderer can only reach the filesystem through these calls — every path is
// validated against the vault root in the main process.
const api: VaultApi = {
  getVault: () => ipcRenderer.invoke(CH.getVault),
  pickVault: () => ipcRenderer.invoke(CH.pickVault),
  listTree: () => ipcRenderer.invoke(CH.listTree),
  readNote: (p) => ipcRenderer.invoke(CH.readNote, p),
  readAsset: (p) => ipcRenderer.invoke(CH.readAsset, p),
  writeNote: (p, content) => ipcRenderer.invoke(CH.writeNote, p, content),
  createNote: (dir, name) => ipcRenderer.invoke(CH.createNote, dir, name),
  createFolder: (dir, name) => ipcRenderer.invoke(CH.createFolder, dir, name),
  renameEntry: (from, to) => ipcRenderer.invoke(CH.renameEntry, from, to),
  scanLinks: (paths) => ipcRenderer.invoke(CH.scanLinks, paths),
  getSettings: () => ipcRenderer.invoke(CH.getSettings),
  setSettings: (partial) => ipcRenderer.invoke(CH.setSettings, partial),
  listPresets: () => ipcRenderer.invoke(CH.listPresets),
  syncPresets: (drafts) => ipcRenderer.invoke(CH.syncPresets, drafts),
  renamePreset: (from, to, origin) => ipcRenderer.invoke(CH.renamePreset, from, to, origin),
  deletePreset: (id) => ipcRenderer.invoke(CH.deletePreset, id),
  exportPresets: (ids) => ipcRenderer.invoke(CH.exportPresets, ids),
  importPresets: (text) => ipcRenderer.invoke(CH.importPresets, text),
  listInstalledFonts: () => ipcRenderer.invoke(CH.listInstalledFonts),
  downloadFont: (id) => ipcRenderer.invoke(CH.downloadFont, id),
  importCustomFont: () => ipcRenderer.invoke(CH.importCustomFont),
  removeCustomFont: (id) => ipcRenderer.invoke(CH.removeCustomFont, id),
  getWorkspace: () => ipcRenderer.invoke(CH.getWorkspace),
  updateEntry: (p, partial) => ipcRenderer.invoke(CH.updateEntry, p, partial),
  updateEntries: (paths, partial) => ipcRenderer.invoke(CH.updateEntries, paths, partial),
  reorderEntries: (paths) => ipcRenderer.invoke(CH.reorderEntries, paths),
  trashEntries: (paths) => ipcRenderer.invoke(CH.trashEntries, paths),
  restoreEntries: (ids) => ipcRenderer.invoke(CH.restoreEntries, ids),
  purgeEntries: (ids) => ipcRenderer.invoke(CH.purgeEntries, ids),
  restoreRecoveryEntries: (ids) => ipcRenderer.invoke(CH.restoreRecoveryEntries, ids),
  purgeRecoveryEntries: (ids) => ipcRenderer.invoke(CH.purgeRecoveryEntries, ids),
  deleteSpace: (folder) => ipcRenderer.invoke(CH.deleteSpace, folder),
  getUpdateState: () => ipcRenderer.invoke(CH.getUpdateState),
  checkForUpdate: () => ipcRenderer.invoke(CH.checkForUpdate),
  downloadUpdate: () => ipcRenderer.invoke(CH.downloadUpdate),
  installUpdate: () => ipcRenderer.send(CH.installUpdate),
  setAutoUpdate: (on) => ipcRenderer.invoke(CH.setAutoUpdate, on),
  setBetaChannel: (on) => ipcRenderer.invoke(CH.setBetaChannel, on),
  openReleases: () => ipcRenderer.send(CH.openReleases),
  sendBugReport: (fromEmail, message) => ipcRenderer.invoke(CH.sendBugReport, fromEmail, message),
  sendFeatureRequest: (fromEmail, message) =>
    ipcRenderer.invoke(CH.sendFeatureRequest, fromEmail, message),
  openExternal: (url) => ipcRenderer.invoke(CH.openExternal, url),
  getOnboarded: () => ipcRenderer.invoke(CH.getOnboarded),
  setOnboarded: (value) => ipcRenderer.invoke(CH.setOnboarded, value),
  revealInFolder: (p) => ipcRenderer.invoke(CH.revealInFolder, p),
  resetOnboardingTestVault: () => ipcRenderer.invoke(CH.resetOnboardingTestVault),
  importFormats: () => ipcRenderer.invoke(CH.importFormats),
  importPickSource: (format) => ipcRenderer.invoke(CH.importPickSource, format),
  importPrepare: (format, paths) => ipcRenderer.invoke(CH.importPrepare, format, paths),
  importPreview: (format, paths) => ipcRenderer.invoke(CH.importPreview, format, paths),
  importRun: (format, paths, spaceName) =>
    ipcRenderer.invoke(CH.importRun, format, paths, spaceName),
  importCancel: () => ipcRenderer.invoke(CH.importCancel),
  onImportProgress: (cb) => {
    const listener = (_e: unknown, p: ImportProgress): void => cb(p)
    ipcRenderer.on(CH.importProgress, listener)
    return () => {
      ipcRenderer.removeListener(CH.importProgress, listener)
    }
  },
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
type PaintCache = { theme: string; density: string; textTone: string; buttonDefinition: boolean }
let themeCache: PaintCache = { theme: 'dark', density: 'cozy', textTone: 'grey', buttonDefinition: false }
try {
  const c = ipcRenderer.sendSync(CH.settingsCache) as PaintCache | undefined
  if (c && typeof c === 'object') themeCache = c
} catch {
  /* main handler not ready — dark default is already applied statically */
}
contextBridge.exposeInMainWorld('mdnotesTheme', themeCache)
