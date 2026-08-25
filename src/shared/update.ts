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
  /** macOS: this update was found by reading the releases feed directly, and
   *  the app cannot apply it — Squirrel.Mac refuses an unsigned update, which
   *  is a signature check rather than a warning. Everything up to handing the
   *  user the finished .dmg still works, so the states mean slightly different
   *  things: `ready` is "the file is on your disk", not "staged for restart",
   *  and the button reveals it in Finder instead of restarting. */
  manual?: boolean
  /** macOS `ready`: absolute path of the downloaded .dmg, for Finder. */
  filePath?: string
}

/** One release as the app cares about it, parsed out of the GitHub feed. */
export interface FeedRelease {
  version: string
  prerelease: boolean
  /** absolute https URL of the macOS .dmg asset, when the release has one */
  dmgUrl: string | null
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

/** The read-only releases feed. Public, unauthenticated, and the only network
 *  call macOS makes — the app stays offline-first, this is the same information
 *  Windows already fetches through `latest.yml`, asked for a different way
 *  because there is no `latest-mac.yml` to read (electron-builder writes one
 *  only for signed mac builds; see docs/release-checklist.md's known gaps). */
export const RELEASES_API = 'https://api.github.com/repos/ReubenCullumHall/Notes-app/releases'

// --- version comparison -----------------------------------------------------
// Written here rather than pulled in: `semver` would be a new dependency for
// about twenty lines, and this is the rule that decides whether a user is told
// to download something, so it is worth being able to read and test it.

/** Split "0.9.1-beta.2" into [0,9,1] and ["beta",2]. Anything unparseable
 *  becomes 0, so a malformed tag sorts oldest rather than throwing. */
function parseVersion(v: string): { nums: number[]; pre: (string | number)[] } {
  const cleaned = v.trim().replace(/^v/, '')
  const [core, ...preParts] = cleaned.split('-')
  const nums = core.split('.').map((n) => {
    const i = parseInt(n, 10)
    return Number.isFinite(i) ? i : 0
  })
  while (nums.length < 3) nums.push(0)
  const pre = preParts
    .join('-')
    .split('.')
    .filter((p) => p.length > 0)
    .map((p) => {
      const i = parseInt(p, 10)
      return String(i) === p ? i : p
    })
  return { nums, pre }
}

/**
 * semver ordering: -1 if `a` is older, 0 if equal, 1 if newer.
 *
 * The prerelease rule is the one worth spelling out, because getting it
 * backwards would offer every stable user a downgrade: **a version WITH a
 * prerelease tag is older than the same version without one** — 0.9.0-beta.1
 * comes before 0.9.0. Numeric prerelease parts compare numerically (beta.9 <
 * beta.10, which a string compare gets wrong), and a numeric part sorts before
 * an alphabetic one.
 */
export function compareVersions(a: string, b: string): number {
  const A = parseVersion(a)
  const B = parseVersion(b)
  for (let i = 0; i < Math.max(A.nums.length, B.nums.length); i++) {
    const d = (A.nums[i] ?? 0) - (B.nums[i] ?? 0)
    if (d !== 0) return d > 0 ? 1 : -1
  }
  if (A.pre.length === 0 && B.pre.length === 0) return 0
  if (A.pre.length === 0) return 1 // 0.9.0 is newer than 0.9.0-beta.1
  if (B.pre.length === 0) return -1
  for (let i = 0; i < Math.max(A.pre.length, B.pre.length); i++) {
    const x = A.pre[i]
    const y = B.pre[i]
    if (x === undefined) return -1 // beta.1 is older than beta.1.1
    if (y === undefined) return 1
    if (x === y) continue
    const xn = typeof x === 'number'
    const yn = typeof y === 'number'
    if (xn && yn) return x > y ? 1 : -1
    if (xn !== yn) return xn ? -1 : 1 // numeric sorts before alphabetic
    return String(x) > String(y) ? 1 : -1
  }
  return 0
}

/** True when `candidate` is strictly newer than `current`. */
export const isNewerVersion = (candidate: string, current: string): boolean =>
  compareVersions(candidate, current) > 0

/**
 * The release to offer, or null when the user is already current.
 *
 * Deliberately strict about two things. A release with **no .dmg asset** is
 * skipped rather than offered: telling a Mac user to download something that
 * isn't there is worse than saying nothing. And a prerelease is only ever
 * considered when `allowPrerelease` is true, which `shouldFollowBeta` already
 * gates on this build being a prerelease itself — so an ordinary install has no
 * route onto test builds here either, matching the Windows rule rather than
 * quietly inventing a second, looser one.
 */
export function pickRelease(
  releases: FeedRelease[],
  currentVersion: string,
  allowPrerelease: boolean
): FeedRelease | null {
  const usable = releases.filter(
    (r) => r.dmgUrl !== null && (allowPrerelease || !r.prerelease)
  )
  let best: FeedRelease | null = null
  for (const r of usable) {
    if (!isNewerVersion(r.version, currentVersion)) continue
    if (!best || isNewerVersion(r.version, best.version)) best = r
  }
  return best
}

// --- reading the feed -------------------------------------------------------
// Pure, so it can be tested against a REAL captured payload rather than a
// hand-written one. The shape of GitHub's response is the thing most likely to
// break this quietly, and a fixture taken from the live API is the only test
// that would notice.

/** Hosts a release download may come from. GitHub serves assets from
 *  github.com and redirects some to its blob store, so more than one is needed
 *  — but the list is CLOSED. Following wherever a feed points is how reading a
 *  feed turns into fetching anything at all. */
const ALLOWED_HOSTS = new Set([
  'api.github.com',
  'github.com',
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com'
])

/** https, and a host we recognise. Anything else is refused rather than
 *  followed — including http, which would make the download interceptable. */
export function isAllowedReleaseUrl(raw: string): boolean {
  try {
    const u = new URL(raw)
    return u.protocol === 'https:' && ALLOWED_HOSTS.has(u.hostname)
  } catch {
    return false
  }
}

/** One entry of GitHub's releases response, reduced to what the app uses.
 *  Returns null for anything unusable, including a DRAFT: a draft is visible
 *  to the repo owner and to nobody else, so offering it would show Reuben
 *  updates none of his users can actually download. */
export function parseRelease(raw: unknown): FeedRelease | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (r.draft === true) return null
  if (typeof r.tag_name !== 'string') return null
  const assets = Array.isArray(r.assets) ? r.assets : []
  let dmgUrl: string | null = null
  for (const a of assets) {
    if (!a || typeof a !== 'object') continue
    const { name, browser_download_url: url } = a as Record<string, unknown>
    if (typeof name !== 'string' || typeof url !== 'string') continue
    if (!name.toLowerCase().endsWith('.dmg')) continue
    if (!isAllowedReleaseUrl(url)) continue
    dmgUrl = url
    break
  }
  return { version: r.tag_name.replace(/^v/, ''), prerelease: r.prerelease === true, dmgUrl }
}

/** The whole response. Never throws: a feed that is not an array, or is full of
 *  junk, reads as "nothing to offer" rather than taking the check down. */
export function parseFeed(raw: unknown): FeedRelease[] {
  if (!Array.isArray(raw)) return []
  return raw.map(parseRelease).filter((r): r is FeedRelease => r !== null)
}
