import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { CH } from '../shared/channels'
import { saveVault } from './config'
import { ensureMdnotes } from './mdnotes'
import { getSettings, readThemeCacheSync, setSettings } from './settings'
import {
  deletePreset,
  exportPresets,
  importPresets,
  listPresets,
  renamePreset,
  syncPresets
} from './presets'
import {
  deleteSpace,
  getWorkspace,
  migrateKey,
  purgeEntries,
  purgeRecoveryEntries,
  reorderEntries,
  resetWorkspaceForVaultSwitch,
  restoreEntries,
  restoreRecoveryEntries,
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
import { sendBugReport, sendFeatureRequest } from './support'
import { openAllowedExternal } from './externalLinks'
import {
  beginImport,
  getImporter,
  listImporters,
  registerImporter,
  requestImportCancel
} from './importers/types'
import { notionZipImporter } from './importers/notionZip/run'
import { extractZip } from './importers/notionZip/extractZip'
import { htmlImporter } from './importers/html/run'
import { markdownImporter } from './importers/markdown/run'
import { googleKeepImporter } from './importers/googleKeep/run'
import { wordImporter } from './importers/word/run'
import type { ImportFormat } from '../shared/notesImport'
import type { AppSettings } from '../shared/settings'
import type { PresetDraft } from '../shared/presets'
import type { EntryMeta } from '../shared/workspace'
import {
  createFolder,
  createNote,
  getVaultRoot,
  listTree,
  readAsset,
  readNote,
  renameEntry,
  scanLinks,
  setVaultRoot,
  writeNote
} from './vault'

registerImporter('notion', notionZipImporter)
registerImporter('markdown', markdownImporter)
registerImporter('html', htmlImporter)
registerImporter('googleKeep', googleKeepImporter)
registerImporter('word', wordImporter)

// Apple Notes reads the Notes app on the same Mac, so it cannot work anywhere
// else. Two layers, deliberately: the runtime check means the format is never
// registered on Windows (so `import:formats` never offers it and the dropdown
// can't show it), and __MAC_BUILD__ is a build constant that lets rollup drop
// this whole block — dynamic import included — out of the Windows bundle.
declare const __MAC_BUILD__: boolean
if (__MAC_BUILD__ && process.platform === 'darwin') {
  void import('./importers/appleNotes/run').then(({ appleNotesImporter }) => {
    registerImporter('appleNotes', appleNotesImporter)
  })
}

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
  ipcMain.handle(CH.readAsset, (_e, p: string) => readAsset(p))
  ipcMain.handle(CH.writeNote, (_e, p: string, content: string) => writeNote(p, content))
  ipcMain.handle(CH.createNote, (_e, dir: string, name?: string) => createNote(dir, name))
  ipcMain.handle(CH.createFolder, (_e, dir: string, name?: string) => createFolder(dir, name))
  // Rename and re-key together: the filesystem move happens first (it's the part
  // that can fail), then the sidecar follows it so pins and order survive a move.
  ipcMain.handle(CH.renameEntry, async (_e, from: string, to: string) => {
    const actual = await renameEntry(from, to)
    await migrateKey(from, actual)
    return actual
  })

  ipcMain.handle(CH.scanLinks, (_e, paths?: string[]) => scanLinks(paths))

  ipcMain.handle(CH.getSettings, () => getSettings())
  ipcMain.handle(CH.setSettings, (_e, partial: Partial<AppSettings>) => setSettings(partial))

  ipcMain.handle(CH.listPresets, () => listPresets())
  ipcMain.handle(CH.syncPresets, (_e, drafts: PresetDraft[]) => syncPresets(drafts))
  ipcMain.handle(CH.renamePreset, (_e, from: string, to: string, origin: string) =>
    renamePreset(from, to, origin)
  )
  ipcMain.handle(CH.deletePreset, (_e, id: string) => deletePreset(id))
  ipcMain.handle(CH.exportPresets, (_e, ids: string[] | null) => exportPresets(window, ids))
  ipcMain.handle(CH.importPresets, (_e, text?: string) => importPresets(window, text))

  ipcMain.handle(CH.getWorkspace, () => getWorkspace())
  ipcMain.handle(CH.updateEntry, (_e, p: string, partial: EntryMeta) => updateEntries([p], partial))
  ipcMain.handle(CH.updateEntries, (_e, paths: string[], partial: EntryMeta) =>
    updateEntries(paths, partial)
  )
  ipcMain.handle(CH.reorderEntries, (_e, paths: string[]) => reorderEntries(paths))
  ipcMain.handle(CH.trashEntries, (_e, paths: string[]) => trashEntries(paths))
  ipcMain.handle(CH.restoreEntries, (_e, ids: string[]) => restoreEntries(ids))
  ipcMain.handle(CH.purgeEntries, (_e, ids?: string[]) => purgeEntries(ids))
  ipcMain.handle(CH.restoreRecoveryEntries, (_e, ids: string[]) => restoreRecoveryEntries(ids))
  ipcMain.handle(CH.purgeRecoveryEntries, (_e, ids?: string[]) => purgeRecoveryEntries(ids))
  ipcMain.handle(CH.deleteSpace, (_e, folder: string) => deleteSpace(folder))
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
  ipcMain.handle(CH.sendBugReport, (_e, fromEmail: string, message: string) =>
    sendBugReport(fromEmail, message)
  )
  ipcMain.handle(CH.sendFeatureRequest, (_e, fromEmail: string, message: string) =>
    sendFeatureRequest(fromEmail, message)
  )
  ipcMain.handle(CH.openExternal, (_e, url: string) => openAllowedExternal(url))

  // One entry per format rather than an isNotion ternary — the ternary only
  // held two formats, and a third would have silently inherited HTML's filter.
  // `.doc` is deliberately absent from Word's list: the pre-2007 binary format
  // is a different thing entirely and can't be read, so the picker won't offer
  // a file that would only fail later.
  const PICKER: Record<ImportFormat, Electron.OpenDialogOptions> = {
    notion: {
      title: 'Choose your Notion export (.zip or an already-unzipped folder)',
      properties: ['openDirectory', 'openFile'],
      filters: [{ name: 'Notion export', extensions: ['zip'] }]
    },
    markdown: {
      title: 'Choose Markdown files, or a folder of them',
      properties: ['openFile', 'openDirectory', 'multiSelections'],
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'txt'] }]
    },
    html: {
      title: 'Choose HTML files, or a folder of them',
      properties: ['openFile', 'openDirectory', 'multiSelections'],
      filters: [{ name: 'HTML', extensions: ['html', 'htm'] }]
    },
    googleKeep: {
      title: 'Choose the "Keep" folder from your Google Takeout',
      properties: ['openDirectory']
    },
    word: {
      title: 'Choose Word document(s) to import',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Word document', extensions: ['docx'] }]
    },
    // Apple Notes has nothing to pick — the notes come from the Notes app on
    // this Mac, not from a file. Handled before the dialog ever opens.
    appleNotes: { title: '', properties: ['openFile'] }
  }

  ipcMain.handle(CH.importFormats, () => listImporters())

  ipcMain.handle(CH.importPickSource, async (_e, format: ImportFormat) => {
    // Nothing to choose: the source is the Notes app itself. Returning a
    // non-empty array lets the panel's "have I got a source yet" check pass
    // without inventing a second notion of readiness.
    if (format === 'appleNotes') return ['apple-notes']
    const res = await dialog.showOpenDialog(window, PICKER[format] ?? PICKER.html)
    if (res.canceled || res.filePaths.length === 0) return null
    return res.filePaths
  })

  // Deliberately separate from pickSource: unpacking a Notion export is a
  // minutes-long job on a large workspace, and while it was folded into the
  // picker the renderer had nothing to show a spinner around — the app just
  // sat silent after "Open" and looked broken.
  ipcMain.handle(CH.importPrepare, async (_e, format: ImportFormat, paths: string[]) => {
    if (format === 'notion' && paths.length === 1 && paths[0].toLowerCase().endsWith('.zip')) {
      return [await extractZip(paths[0])]
    }
    return paths
  })
  ipcMain.handle(CH.importPreview, (_e, format: ImportFormat, paths: string[]) =>
    getImporter(format).preview(paths)
  )
  ipcMain.handle(CH.importRun, (_e, format: ImportFormat, paths: string[], spaceName: string) => {
    beginImport()
    return getImporter(format).run(paths, spaceName, (p) =>
      win?.webContents.send(CH.importProgress, p)
    )
  })
  ipcMain.handle(CH.importCancel, () => requestImportCancel())

  // Synchronous: the preload bridge reads this before first paint. Re-register
  // cleanly so a re-created window never stacks duplicate listeners.
  ipcMain.removeAllListeners(CH.settingsCache)
  ipcMain.on(CH.settingsCache, (e) => {
    e.returnValue = readThemeCacheSync()
  })
}
