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
  /** renderer -> main: bytes already in hand (paste/drop) to write beside a
   *  note, collision-safe-named. Returns the actual vault-relative path. */
  writeAsset: 'vault:writeAsset',
  /** renderer -> main: native picker filtered to images/video; each picked
   *  file is read and written beside the note in one round trip. */
  pickAttachment: 'vault:pickAttachment',
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
  /** Settings → Transfer data. The whole "lives only on this machine" bundle
   *  (preset library + custom fonts + downloaded-font ids + update channel) —
   *  write it to a file, read one back, or just count what's on this machine
   *  now. See shared/transfer.ts and main/transfer.ts. */
  exportTransfer: 'transfer:export',
  importTransfer: 'transfer:import',
  transferInventory: 'transfer:inventory',
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
  /** macOS only: show the downloaded .dmg in Finder (it cannot self-install) */
  revealUpdate: 'update:reveal',
  getAppVersion: 'app:version',
  /** renderer -> main: does the OPEN vault already have a .mdnotes/settings.json?
   *  i.e. has this folder been set up with the app before — the signal the
   *  onboarding Vault step uses to offer "pick up where you left off" when this
   *  machine's own record was wiped. */
  vaultEstablished: 'app:vaultEstablished',
  /** renderer -> main: has this install ever finished onboarding? */
  getOnboarded: 'app:getOnboarded',
  /** renderer -> main: mark onboarding finished for good */
  setOnboarded: 'app:setOnboarded',
  /** renderer -> main: which step to resume onboarding at, if the app quit
   *  mid-flow. Null means none saved — start at 'welcome'. */
  getOnboardingStep: 'app:getOnboardingStep',
  /** renderer -> main: persist the current step (or clear it with null) */
  setOnboardingStep: 'app:setOnboardingStep',
  /** renderer -> main: reveal a vault-relative path in the OS file explorer,
   *  boundary-checked the same way every other vault path is */
  revealInFolder: 'vault:revealInFolder',
  // Deliberately a NEW channel rather than a field on an existing one: a main
  // process that predates this fix does not answer it at all, which is exactly
  // how the renderer detects that it is talking to a stale one. See boot.ts.
  bootInfo: 'app:bootInfo',
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
