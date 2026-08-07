// Shared contract between main, preload, and renderer.
// Pure types only — safe to import from any process.

import type { AppSettings } from './settings'
import type { PresetDraft, PresetImportResult, SpacePreset } from './presets'
import type { EntryMeta, Workspace } from './workspace'
import type { LinkRow } from './links'
import type { UpdatePrefs, UpdateStatus } from './update'
import type { ImportFormat, ImportPreview, ImportProgress, ImportResult } from './notesImport'

/** A node in the vault file tree. `path` is always vault-relative, POSIX-style
 *  ("/" separators), and "" denotes the vault root. */
export interface TreeNode {
  name: string
  /** vault-relative path, e.g. "notes/todo.md" ("" for the root) */
  path: string
  type: 'dir' | 'file'
  /** present only when type === 'dir' */
  children?: TreeNode[]
  /** files only: a short plain-text snippet of the note's opening, for the
   *  second line of a sidebar row. Absent when the file couldn't be read. */
  preview?: string
  /** files only, epoch ms. Absent when the file couldn't be stat'd — which is
   *  why the UI must treat them as optional rather than as "1970". */
  createdAt?: number
  updatedAt?: number
}

/** Pushed to the renderer (debounced) when the watcher sees external changes.
 *  `paths` are vault-relative. The renderer re-fetches the tree; if the open
 *  note is among `paths` it re-reads it. */
export interface VaultChange {
  paths: string[]
}

/** The typed API exposed on `window.api` by the preload bridge. Every path
 *  argument is vault-relative and validated against the vault root in main. */
export interface VaultApi {
  /** Current vault path, or null if none is set / the saved one is gone. */
  getVault(): Promise<string | null>
  /** Open the OS folder picker; persists and returns the chosen path, or null
   *  if the user cancelled. */
  pickVault(): Promise<string | null>
  /** Recursive tree of the vault (folders first, then alphabetical). */
  listTree(): Promise<TreeNode[]>
  readNote(path: string): Promise<string>
  /** Raw bytes of a vault file, for rendering an image inline in the editor. */
  readAsset(path: string): Promise<Uint8Array>
  writeNote(path: string, content: string): Promise<void>
  /** Create `<dirPath>/<name>.md` ("" = vault root, name defaults to "Untitled"),
   *  or "<name> (2).md" etc. if that name's taken. The name is sanitised, so
   *  ALWAYS use the vault-relative path this returns rather than the one asked
   *  for. */
  createNote(dirPath: string, name?: string): Promise<string>
  /** Create a folder inside `dirPath`, named `name` (or "New folder" when
   *  omitted), suffixed " (2)" etc. if taken. The name is sanitised, so ALWAYS
   *  use the vault-relative path this returns rather than the one asked for. */
  createFolder(dirPath: string, name?: string): Promise<string>
  /** Rename/move; target segment sanitised. Migrates the entry's workspace.json
   *  key (and its descendants'). Returns the actual new rel path. */
  renameEntry(from: string, to: string): Promise<string>
  /** Every note's outgoing [[wiki links]], for the backlink half of the links
   *  block. Pass `paths` to rescan only those notes (what the watcher reports);
   *  omit it for the whole vault. Returns links only — never note contents. */
  scanLinks(paths?: string[]): Promise<LinkRow[]>
  /** Appearance settings for the active vault (or cached defaults if none). */
  getSettings(): Promise<AppSettings>
  /** Merge a partial settings change; persists and returns the full result. */
  setSettings(partial: Partial<AppSettings>): Promise<AppSettings>

  // --- space presets (userData/presets.json) --------------------------------
  // The library that outlives the open vault, which is exactly why it is not
  // stored in one. See shared/presets.ts.
  /** Every saved look, newest first. */
  listPresets(): Promise<SpacePreset[]>
  /** Mirror the open vault's spaces into the library and return it. Writes only
   *  what actually changed, so it is safe to call on every settings change.
   *  Never deletes: a preset whose space is gone is the point of the feature. */
  syncPresets(drafts: PresetDraft[]): Promise<SpacePreset[]>
  /** Follow a space's folder rename, so the library keeps one row for it. */
  renamePreset(from: string, to: string, origin: string): Promise<SpacePreset[]>
  /** Remove one saved preset for good. */
  deletePreset(id: string): Promise<SpacePreset[]>
  /** Write presets to a `.mdpreset` file the user chooses — `ids` for a
   *  selection, null for the whole library. Returns the path, or null if
   *  cancelled. */
  exportPresets(ids: string[] | null): Promise<string | null>
  /** Add presets from a file. Pass nothing and main opens a picker; pass the
   *  file's text (what a drag-and-drop already has) and it reads that. Always
   *  ADDS — an imported look never overwrites one of yours. */
  importPresets(text?: string): Promise<PresetImportResult>

  // --- workspace: order / pins / archive / bin (.mdnotes/workspace.json) -----
  /** The whole organisation sidecar for the active vault. */
  getWorkspace(): Promise<Workspace>
  /** Merge a partial change into one entry's metadata (pin, archive, collapse);
   *  persists (debounced, atomic) and returns the full workspace. */
  updateEntry(path: string, partial: EntryMeta): Promise<Workspace>
  /** Merge a partial change into many entries at once — one write for a whole
   *  multi-select action, instead of one per row. */
  updateEntries(paths: string[], partial: EntryMeta): Promise<Workspace>
  /** Record a new sibling order: each path is assigned its index. Notes and
   *  folders share one sequence per parent. */
  reorderEntries(paths: string[]): Promise<Workspace>
  /** Move entries into the recoverable bin (<vault>/.mdnotes/trash/). */
  trashEntries(paths: string[]): Promise<Workspace>
  /** Put binned items back where they came from, by trash id. */
  restoreEntries(ids: string[]): Promise<Workspace>
  /** Permanently remove binned items — the only path that reaches the OS trash.
   *  Pass no ids to empty the bin entirely. */
  purgeEntries(ids?: string[]): Promise<Workspace>
  /** Delete a space's folder straight to the OS trash — deliberately bypasses
   *  the app's own bin (a space is a different level of the hierarchy from the
   *  notes/folders trashed individually). Still recoverable, just from the
   *  OS's own Recycle Bin/Trash rather than in-app. */
  deleteSpace(folder: string): Promise<Workspace>

  // --- in-app updates -------------------------------------------------------
  /** This build's version, and the current update state + preference. */
  getUpdateState(): Promise<{ version: string; status: UpdateStatus; prefs: UpdatePrefs }>
  /** Ask the GitHub feed whether a newer version exists. */
  checkForUpdate(): Promise<UpdateStatus>
  /** Download an offered update (used when auto-download is off). On a platform
   *  that can't self-update this opens the releases page instead. */
  downloadUpdate(): Promise<UpdateStatus>
  /** Apply a staged update: flushes, quits, runs the installer, relaunches. */
  installUpdate(): void
  /** Turn background auto-update on/off; persisted in userData. */
  setAutoUpdate(on: boolean): Promise<UpdateStatus>
  /** Opt in/out of prerelease (beta) builds; persisted in userData. Checks the
   *  newly selected channel immediately. */
  setBetaChannel(on: boolean): Promise<UpdateStatus>
  /** Open the GitHub releases page in the default browser. */
  openReleases(): void
  /** Opens the user's default mail app with a bug report pre-addressed to the
   *  support inbox. Returns false if no mail client could be opened. */
  sendBugReport(fromEmail: string, message: string): Promise<boolean>
  /** Opens the user's default mail app with a feature request pre-addressed
   *  to the features inbox. Returns false if no mail client could be opened. */
  sendFeatureRequest(fromEmail: string, message: string): Promise<boolean>
  /** Open a URL in the default browser; false if its host isn't allowlisted. */
  openExternal(url: string): Promise<boolean>
  /** Subscribe to update state changes; returns an unsubscribe function. */
  onUpdateStatus(cb: (status: UpdateStatus) => void): () => void

  // --- notes import ------------------------------------------------------
  /** Formats this build can import — Apple Notes only exists on macOS. */
  importFormats(): Promise<ImportFormat[]>
  /** Opens a native picker scoped to the format (a folder for Notion's
   *  unzipped export, one or more .html files for HTML). Null if cancelled. */
  importPickSource(format: ImportFormat): Promise<string[] | null>
  /** Unpacks what was picked (a .zip) into a folder the importer can read.
   *  Separate from the picker because it can take minutes on a big export. */
  importPrepare(format: ImportFormat, paths: string[]): Promise<string[]>
  /** A lightweight summary (counts/warnings) without writing anything. */
  importPreview(format: ImportFormat, paths: string[]): Promise<ImportPreview>
  /** Runs the import for real; everything lands in one new space. */
  importRun(format: ImportFormat, paths: string[], spaceName: string): Promise<ImportResult>
  /** Stop the running import at the next note boundary. What's already been
   *  written stays, in its own space, for you to keep or delete. */
  importCancel(): Promise<void>
  /** Subscribe to progress pushed during a run; returns an unsubscribe function. */
  onImportProgress(cb: (p: ImportProgress) => void): () => void

  /** Subscribe to external-change events; returns an unsubscribe function. */
  onVaultChanged(cb: (change: VaultChange) => void): () => void
  /** Subscribe to application-menu commands (e.g. "new-note"); returns unsubscribe. */
  onMenuCommand(cb: (cmd: string) => void): () => void
  /** Subscribe to the pre-quit flush request; returns unsubscribe. */
  onBeforeQuit(cb: () => void): () => void
  /** Tell main that unsaved edits are flushed and it may quit. */
  notifyFlushed(): void
}
