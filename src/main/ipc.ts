import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { CH } from '../shared/channels'
import {
  freshOnboardingTestVault,
  getHasOnboarded,
  getOnboardingStep,
  saveVault,
  setHasOnboarded,
  setOnboardingStep,
  vaultLooksEstablished
} from './config'
import { exportTransfer, importTransfer, transferInventory } from './transfer'
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
import { downloadFont, importCustomFont, listInstalledFonts, removeFont } from './fonts'
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
  canSelfInstall,
  checkNow,
  currentStatus,
  downloadUpdate,
  installNow,
  openReleasesPage,
  setAutoUpdate,
  revealUpdate
} from './updater'
import { getUpdatePrefs } from './config'

/** When this main process started. `npm run dev` hot-reloads the renderer and
 *  leaves main running, so a window can end up minutes newer than the process
 *  it is talking to — which is how an IPC contract change becomes a crash that
 *  looks like a bug in the feature. This is what makes that visible. */
const MAIN_STARTED_AT = Date.now()
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
import type { ImportFormat, ImportPickMode } from '../shared/notesImport'
import type { AppSettings } from '../shared/settings'
import type { PresetDraft } from '../shared/presets'
import type { EntryMeta, MediaOrigin } from '../shared/workspace'
import {
  IMAGE_EXTS,
  VIDEO_EXTS,
  kindForFilename,
  type AttachmentKind
} from '../shared/attachments'
import { promises as fsp } from 'node:fs'
import path from 'node:path'
import {
  createFolder,
  createNote,
  getVaultRoot,
  listTree,
  readAsset,
  readNote,
  renameEntry,
  revealInFolder,
  scanLinks,
  setVaultRoot,
  writeAssetUnique,
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

// The "Attach…" picker's filters and the check applied to what comes back (a
// file dialog's OS-level type filter is advisory on some platforms). The lists
// themselves live in shared/attachments.ts, which the renderer's paste/drop
// path reads too — see that file's header for why one catalogue rather than a
// list here and a MIME table over there.
const attachmentKind = (abs: string): AttachmentKind | null => kindForFilename(path.basename(abs))

let win: BrowserWindow | null = null

/** Have the `ipcMain.handle` registrations been done for this process?
 *
 *  `ipcMain.handle` THROWS on a second registration for the same channel, and
 *  the handlers are process-wide, not per-window — so calling `registerIpc`
 *  again for a second window is not "re-wiring the new window", it is an
 *  uncaught exception in main, which Electron turns into a "A JavaScript error
 *  occurred in the main process" dialog. On macOS that is an ordinary gesture:
 *  close the window (the app stays running), then click the Dock icon. */
let handlersRegistered = false

/** The window IPC should talk to right now.
 *
 *  Handlers used to close over the `window` argument of the registration that
 *  created them, which was fine while there was only ever one registration and
 *  one window. Now that they are registered once for the life of the process,
 *  a captured reference would still point at the FIRST window — so every file
 *  dialog would be parented to a destroyed window (on macOS it opens as a
 *  free-floating panel instead of a sheet) long after that window is gone. */
function activeWindow(): BrowserWindow {
  if (win && !win.isDestroyed()) return win
  const fallback = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  if (!fallback) throw new Error('No window is open')
  return fallback
}

/** Push to the renderer, or do nothing if there is no live window.
 *
 *  `win?.` alone was not enough: `win` was assigned once and never cleared, so
 *  after the window closed it held a destroyed `BrowserWindow` and `.webContents`
 *  threw `Object has been destroyed`. From the import-progress callback that
 *  rejected `run()` mid-import; from the watcher callback — a plain chokidar
 *  listener, not a promise chain — it was an uncaught exception in main. */
function sendToWindow(channel: string, payload: unknown): void {
  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return
  win.webContents.send(channel, payload)
}

/** Point the vault at `root`: set the boundary, then (re)start the watcher so
 *  external changes are pushed to the renderer. Used on launch and on pick. */
export function activateVault(root: string): void {
  // Flush the outgoing vault's pending workspace write and drop its in-memory
  // state before repointing, so nothing leaks across a vault switch.
  void resetWorkspaceForVaultSwitch()
  setVaultRoot(root)
  // Non-blocking, but not unhandled: fs.mkdir rejects on a read-only or
  // permission-denied vault folder, and an unhandled rejection in main is a
  // process-level crash, not a log line.
  void ensureMdnotes(root).catch((e) => console.error('could not create .mdnotes', e))
  startWatching(root, (change) => {
    sendToWindow(CH.changed, change)
  })
}

export function registerIpc(window: BrowserWindow): void {
  win = window
  // Drop the reference the moment the window goes, so `sendToWindow` and
  // `activeWindow` can tell "no window" from "a window that used to exist".
  window.on('closed', () => {
    if (win === window) win = null
  })
  if (handlersRegistered) return
  handlersRegistered = true

  ipcMain.handle(CH.getVault, () => getVaultRoot())

  ipcMain.handle(CH.pickVault, async () => {
    const res = await dialog.showOpenDialog(activeWindow(), {
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
  // Validated the same way `pickAttachment` below validates its own results —
  // this channel used to write whatever filename and bytes the renderer handed
  // it, which is the one attachment path with no type check at all. It also
  // closes the `.png` case: a name that is nothing but a dotted suffix has no
  // extension by `path.parse`'s reading, so it would otherwise land in the
  // vault as a hidden, extensionless file nothing can open.
  ipcMain.handle(CH.writeAsset, (_e, dir: string, filename: string, data: Uint8Array) => {
    if (!kindForFilename(filename)) throw new Error(`Not a photo or video: ${filename}`)
    return writeAssetUnique(dir, filename, Buffer.from(data))
  })
  ipcMain.handle(CH.pickAttachment, async (_e, dir: string) => {
    const res = await dialog.showOpenDialog(activeWindow(), {
      title: 'Attach a photo or video',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Photos & videos', extensions: [...IMAGE_EXTS, ...VIDEO_EXTS] },
        { name: 'Photos', extensions: [...IMAGE_EXTS] },
        { name: 'Videos', extensions: [...VIDEO_EXTS] }
      ]
    })
    if (res.canceled || res.filePaths.length === 0) return null
    const out: { path: string; kind: 'image' | 'video' }[] = []
    for (const abs of res.filePaths) {
      const kind = attachmentKind(abs)
      if (!kind) continue // filter dialogs are advisory on some OSes; skip anything else picked
      try {
        const data = await fsp.readFile(abs)
        const relPath = await writeAssetUnique(dir, path.basename(abs), data)
        out.push({ path: relPath, kind })
      } catch {
        // One unreadable file (permissions, a vanished path) must not lose
        // every other file the user picked alongside it.
      }
    }
    return out
  })
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
  ipcMain.handle(CH.exportPresets, (_e, ids: string[] | null) => exportPresets(activeWindow(), ids))
  ipcMain.handle(CH.importPresets, (_e, text?: string) => importPresets(activeWindow(), text))

  ipcMain.handle(CH.listInstalledFonts, () => listInstalledFonts())
  ipcMain.handle(CH.downloadFont, (_e, id: string) => downloadFont(id))
  ipcMain.handle(CH.importCustomFont, () => importCustomFont(activeWindow()))
  ipcMain.handle(CH.removeFont, (_e, id: string) => removeFont(id))

  ipcMain.handle(CH.getWorkspace, () => getWorkspace())
  ipcMain.handle(CH.updateEntry, (_e, p: string, partial: EntryMeta) => updateEntries([p], partial))
  ipcMain.handle(CH.updateEntries, (_e, paths: string[], partial: EntryMeta) =>
    updateEntries(paths, partial)
  )
  ipcMain.handle(CH.reorderEntries, (_e, paths: string[]) => reorderEntries(paths))
  ipcMain.handle(CH.trashEntries, (_e, paths: string[], origins?: Record<string, MediaOrigin>) =>
    trashEntries(paths, origins)
  )
  ipcMain.handle(CH.restoreEntries, (_e, ids: string[]) => restoreEntries(ids))
  ipcMain.handle(CH.purgeEntries, (_e, ids?: string[]) => purgeEntries(ids))
  ipcMain.handle(CH.restoreRecoveryEntries, (_e, ids: string[]) => restoreRecoveryEntries(ids))
  ipcMain.handle(CH.purgeRecoveryEntries, (_e, ids?: string[]) => purgeRecoveryEntries(ids))
  ipcMain.handle(CH.deleteSpace, (_e, folder: string) => deleteSpace(folder))
  ipcMain.handle(CH.getUpdateState, async () => ({
    version: app.getVersion(),
    status: currentStatus(),
    prefs: await getUpdatePrefs(),
    // Answered here rather than inferred from a status field, because the
    // renderer needs it before any check has run — see canSelfInstall.
    selfInstall: canSelfInstall()
  }))
  ipcMain.handle(CH.checkForUpdate, () => checkNow())
  ipcMain.handle(CH.downloadUpdate, () => downloadUpdate())
  ipcMain.handle(CH.setAutoUpdate, (_e, on: boolean) => setAutoUpdate(on))
  ipcMain.on(CH.installUpdate, () => installNow())
  ipcMain.handle(CH.revealUpdate, () => revealUpdate())
  // ipcMain.on does NOT wrap its listener the way ipcMain.handle does, so a
  // rejection from shell.openExternal here would be unhandled.
  ipcMain.on(CH.openReleases, () =>
    void openReleasesPage().catch((e) => console.error('could not open the releases page', e))
  )
  ipcMain.handle(CH.sendBugReport, (_e, fromEmail: string, message: string) =>
    sendBugReport(fromEmail, message)
  )
  ipcMain.handle(CH.sendFeatureRequest, (_e, fromEmail: string, message: string) =>
    sendFeatureRequest(fromEmail, message)
  )
  ipcMain.handle(CH.openExternal, (_e, url: string) => openAllowedExternal(url))
  ipcMain.handle(CH.exportTransfer, () => exportTransfer(activeWindow()))
  ipcMain.handle(CH.importTransfer, (_e, text?: string) => importTransfer(activeWindow(), text))
  ipcMain.handle(CH.transferInventory, () => transferInventory())
  ipcMain.handle(CH.vaultEstablished, () => {
    const root = getVaultRoot()
    return root ? vaultLooksEstablished(root) : false
  })
  ipcMain.handle(CH.getOnboarded, () => getHasOnboarded())
  ipcMain.handle(CH.setOnboarded, (_e, value: boolean) => setHasOnboarded(value))
  ipcMain.handle(CH.getOnboardingStep, () => getOnboardingStep())
  ipcMain.handle(CH.setOnboardingStep, (_e, step: string | null) => setOnboardingStep(step))
  ipcMain.handle(CH.resetOnboardingTestVault, async () => {
    const dir = await freshOnboardingTestVault()
    // activateVault ONLY — deliberately not saveVault. This points the running
    // process at the throwaway folder, which is all the renderer's reload needs
    // (App.tsx boots from getVault(), the in-process root, not from config).
    // Persisting it would overwrite `vaultPath` — the record of which vault to
    // reopen — with a temp directory, so a dev who used this hook and then quit
    // would find the app reopening the throwaway folder instead of their real
    // vault, with no backup of the path it replaced. Their notes were never at
    // risk; the bookkeeping was.
    activateVault(dir)
    await setHasOnboarded(false)
    // A genuinely blank slate — without this, a Reset mid-way through a
    // previous test run would resume onboarding at wherever that run left
    // off instead of starting fresh at Welcome.
    await setOnboardingStep(null)
    return dir
  })
  ipcMain.handle(CH.revealInFolder, (_e, p: string) => revealInFolder(p))
  // MAIN_STARTED_AT is module-level, so it is the moment this process booted —
  // not the moment the window asked.
  ipcMain.handle(CH.bootInfo, () => ({ startedAt: MAIN_STARTED_AT, version: app.getVersion() }))

  // One entry per format rather than an isNotion ternary — the ternary only
  // held two formats, and a third would have silently inherited HTML's filter.
  // `.doc` is deliberately absent from Word's list: the pre-2007 binary format
  // is a different thing entirely and can't be read, so the picker won't offer
  // a file that would only fail later.
  // One dialog per pick mode, rather than one options object per format.
  //
  // `both` is the combined dialog — a single "choose a file OR a folder"
  // panel. macOS's NSOpenPanel does that; Windows and Linux cannot, and
  // Electron resolves the conflict by SILENTLY dropping the file half whenever
  // `openDirectory` is present. So the old combined-only table meant that on
  // Windows the Notion picker was folder-only and typing a .zip path into it
  // was answered with "The folder name is not valid" — against a dialog titled
  // "Choose your Notion export (.zip or an already-unzipped folder)". Markdown
  // and HTML had the same shape and so lost single-file imports too. Found on
  // Windows 11, 2026-09-05; it had been that way in every Windows build.
  //
  // `both` is therefore offered ONLY where it actually works, and the two
  // single-purpose dialogs stand in elsewhere. Keeping `both` verbatim matters:
  // it is what macOS still gets, unchanged.
  const PICKER: Record<
    ImportFormat,
    Partial<Record<ImportPickMode, Electron.OpenDialogOptions>>
  > = {
    notion: {
      both: {
        title: 'Choose your Notion export (.zip or an already-unzipped folder)',
        properties: ['openDirectory', 'openFile'],
        filters: [{ name: 'Notion export', extensions: ['zip'] }]
      },
      file: {
        title: 'Choose your Notion export .zip',
        properties: ['openFile'],
        filters: [{ name: 'Notion export', extensions: ['zip'] }]
      },
      folder: {
        title: 'Choose your unzipped Notion export folder',
        properties: ['openDirectory']
      }
    },
    markdown: {
      both: {
        title: 'Choose Markdown files, or a folder of them',
        properties: ['openFile', 'openDirectory', 'multiSelections'],
        filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'txt'] }]
      },
      file: {
        title: 'Choose Markdown files',
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'txt'] }]
      },
      folder: {
        title: 'Choose a folder of Markdown files',
        properties: ['openDirectory']
      }
    },
    html: {
      both: {
        title: 'Choose HTML files, or a folder of them',
        properties: ['openFile', 'openDirectory', 'multiSelections'],
        filters: [{ name: 'HTML', extensions: ['html', 'htm'] }]
      },
      file: {
        title: 'Choose HTML files',
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: 'HTML', extensions: ['html', 'htm'] }]
      },
      folder: {
        title: 'Choose a folder of HTML files',
        properties: ['openDirectory']
      }
    },
    // These two were never ambiguous — one mode each, so they were correct on
    // every platform already and are listed here unchanged.
    googleKeep: {
      folder: {
        title: 'Choose the "Keep" folder from your Google Takeout',
        properties: ['openDirectory']
      }
    },
    word: {
      file: {
        title: 'Choose Word document(s) to import',
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: 'Word document', extensions: ['docx'] }]
      }
    },
    // Apple Notes has nothing to pick — the notes come from the Notes app on
    // this Mac, not from a file. Handled before the dialog ever opens, so it
    // offers no modes at all.
    appleNotes: {}
  }

  /** Which source-picking dialogs to offer for a format on THIS platform.
   *
   *  Sent to the renderer with the format list rather than recomputed there,
   *  for the same reason `listImporters` is: "what main can do" and "what the
   *  UI offers" must not be able to drift apart. A format that declares `both`
   *  uses it only where a combined dialog really works. */
  const pickModesFor = (format: ImportFormat): ImportPickMode[] => {
    const spec = PICKER[format]
    if (spec.both && process.platform === 'darwin') return ['both']
    const modes: ImportPickMode[] = []
    if (spec.file) modes.push('file')
    if (spec.folder) modes.push('folder')
    // A format that only declares `both` on a platform that cannot show one
    // would otherwise offer nothing at all — fall back rather than dead-end.
    return modes.length > 0 ? modes : spec.both ? ['both'] : []
  }

  /** Paths the USER chose in a file dialog, plus the extraction folders derived
   *  from them.
   *
   *  `importPreview` and `importRun` take a `paths` argument, and nothing tied
   *  it to what the picker actually returned — so the renderer could name any
   *  directory it liked and have main walk it. `importRun('markdown',
   *  ['/Users/<you>/Documents'], 'x')` copied every .md, .txt, .png, .pdf under
   *  ~/Documents into the vault, where `readNote` hands them straight back.
   *  A dialog the user answered is the only thing that makes a path outside the
   *  vault legitimate, so that answer is what gets remembered. */
  const pickedSources = new Set<string>()
  const assertPicked = (paths: string[]): void => {
    for (const p of paths) {
      if (!pickedSources.has(p)) throw new Error(`Not a chosen import source: ${p}`)
    }
  }

  ipcMain.handle(CH.importFormats, () =>
    listImporters().map((id) => ({ id, pickModes: pickModesFor(id) }))
  )

  ipcMain.handle(CH.importPickSource, async (_e, format: ImportFormat, mode: ImportPickMode) => {
    // Nothing to choose: the source is the Notes app itself. Returning a
    // non-empty array lets the panel's "have I got a source yet" check pass
    // without inventing a second notion of readiness.
    if (format === 'appleNotes') {
      // A sentinel, not a path — but it still has to pass `assertPicked`, and
      // it is only reachable once the user has chosen the Apple Notes format.
      pickedSources.add('apple-notes')
      return ['apple-notes']
    }
    // The mode comes from the renderer, so it is checked against what this
    // format actually offers rather than trusted — not a security boundary
    // (the user still answers the dialog either way), but an unknown mode
    // would otherwise open `undefined` options.
    const offered = pickModesFor(format)
    const chosen = offered.includes(mode) ? mode : offered[0]
    const options = chosen ? PICKER[format][chosen] : undefined
    if (!options) return null
    const res = await dialog.showOpenDialog(activeWindow(), options)
    if (res.canceled || res.filePaths.length === 0) return null
    for (const p of res.filePaths) pickedSources.add(p)
    return res.filePaths
  })

  // Deliberately separate from pickSource: unpacking a Notion export is a
  // minutes-long job on a large workspace, and while it was folded into the
  // picker the renderer had nothing to show a spinner around — the app just
  // sat silent after "Open" and looked broken.
  ipcMain.handle(CH.importPrepare, async (_e, format: ImportFormat, paths: string[]) => {
    assertPicked(paths)
    if (format === 'notion' && paths.length === 1 && paths[0].toLowerCase().endsWith('.zip')) {
      // The unpacked folder stands in for the archive the user chose, so it is
      // a legitimate source for the preview/run that follow.
      const extracted = await extractZip(paths[0])
      pickedSources.add(extracted)
      return [extracted]
    }
    return paths
  })
  ipcMain.handle(CH.importPreview, (_e, format: ImportFormat, paths: string[]) => {
    assertPicked(paths)
    return getImporter(format).preview(paths)
  })
  ipcMain.handle(CH.importRun, (_e, format: ImportFormat, paths: string[], spaceName: string) => {
    assertPicked(paths)
    beginImport()
    return getImporter(format).run(paths, spaceName, (p) => sendToWindow(CH.importProgress, p))
  })
  ipcMain.handle(CH.importCancel, () => requestImportCancel())

  // Synchronous: the preload bridge reads this before first paint. Re-register
  // cleanly so a re-created window never stacks duplicate listeners.
  ipcMain.removeAllListeners(CH.settingsCache)
  ipcMain.on(CH.settingsCache, (e) => {
    e.returnValue = readThemeCacheSync()
  })
}
