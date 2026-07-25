// In-app update contract, shared by main, preload and renderer.
// Pure types + validation, no fs and no DOM (mirrors shared/settings.ts).
//
// The feed itself is already published: electron-builder writes `latest.yml`
// next to `Notes-Setup.exe` on every GitHub release because electron-builder.yml
// sets `publish: provider: github`. This is just the app learning to read it.

/** Where the app is in the update cycle. One flat union so the renderer can
 *  switch on `state` and never has to reason about which fields are present. */
export type UpdateState =
  | 'idle' // nothing checked yet this session
  | 'checking'
  | 'none' // checked, already on the newest version
  | 'available' // newer version exists (downloading only if auto-download is on)
  | 'downloading'
  | 'ready' // downloaded and staged; applies on quit
  | 'error'
  | 'unsupported' // dev build, or a platform that can't self-update (macOS)

export interface UpdateStatus {
  state: UpdateState
  /** the version being offered (available/downloading/ready), else undefined */
  version?: string
  /** 0-100 while downloading */
  percent?: number
  /** human-readable reason for `error` / `unsupported` */
  message?: string
}

/** Machine-level update preferences. Deliberately NOT part of AppSettings: those
 *  live per-vault in <vault>/.mdnotes/settings.json, and "auto-update" is a
 *  property of this install, not of a folder of notes. Stored in userData
 *  alongside the vault path — the exception CLAUDE.md rule 2 already carves out. */
export interface UpdatePrefs {
  autoUpdate: boolean
  /** Receive prerelease (`x.y.z-beta.n`) builds. Off for everyone by default —
   *  this is how a tester is opted in without affecting real users, who keep
   *  reading `latest.yml` and never see a beta at all. */
  betaChannel: boolean
}

export const DEFAULT_UPDATE_PREFS: UpdatePrefs = { autoUpdate: true, betaChannel: false }

/** Coerce arbitrary parsed JSON into valid prefs. Never throws. */
export function normalizeUpdatePrefs(raw: unknown): UpdatePrefs {
  const v = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return {
    autoUpdate:
      typeof v.autoUpdate === 'boolean' ? v.autoUpdate : DEFAULT_UPDATE_PREFS.autoUpdate,
    betaChannel:
      typeof v.betaChannel === 'boolean' ? v.betaChannel : DEFAULT_UPDATE_PREFS.betaChannel
  }
}

/** The prerelease channel name. Must match the tag suffix used when releasing
 *  (`v0.2.0-beta.1`), because electron-builder derives the channel file name
 *  (`beta.yml`) from the version's prerelease component. */
export const BETA_CHANNEL = 'beta'

/** True when this build is itself a prerelease (`0.2.0-beta.1`). */
export const isPrereleaseVersion = (version: string): boolean => version.includes('-')

/**
 * Whether an install should actually follow the beta channel.
 *
 * **Beta is honoured only on a build that is itself a prerelease.** An ordinary
 * download therefore has no route onto test builds — not via the UI, not via a
 * crafted IPC call, and not by hand-editing `betaChannel: true` into
 * `config.json`. The only way in is installing a beta build, which comes from us.
 *
 * Kept here, pure and tested, because it is the rule that decides who receives
 * unfinished software. `main/updater.ts` enforces it; the Settings toggle merely
 * reflects it.
 */
export function shouldFollowBeta(pref: boolean, version: string): boolean {
  return pref && isPrereleaseVersion(version)
}

/** What `betaChannel` means when `config.json` doesn't mention it: follow this
 *  build's own type. A fresh beta install has no key, and defaulting it to a
 *  flat `false` made that build read as stable and immediately downgrade itself
 *  off the channel it was installed for. */
export function defaultBetaChannel(version: string): boolean {
  return isPrereleaseVersion(version)
}

/** Where a user goes when the app can't update itself (macOS, or a hard error). */
export const RELEASES_URL = 'https://github.com/ReubenCullumHall/Notes-app/releases/latest'
