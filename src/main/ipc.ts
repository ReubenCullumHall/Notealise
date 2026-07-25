import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { CH } from '../shared/channels'
import { saveVault } from './config'
import { ensureMdnotes } from './mdnotes'
import { getSettings, readThemeCacheSync, setSettings } from './settings'
import {
  getWorkspace,
  migrateKey,
  purgeEntries,
  reorderEntries,
  resetWorkspaceForVaultSwitch,
  restoreEntries,
  trashEntries,
  updateEntries
} from './workspace'
import {
  checkNow,
  currentStatus,
  downloadUpdate,
  installNow,
  openReleasesPage,
  setAutoUpdate,
  setBetaChannel
} from './updater'
import { getUpdatePrefs } from './config'
import { startWatching } from './watcher'
import type { AppSettings } from '../shared/settings'
import type { EntryMeta } from '../shared/workspace'
import {
  createFolder,
  createNote,
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
  // Flush the outgoing vault's pending workspace write and drop its in-memory
  // state before repointing, so nothing leaks across a vault switch.
  void resetWorkspaceForVaultSwitch()
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
  // Rename and re-key together: the filesystem move happens first (it's the part
  // that can fail), then the sidecar follows it so pins and order survive a move.
  ipcMain.handle(CH.renameEntry, async (_e, from: string, to: string) => {
    const actual = await renameEntry(from, to)
    await migrateKey(from, actual)
    return actual
  })

  ipcMain.handle(CH.getSettings, () => getSettings())
  ipcMain.handle(CH.setSettings, (_e, partial: Partial<AppSettings>) => setSettings(partial))

  ipcMain.handle(CH.getWorkspace, () => getWorkspace())
  ipcMain.handle(CH.updateEntry, (_e, p: string, partial: EntryMeta) => updateEntries([p], partial))
  ipcMain.handle(CH.updateEntries, (_e, paths: string[], partial: EntryMeta) =>
    updateEntries(paths, partial)
  )
  ipcMain.handle(CH.reorderEntries, (_e, paths: string[]) => reorderEntries(paths))
  ipcMain.handle(CH.trashEntries, (_e, paths: string[]) => trashEntries(paths))
  ipcMain.handle(CH.restoreEntries, (_e, ids: string[]) => restoreEntries(ids))
  ipcMain.handle(CH.purgeEntries, (_e, ids?: string[]) => purgeEntries(ids))
  ipcMain.handle(CH.getUpdateState, async () => ({
    version: app.getVersion(),
    status: currentStatus(),
    prefs: await getUpdatePrefs()
  }))
  ipcMain.handle(CH.checkForUpdate, () => checkNow())
  ipcMain.handle(CH.downloadUpdate, () => downloadUpdate())
  ipcMain.handle(CH.setAutoUpdate, (_e, on: boolean) => setAutoUpdate(on))
  ipcMain.handle(CH.setBetaChannel, (_e, on: boolean) => setBetaChannel(on))
  ipcMain.on(CH.installUpdate, () => installNow())
  ipcMain.on(CH.openReleases, () => void openReleasesPage())

  // Synchronous: the preload bridge reads this before first paint. Re-register
  // cleanly so a re-created window never stacks duplicate listeners.
  ipcMain.removeAllListeners(CH.settingsCache)
  ipcMain.on(CH.settingsCache, (e) => {
    e.returnValue = readThemeCacheSync()
  })
}
