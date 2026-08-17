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
  /** renderer -> main: raw bytes of a vault file, for showing an image inline */
  readAsset: 'vault:readAsset',
  /** renderer -> main: the [[wiki links]] of every note (or just the given ones) */
  scanLinks: 'vault:scanLinks',
  /** renderer -> main: read/write appearance settings (.mdnotes/settings.json) */
  getSettings: 'settings:get',
  setSettings: 'settings:set',
  /** renderer(preload) -> main, SYNCHRONOUS: cached theme/density for pre-paint */
  settingsCache: 'settings:cache',
  /** renderer -> main: the space-preset library (see shared/presets.ts). It
   *  lives in the app itself (userData), never in a vault — which is what lets a
   *  look survive changing source folder with nothing to move and nothing to ask. */
  listPresets: 'presets:list',
  /** mirror the open vault's spaces into the library — no "save" button */
  syncPresets: 'presets:sync',
  renamePreset: 'presets:rename',
  deletePreset: 'presets:delete',
  /** write presets to a .mdpreset file the user picks — one look, or the lot */
  exportPresets: 'presets:export',
  /** read one back in: the button passes nothing and main opens a picker; a
   *  drag-and-drop passes the file's text, already read in the renderer */
  importPresets: 'presets:import',
  /** renderer -> main: fonts downloaded or imported on THIS install
   *  (userData/fonts/) — see shared/fonts.ts and main/fonts.ts */
  listInstalledFonts: 'fonts:listInstalled',
  downloadFont: 'fonts:download',
  importCustomFont: 'fonts:importCustom',
  removeCustomFont: 'fonts:removeCustom',
  /** renderer -> main: order/pins/archive/bin (.mdnotes/workspace.json) */
  getWorkspace: 'workspace:get',
  updateEntry: 'workspace:updateEntry',
  updateEntries: 'workspace:updateEntries',
  reorderEntries: 'workspace:reorder',
  trashEntries: 'workspace:trash',
  restoreEntries: 'workspace:restore',
  purgeEntries: 'workspace:purge',
  /** the 7-day safety net items purging the bin now land in, Settings-only */
  restoreRecoveryEntries: 'workspace:restoreRecovery',
  purgeRecoveryEntries: 'workspace:purgeRecovery',
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
  /** renderer -> main: has this install ever finished onboarding? */
  getOnboarded: 'app:getOnboarded',
  /** renderer -> main: mark onboarding finished for good */
  setOnboarded: 'app:setOnboarded',
  /** renderer -> main: reveal a vault-relative path in the OS file explorer,
   *  boundary-checked the same way every other vault path is */
  revealInFolder: 'vault:revealInFolder',
  /** renderer -> main: dev-only. Wipe the disposable onboarding-test vault,
   *  switch to it, and clear hasOnboarded — one click, never the real vault */
  resetOnboardingTestVault: 'app:resetOnboardingTestVault',
  /** renderer -> main: open the default mail app with a pre-filled bug report */
  sendBugReport: 'app:sendBugReport',
  /** renderer -> main: open the default mail app with a pre-filled feature request */
  sendFeatureRequest: 'app:sendFeatureRequest',
  /** renderer -> main: open a URL in the default browser (host-allowlisted) */
  openExternal: 'app:openExternal',
  /** renderer -> main: which import formats this build supports */
  importFormats: 'import:formats',
  /** renderer -> main: notes import — open a native picker scoped by format */
  importPickSource: 'import:pickSource',
  /** renderer -> main: unpack what was picked (a .zip) into a readable folder */
  importPrepare: 'import:prepare',
  /** renderer -> main: a lightweight summary, before anything is written */
  importPreview: 'import:preview',
  /** renderer -> main: run the import for real */
  importRun: 'import:run',
  /** renderer -> main: stop the running import at the next safe point */
  importCancel: 'import:cancel',
  /** main -> renderer: progress pushed during a run */
  importProgress: 'import:progress',
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
