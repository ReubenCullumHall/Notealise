// Date, time and number formatting, driven by the settings page. Ported from
// legacy/src/intl.js. Everything takes an explicit timezone so a note's
// timestamps read the same whichever machine you're on — "system" means
// follow the OS/browser.
import type { AppSettings } from '../../shared/settings'

export type DateFormatId = AppSettings['dateFormat']
export type NumberFormatId = AppSettings['numberFormat']

export const DATE_FORMATS: { id: DateFormatId; label: string }[] = [
  { id: 'full', label: 'Full date' },
  { id: 'short', label: 'Short date' },
  { id: 'mdy', label: 'Month/Day/Year' },
  { id: 'dmy', label: 'Day/Month/Year' },
  { id: 'ymd', label: 'Year/Month/Day' },
  { id: 'relative', label: 'Relative' }
]

export const NUMBER_FORMATS: { id: NumberFormatId; label: string }[] = [
  { id: 'default', label: 'Default' },
  { id: 'comma', label: '1,000,000.00' },
  { id: 'dot', label: '1.000.000,00' }
]

const zoneOpt = (tz?: string): Intl.DateTimeFormatOptions =>
  tz && tz !== 'system' ? { timeZone: tz } : {}

export const localZone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone
  } catch {
    return 'UTC'
  }
}

/** The full IANA list where the runtime exposes it, a usable handful where it
 *  doesn't. "system" always leads. */
export function timezones(): string[] {
  try {
    const all = Intl.supportedValuesOf('timeZone')
    if (all && all.length) return ['system', ...all]
  } catch {
    /* older runtime */
  }
  return [
    'system',
    'UTC',
    'Europe/London',
    'Europe/Paris',
    'Europe/Berlin',
    'America/New_York',
    'America/Chicago',
    'America/Denver',
    'America/Los_Angeles',
    'Asia/Tokyo',
    'Asia/Shanghai',
    'Asia/Kolkata',
    'Australia/Sydney'
  ]
}

/** YYYY-MM-DD as seen in that timezone — the basis for "is this the same day?" */
const dayKey = (ms: number, tz?: string): string =>
  new Intl.DateTimeFormat('en-CA', { ...zoneOpt(tz), year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date(ms)
  )

/** Locale order can't be trusted for the numeric formats, so assemble the parts
 *  ourselves — Day/Month/Year has to mean exactly that. */
function numeric(ms: number, order: ('day' | 'month' | 'year')[], tz?: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    ...zoneOpt(tz),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  })
    .formatToParts(new Date(ms))
    .reduce<Record<string, string>>((a, p) => {
      a[p.type] = p.value
      return a
    }, {})
  return order.map((k) => parts[k]).join('/')
}

function relative(ms: number, tz?: string): string | null {
  const days = Math.round((Date.parse(dayKey(Date.now(), tz)) - Date.parse(dayKey(ms, tz))) / 86400000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days === -1) return 'Tomorrow'
  if (days > 1 && days < 7) return `${days} days ago`
  if (days >= 7 && days < 31) {
    const w = Math.round(days / 7)
    return `${w} week${w > 1 ? 's' : ''} ago`
  }
  return null // too long ago to be useful — caller falls back to a real date
}

export function formatDate(ms: number | null | undefined, fmt: DateFormatId = 'relative', tz = 'system'): string | null {
  if (!ms) return null
  if (fmt === 'relative') return relative(ms, tz) ?? formatDate(ms, 'short', tz)
  if (fmt === 'mdy') return numeric(ms, ['month', 'day', 'year'], tz)
  if (fmt === 'dmy') return numeric(ms, ['day', 'month', 'year'], tz)
  if (fmt === 'ymd') return numeric(ms, ['year', 'month', 'day'], tz)
  const opts: Intl.DateTimeFormatOptions =
    fmt === 'short' ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'long', year: 'numeric' }
  return new Intl.DateTimeFormat(undefined, { ...zoneOpt(tz), ...opts }).format(new Date(ms))
}

export const formatTime = (ms: number, tz = 'system'): string =>
  new Intl.DateTimeFormat(undefined, { ...zoneOpt(tz), hour: '2-digit', minute: '2-digit' }).format(new Date(ms))

/**
 * The shortest honest answer to "when?", for the strip beside a note's word
 * count where every character competes with the format bar for width.
 *
 * Edited today, the date is the noise — you get the clock time. Edited before
 * today, the time is the noise — you get the date. The full answer, both dates
 * spelled out, is one hover away, which is what earns the brevity here.
 */
export function formatWhenShort(
  ms: number | null | undefined,
  fmt: DateFormatId = 'relative',
  tz = 'system'
): string | null {
  if (!ms) return null
  const today = new Intl.DateTimeFormat('en-CA', { ...zoneOpt(tz), dateStyle: 'short' })
  return today.format(new Date(ms)) === today.format(new Date())
    ? formatTime(ms, tz)
    : formatDate(ms, fmt === 'relative' ? 'short' : fmt, tz)
}

/** Always a real date here, never "Today" — a tooltip is where you go for the
 *  precise answer. */
export const formatDateTime = (ms: number | null | undefined, fmt: DateFormatId = 'full', tz = 'system'): string | null =>
  ms ? `${formatDate(ms, fmt === 'relative' ? 'full' : fmt, tz)} at ${formatTime(ms, tz)}` : null

export function formatNumber(n: number, fmt: NumberFormatId = 'default'): string {
  if (typeof n !== 'number' || !isFinite(n)) return String(n)
  const locale = fmt === 'comma' ? 'en-US' : fmt === 'dot' ? 'de-DE' : undefined
  return new Intl.NumberFormat(locale).format(n)
}
