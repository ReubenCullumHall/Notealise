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
  /** renderer -> main: the [[wiki links]] of every note (or just the given ones) */
  scanLinks: 'vault:scanLinks',
  /** renderer -> main: read/write appearance settings (.mdnotes/settings.json) */
  getSettings: 'settings:get',
  setSettings: 'settings:set',
  /** renderer(preload) -> main, SYNCHRONOUS: cached theme/density for pre-paint */
  settingsCache: 'settings:cache',
  /** renderer -> main: order/pins/archive/bin (.mdnotes/workspace.json) */
  getWorkspace: 'workspace:get',
  updateEntry: 'workspace:updateEntry',
  updateEntries: 'workspace:updateEntries',
  reorderEntries: 'workspace:reorder',
  trashEntries: 'workspace:trash',
  restoreEntries: 'workspace:restore',
  purgeEntries: 'workspace:purge',
  deleteSpace: 'workspace:deleteSpace',
  /** renderer -> main: in-app updates (electron-updater over the GitHub feed) */
  getUpdateState: 'update:get',
  checkForUpdate: 'update:check',
  downloadUpdate: 'update:download',
  installUpdate: 'update:install',
  setAutoUpdate: 'update:setAuto',
  setBetaChannel: 'update:setBeta',
  openReleases: 'update:openReleases',
  getAppVersion: 'app:version',
  /** renderer -> main: open the default mail app with a pre-filled bug report */
  sendBugReport: 'app:sendBugReport',
  /** main -> renderer: update progress/state changed */
  updateStatus: 'update:status',
  /** main -> renderer: debounced external-change notification */
  changed: 'vault:changed',
  /** main -> renderer: an application-menu item was invoked */
  menuCommand: 'menu:command',
  /** main -> renderer: flush unsaved edits, we're about to quit */
  beforeQuit: 'app:before-quit',
  /** renderer -> main: flush done, safe to quit */
  flushed: 'app:flushed'
} as const
