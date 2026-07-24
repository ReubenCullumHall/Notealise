// IPC channel names shared by main (handlers) and preload (invokers), so the
// two can never drift apart.
export const CH = {
  getVault: 'vault:get',
  pickVault: 'vault:pick',
  listTree: 'vault:listTree',
  readNote: 'vault:readNote',
  writeNote: 'vault:writeNote',
  createNote: 'vault:createNote',
  createFolder: 'vault:createFolder',
  renameEntry: 'vault:renameEntry',
  deleteEntry: 'vault:deleteEntry',
  /** renderer -> main: read/write appearance settings (.mdnotes/settings.json) */
  getSettings: 'settings:get',
  setSettings: 'settings:set',
  /** renderer(preload) -> main, SYNCHRONOUS: cached theme/density for pre-paint */
  settingsCache: 'settings:cache',
  /** renderer -> main: spaces presentation metadata (.mdnotes/spaces.json) */
  getSpaces: 'spaces:get',
  updateSpace: 'spaces:update',
  reorderSpaces: 'spaces:reorder',
  renameSpace: 'spaces:rename',
  deleteSpace: 'spaces:delete',
  /** main -> renderer: debounced external-change notification */
  changed: 'vault:changed',
  /** main -> renderer: an application-menu item was invoked */
  menuCommand: 'menu:command',
  /** main -> renderer: flush unsaved edits, we're about to quit */
  beforeQuit: 'app:before-quit',
  /** renderer -> main: flush done, safe to quit */
  flushed: 'app:flushed'
} as const
