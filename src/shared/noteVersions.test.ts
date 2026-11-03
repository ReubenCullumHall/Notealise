import { describe, expect, it } from 'vitest'
import {
  KEEP_ALL_MS,
  KEEP_DAILY_MS,
  isVersionId,
  removedChars,
  versionFileName,
  versionTime,
  versionsToDrop
} from './noteVersions'

const DAY = 24 * 60 * 60 * 1000

describe('version file names', () => {
  it('round-trips the time to the millisecond, whatever the note is called', () => {
    const at = Date.UTC(2026, 10, 3, 14, 32, 5, 123)
    const f = versionFileName(at, 'Lecture 4.md')
    expect(f).toBe('2026-11-03T14-32-05.123Z Lecture 4.md')
    expect(versionTime(f)).toBe(at)
  })
  it('carries no character Windows refuses, and never a folder separator', () => {
    const f = versionFileName(0, 'Q3: Review / plan? <draft>*.md')
    expect(f).not.toMatch(/[<>:"/\\|?*]/)
    expect(versionTime(f)).toBe(0)
  })
  it('shortens a long name, and can drop it for a long vault path', () => {
    const long = 'x'.repeat(200) + '.md'
    expect(versionFileName(0, long).length).toBeLessThan(80)
    expect(versionFileName(0, long, 0)).toBe('1970-01-01T00-00-00.000Z.md')
  })
  it('does not take an ordinary note, or a path, for a version', () => {
    expect(versionTime('Lecture 4.md')).toBeNull()
    expect(versionTime('../2026-11-03T14-32-05.123Z.md')).toBeNull()
    expect(versionTime('2026-11-03T14-32-05.123Z x/../y.md')).toBeNull()
    expect(versionTime('2026-11-03T14-32-05.123Z.txt')).toBeNull()
  })
  it('only takes ids main makes', () => {
    expect(isVersionId('a1b2c3d4e5f6')).toBe(true)
    expect(isVersionId('..')).toBe(false)
    expect(isVersionId('A1B2C3D4E5F6')).toBe(false)
    expect(isVersionId(['a1b2c3d4e5f6'])).toBe(false)
  })
})

describe('removedChars — how much a save takes away', () => {
  const para = 'The Krebs cycle runs in the mitochondrial matrix and produces NADH, FADH2 and ATP from acetyl-CoA. '
  it('counts a typed letter as nothing taken', () => {
    expect(removedChars('Hello world', 'Hello world!')).toBe(0)
  })
  it('counts a deleted paragraph in the middle as the paragraph', () => {
    const before = 'Intro.\n\n' + para + '\n\nOutro.'
    expect(removedChars(before, 'Intro.\n\n\n\nOutro.')).toBe(para.length)
  })
  it('counts text pasted over a paragraph as the paragraph replaced', () => {
    expect(removedChars('A ' + para + 'B', 'A pasted B')).toBeGreaterThanOrEqual(para.length - 7)
  })
  it('does not double-count repeated characters at the join', () => {
    expect(removedChars('aaaa', 'aaa')).toBe(1)
  })
})

describe('versionsToDrop — the tidy-up', () => {
  const now = Date.UTC(2026, 10, 30, 12)
  const dayOf = (at: number): string => new Date(at).toISOString().slice(0, 10)
  const v = (ageMs: number, name: string): { file: string; at: number } => ({ file: name, at: now - ageMs })
  it('keeps every version younger than a week', () => {
    const list = [v(1000, 'a'), v(DAY, 'b'), v(KEEP_ALL_MS - 1, 'c')]
    expect(versionsToDrop(list, now, dayOf)).toEqual([])
  })
  it('keeps only the last of each day between a week and 30 days', () => {
    const base = 10 * DAY
    const list = [v(base, 'late'), v(base + 3600_000, 'mid'), v(base + 7200_000, 'early'), v(12 * DAY, 'other day')]
    expect(versionsToDrop(list, now, dayOf).sort()).toEqual(['early', 'mid'])
  })
  it('drops everything 30 days old or more', () => {
    expect(versionsToDrop([v(KEEP_DAILY_MS, 'old'), v(90 * DAY, 'older')], now, dayOf).sort()).toEqual(['old', 'older'])
  })
})
