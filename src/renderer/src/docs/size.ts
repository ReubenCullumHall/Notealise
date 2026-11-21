// A file's size in words for a sidebar row or a tab — "2.4 MB". Figures use the
// person's own locale (intl.ts), never the browser default (CLAUDE.md, Stack).

import { userLocale } from '../intl'

export function formatSize(bytes: number | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return ''
  const units = ['bytes', 'KB', 'MB', 'GB']
  let n = bytes
  let i = 0
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024
    i++
  }
  const digits = i === 0 || n >= 100 ? 0 : 1
  return `${new Intl.NumberFormat(userLocale, { maximumFractionDigits: digits }).format(n)} ${units[i]}`
}
