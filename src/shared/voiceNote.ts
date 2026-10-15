// A voice note, as it is written into a note.
//
// Markdown has no audio syntax, so a voice note is the same trade the app already
// made for video (rule 4): one line of valid inline HTML,
//
//   <audio controls src="Voice%20note%202026-10-13%2014.32.m4a"></audio>
//
// which VS Code and Obsidian show as an ordinary audio player, and which this app
// draws as the voice note block (editor/audioPass.ts). The file sits beside the
// note like any photo (editor/attachInput.ts).
//
// The block's mixer — volume, tone and speed — is a property of THIS voice note
// in THIS note, so it is written on the same line as `data-*` attributes, which
// every other editor ignores:
//
//   <audio controls src="…" data-volume="1.5" data-tone="-0.3" data-speed="1.25"></audio>
//
// Only a value that differs from the default is written, so an untouched voice
// note is the plain tag. Nothing here touches the audio itself — the file on
// disk is never re-encoded by the mixer; it only changes how the app plays it.
//
// Pure string helpers, no DOM: main, the renderer and the tests all use them.

export interface VoiceSettings {
  /** 0–2: 1 is as recorded, 2 is twice as loud (a quiet phone recording needs it) */
  volume: number
  /** −1 to 1: below 0 warmer (more bass, less treble), above 0 brighter */
  tone: number
  /** 0.5–3: playback speed; the voice keeps its pitch */
  speed: number
}

export const VOICE_DEFAULTS: Readonly<VoiceSettings> = { volume: 1, tone: 0, speed: 1 }

export const VOICE_LIMITS: Readonly<Record<keyof VoiceSettings, readonly [number, number]>> = {
  volume: [0, 2],
  tone: [-1, 1],
  speed: [0.5, 3]
}

const KEYS: (keyof VoiceSettings)[] = ['volume', 'tone', 'speed']

/** Two decimal places at most, so a slider's 1.2500000001 never reaches a file. */
const round2 = (n: number): number => Math.round(n * 100) / 100

/** Settings from anything — a note written by hand, by another editor, or by an
 *  older build. Out-of-range values are pulled into range; a missing or
 *  unreadable one is its default. Never throws. */
export function normalizeVoice(s: Partial<Record<keyof VoiceSettings, unknown>> | null | undefined): VoiceSettings {
  const out: VoiceSettings = { ...VOICE_DEFAULTS }
  for (const k of KEYS) {
    const raw = s?.[k]
    const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN
    if (!Number.isFinite(n)) continue
    const [lo, hi] = VOICE_LIMITS[k]
    out[k] = round2(Math.min(hi, Math.max(lo, n)))
  }
  return out
}

/** True when every value is its default — the plain tag, with no data-* at all. */
export function isDefaultVoice(s: VoiceSettings): boolean {
  return KEYS.every((k) => s[k] === VOICE_DEFAULTS[k])
}

/** The data-* attributes for `s`, each with a leading space; '' for defaults. */
function voiceAttrs(s: VoiceSettings): string {
  const n = normalizeVoice(s)
  return KEYS.filter((k) => n[k] !== VOICE_DEFAULTS[k])
    .map((k) => ` data-${k}="${n[k]}"`)
    .join('')
}

/** The line a voice note is written as. `target` must already be encoded
 *  (`encodeTarget` / `relativeTarget` in shared/attachments.ts) — this does not
 *  encode, so the caller's target and the one read back agree exactly. */
export function audioTag(target: string, settings?: Partial<VoiceSettings>): string {
  return `<audio controls src="${target}"${voiceAttrs(normalizeVoice(settings))}></audio>`
}

export interface ParsedAudioTag {
  /** the target exactly as written (still percent-encoded) */
  src: string
  settings: VoiceSettings
}

const OPEN_TAG = /^<audio\b([^>]*)>$/i

/** The attribute `name` out of a tag's attribute text, or undefined. Double,
 *  single or unquoted values, any case, any order — a hand-written tag is fine. */
function attr(attrs: string, name: string): string | undefined {
  const m = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i').exec(attrs)
  return m ? (m[1] ?? m[2] ?? m[3]) : undefined
}

/** Read an `<audio …>` OPEN tag (just the tag, as one syntax node holds it).
 *  Null when it isn't one or has no src — a player with nothing to play is left
 *  as plain text, the same rule videoPass follows. */
export function parseAudioOpenTag(openTag: string): ParsedAudioTag | null {
  const m = OPEN_TAG.exec(openTag.trim())
  if (!m) return null
  const src = attr(m[1], 'src')
  if (!src) return null
  return {
    src,
    settings: normalizeVoice({
      volume: attr(m[1], 'data-volume'),
      tone: attr(m[1], 'data-tone'),
      speed: attr(m[1], 'data-speed')
    })
  }
}

/** The same open tag with its mixer settings replaced by `s` — every other
 *  attribute (src, controls, anything a person or another app added) is kept as
 *  it was, in place. Returns the tag unchanged when it isn't an `<audio>` tag. */
export function withVoiceSettings(openTag: string, s: Partial<VoiceSettings>): string {
  const m = OPEN_TAG.exec(openTag.trim())
  if (!m) return openTag
  const kept = m[1]
    .replace(/\s+data-(?:volume|tone|speed)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+)/gi, '')
    .replace(/\s+$/, '')
  // A hand-written `<audio … />` keeps its slash at the end, after the settings.
  const slash = /\/$/.test(kept) ? ' /' : ''
  const body = slash ? kept.slice(0, -1).replace(/\s+$/, '') : kept
  return `<audio${body}${voiceAttrs(normalizeVoice(s))}${slash}>`
}

// --- the skip buttons ------------------------------------------------------------

/** What each of a voice note's two skip buttons can be set to, in seconds, by
 *  right-clicking it (Reuben, 2026-10-14) — back and forward each on its own.
 *  One setting for every voice note, kept with the app's other settings
 *  (shared/settings.ts `voiceSkip`): it is how this person likes to listen, not
 *  a property of any one recording, so it is never written on a note's line. */
export const VOICE_SKIP_CHOICES = [5, 10, 15, 30, 60] as const
export type VoiceSkipSeconds = (typeof VOICE_SKIP_CHOICES)[number]

export interface VoiceSkip {
  back: VoiceSkipSeconds
  forward: VoiceSkipSeconds
}

export const VOICE_SKIP_DEFAULT: Readonly<VoiceSkip> = { back: 10, forward: 10 }

/** The setting from anything a settings file holds; a side that isn't one of
 *  the choices is its default. Never throws. */
export function normalizeVoiceSkip(raw: unknown): VoiceSkip {
  const r = (raw !== null && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const pick = (v: unknown, d: VoiceSkipSeconds): VoiceSkipSeconds =>
    (VOICE_SKIP_CHOICES as readonly unknown[]).includes(v) ? (v as VoiceSkipSeconds) : d
  return { back: pick(r['back'], VOICE_SKIP_DEFAULT.back), forward: pick(r['forward'], VOICE_SKIP_DEFAULT.forward) }
}

/** "10 seconds", "1 minute" — a choice as the menu and a screen reader say it. */
export const skipWords = (s: VoiceSkipSeconds): string => (s === 60 ? '1 minute' : `${s} seconds`)

/** "Voice note 2026-10-13 14.32.m4a" — the name a new recording is saved under
 *  (main still de-duplicates it). ISO date and a 24-hour time with a dot: it
 *  sorts by date in any file list, and a colon is not allowed in a Windows file
 *  name. Local time, because that is the time on the person's clock. */
export function voiceFileName(now: Date, ext: string): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  const date = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`
  return `Voice note ${date} ${p(now.getHours())}.${p(now.getMinutes())}.${ext.replace(/^\./, '')}`
}
