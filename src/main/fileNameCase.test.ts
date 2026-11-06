import { describe, expect, it } from 'vitest'
import { readdirSync, statSync } from 'node:fs'
import path from 'node:path'

// Two source files whose names differ only by case (JumpToNote.tsx / jumpToNote.ts,
// 2026-11-03; Words.tsx / words.ts, 2026-11-06) are one file on a Mac or Windows
// disk: the typecheck fails, and git on a case-sensitive machine keeps both. It
// recurred with the rule written in CLAUDE.md, so it is a test now.
describe('source file names', () => {
  it('never differ only by case within a folder', () => {
    const clashes: string[] = []
    const walk = (dir: string): void => {
      const seen = new Map<string, string>()
      for (const name of readdirSync(dir)) {
        if (name === 'node_modules' || name.startsWith('.')) continue
        const full = path.join(dir, name)
        // without the extension too: words.ts and Words.tsx import as the same './words'
        const key = name.toLowerCase().replace(/\.(tsx?|jsx?)$/, '')
        const prev = seen.get(key)
        if (prev && prev !== name) {
          clashes.push(`${path.relative(process.cwd(), dir)}: ${prev} / ${name}`)
        }
        seen.set(key, name)
        if (statSync(full).isDirectory()) walk(full)
      }
    }
    walk(path.join(__dirname, '..'))
    expect(clashes).toEqual([])
  })
})
