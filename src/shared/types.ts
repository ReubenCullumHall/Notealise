// Shared contract between main, preload, and renderer.
// Pure types only — safe to import from any process.

import type { AppSettings } from './settings'
import type { SpaceMeta, SpacesMap } from './spaces'

/** A node in the vault file tree. `path` is always vault-relative, POSIX-style
 *  ("/" separators), and "" denotes the vault root. */
export interface TreeNode {
  name: string
  /** vault-relative path, e.g. "notes/todo.md" ("" for the root) */
  path: string
  type: 'dir' | 'file'
  /** present only when type === 'dir' */
  children?: TreeNode[]
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
  /** Rename/move; target segment sanitised. Returns the actual new rel path. */
  renameEntry(from: string, to: string): Promise<string>
  /** Move an entry to the OS trash (never a hard delete). */
  deleteEntry(path: string): Promise<void>
  /** Appearance settings for the active vault (or cached defaults if none). */
  getSettings(): Promise<AppSettings>
  /** Merge a partial settings change; persists and returns the full result. */
  setSettings(partial: Partial<AppSettings>): Promise<AppSettings>
  /** Presentation metadata for every space (folder name → colour/icon/order). */
  getSpaces(): Promise<SpacesMap>
  /** Merge a partial change into one space's metadata; persists (debounced,
   *  atomic) and returns the full map. */
  updateSpace(name: string, partial: SpaceMeta): Promise<SpacesMap>
  /** Persist a new left-to-right order for the rail; returns the full map. */
  reorderSpaces(names: string[]): Promise<SpacesMap>
  /** Rename a space: rename the top-level folder AND migrate its spaces.json key
   *  in one operation, rolling back the folder move if the metadata write fails.
   *  Returns the actual (sanitised) new name and the full map. */
  renameSpace(oldName: string, newName: string): Promise<{ name: string; spaces: SpacesMap }>
  /** Send a space's folder (and its notes) to the OS trash and drop its metadata. */
  deleteSpace(name: string): Promise<SpacesMap>
  /** Subscribe to external-change events; returns an unsubscribe function. */
  onVaultChanged(cb: (change: VaultChange) => void): () => void
  /** Subscribe to application-menu commands (e.g. "new-note"); returns unsubscribe. */
  onMenuCommand(cb: (cmd: string) => void): () => void
  /** Subscribe to the pre-quit flush request; returns unsubscribe. */
  onBeforeQuit(cb: () => void): () => void
  /** Tell main that unsaved edits are flushed and it may quit. */
  notifyFlushed(): void
}
