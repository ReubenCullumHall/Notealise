import { BrowserWindow, dialog, ipcMain } from 'electron'
import { CH } from '../shared/channels'
import { saveVault } from './config'
import { ensureMdnotes } from './mdnotes'
import { getSettings, readThemeCacheSync, setSettings } from './settings'
import {
  deleteSpace,
  getSpaces,
  renameSpace,
  reorderSpaces,
  resetSpacesForVaultSwitch,
  updateSpace
} from './spaces'
import { startWatching } from './watcher'
import type { AppSettings } from '../shared/settings'
import type { SpaceMeta } from '../shared/spaces'
import {
  createFolder,
  createNote,
  deleteEntry,
  getVaultRoot,
  listTree,
  readNote,
  renameEntry,
  setVaultRoot,
  writeNote
} from './vault'

let win: BrowserWindow | null = null

/** Point the vault at `root`: set the boundary, then (re)start the watcher so
 *  external changes are pushed to the renderer. Used on launch and on pick. */
export function activateVault(root: string): void {
  // Flush the outgoing vault's pending spaces write and drop its in-memory map
  // before repointing, so nothing leaks across a vault switch (non-blocking).
  void resetSpacesForVaultSwitch()
  setVaultRoot(root)
  void ensureMdnotes(root) // create the hidden in-vault config folder (non-blocking)
  startWatching(root, (change) => {
    win?.webContents.send(CH.changed, change)
  })
}

export function registerIpc(window: BrowserWindow): void {
  win = window

  ipcMain.handle(CH.getVault, () => getVaultRoot())

  ipcMain.handle(CH.pickVault, async () => {
    const res = await dialog.showOpenDialog(window, {
      title: 'Choose your vault folder',
      properties: ['openDirectory', 'createDirectory']
    })
    if (res.canceled || res.filePaths.length === 0) return null
    const root = res.filePaths[0]
    await saveVault(root)
    activateVault(root)
    return root
  })

  ipcMain.handle(CH.listTree, () => listTree())
  ipcMain.handle(CH.readNote, (_e, p: string) => readNote(p))
  ipcMain.handle(CH.writeNote, (_e, p: string, content: string) => writeNote(p, content))
  ipcMain.handle(CH.createNote, (_e, dir: string, name: string) => createNote(dir, name))
  ipcMain.handle(CH.createFolder, (_e, p: string) => createFolder(p))
  ipcMain.handle(CH.renameEntry, (_e, from: string, to: string) => renameEntry(from, to))
  ipcMain.handle(CH.deleteEntry, (_e, p: string) => deleteEntry(p))

  ipcMain.handle(CH.getSettings, () => getSettings())
  ipcMain.handle(CH.setSettings, (_e, partial: Partial<AppSettings>) => setSettings(partial))

  ipcMain.handle(CH.getSpaces, () => getSpaces())
  ipcMain.handle(CH.updateSpace, (_e, name: string, partial: SpaceMeta) => updateSpace(name, partial))
  ipcMain.handle(CH.reorderSpaces, (_e, names: string[]) => reorderSpaces(names))
  ipcMain.handle(CH.renameSpace, (_e, from: string, to: string) => renameSpace(from, to))
  ipcMain.handle(CH.deleteSpace, (_e, name: string) => deleteSpace(name))
  // Synchronous: the preload bridge reads this before first paint. Re-register
  // cleanly so a re-created window never stacks duplicate listeners.
  ipcMain.removeAllListeners(CH.settingsCache)
  ipcMain.on(CH.settingsCache, (e) => {
    e.returnValue = readThemeCacheSync()
  })
}
