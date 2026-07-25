// Shared contract between main, preload, and renderer.
// Pure types only — safe to import from any process.

import type { AppSettings } from './settings'
import type { EntryMeta, Workspace } from './workspace'
import type { UpdatePrefs, UpdateStatus } from './update'

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
  writeNote(path: string, content: string): Promise<void>
  /** Create `<dirPath>/<name>.md`. The name is sanitised for cross-platform
   *  safety; returns the actual (possibly corrected) vault-relative path. */
  createNote(dirPath: string, name: string): Promise<string>
  /** Create a folder; final segment sanitised. Returns the actual rel path. */
  createFolder(path: string): Promise<string>
  /** Rename/move; target segment sanitised. Migrates the entry's workspace.json
   *  key (and its descendants'). Returns the actual new rel path. */
  renameEntry(from: string, to: string): Promise<string>
  /** Appearance settings for the active vault (or cached defaults if none). */
  getSettings(): Promise<AppSettings>
  /** Merge a partial settings change; persists and returns the full result. */
  setSettings(partial: Partial<AppSettings>): Promise<AppSettings>

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
  /** Subscribe to update state changes; returns an unsubscribe function. */
  onUpdateStatus(cb: (status: UpdateStatus) => void): () => void

  /** Subscribe to external-change events; returns an unsubscribe function. */
  onVaultChanged(cb: (change: VaultChange) => void): () => void
  /** Subscribe to application-menu commands (e.g. "new-note"); returns unsubscribe. */
  onMenuCommand(cb: (cmd: string) => void): () => void
  /** Subscribe to the pre-quit flush request; returns unsubscribe. */
  onBeforeQuit(cb: () => void): () => void
  /** Tell main that unsaved edits are flushed and it may quit. */
  notifyFlushed(): void
}
