import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/** One literal NUL byte in a source file makes `grep` treat the whole file as
 *  binary and print nothing from it — so a search for every caller of something
 *  silently misses that file. App.tsx, the Apple Notes importer and Presets.tsx
 *  all had one. Write the character as the escape `\u0000` inside the quotes
 *  instead: the string is identical when the app runs.
 *
 *  Pictures, fonts and recordings contain zero bytes by nature, so only text
 *  files are read. It lives in `src/main/` for the same reason
 *  macDmgNames.test.ts does: this is the half where reading files is legal. */

const TEXT = /\.(ts|tsx|js|jsx|mjs|cjs|py|sh|ps1|md|txt|html|css|json|svg)$/
const ROOTS = ['src', 'tools']

function textFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : textFiles(path)
    return TEXT.test(entry.name) ? [path] : []
  })
}

describe('source files', () => {
  it('contain no literal NUL byte', () => {
    const files = ROOTS.flatMap(textFiles)
    // A check that reads nothing passes every time — make sure it read the project.
    expect(files.length).toBeGreaterThan(400)
    const withNul = files.filter((file) => readFileSync(file).includes(0))
    expect(withNul).toEqual([])
  })
})
