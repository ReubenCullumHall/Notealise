// What the folder watcher skips (watcher.ts `watchIgnores`).
import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { watchIgnores } from './watcher'

const at = (root: string, ...parts: string[]): string => path.join(root, ...parts)

describe('what the folder watcher skips', () => {
  const root = path.resolve('/Users/someone/Notes')

  it('dot-named things inside the vault, and node_modules', () => {
    expect(watchIgnores(root, at(root, '.mdnotes'))).toBe(true)
    expect(watchIgnores(root, at(root, 'Biology', '.Cells.md.a1b2c3.tmp'))).toBe(true)
    expect(watchIgnores(root, at(root, 'Biology', '.hidden', 'note.md'))).toBe(false) // asked folder by folder: `.hidden` is the one refused
    expect(watchIgnores(root, at(root, 'Biology', '.hidden'))).toBe(true)
    expect(watchIgnores(root, at(root, 'node_modules'))).toBe(true)
  })

  it('never ordinary notes and folders', () => {
    expect(watchIgnores(root, root)).toBe(false)
    expect(watchIgnores(root, at(root, 'Biology'))).toBe(false)
    expect(watchIgnores(root, at(root, 'Biology', 'Cells.md'))).toBe(false)
  })

  it('never the vault folder itself, even when its own name starts with a dot', () => {
    // The watcher asks about the folder it was given as well. Named `.notes`, the whole
    // vault was skipped: nothing changed outside the app showed until a restart.
    const dot = path.resolve('/Users/someone/.notes')
    expect(watchIgnores(dot, dot)).toBe(false)
    expect(watchIgnores(dot, dot + path.sep)).toBe(false) // however the path is written
    expect(watchIgnores(dot, at(dot, 'Biology'))).toBe(false)
    expect(watchIgnores(dot, at(dot, 'Biology', 'Cells.md'))).toBe(false)
    // …while what is hidden INSIDE it still is
    expect(watchIgnores(dot, at(dot, '.mdnotes'))).toBe(true)
  })

  it('nor a vault folder that happens to be called node_modules', () => {
    const odd = path.resolve('/Users/someone/node_modules')
    expect(watchIgnores(odd, odd)).toBe(false)
    expect(watchIgnores(odd, at(odd, 'Note.md'))).toBe(false)
  })
})
