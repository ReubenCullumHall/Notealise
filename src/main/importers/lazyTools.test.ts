// The import tools are loaded when an import starts, never when the app does.
//
// Every importer is registered as the app starts (ipc.ts), so a library imported at
// the top of an importer file is loaded on EVERY launch, for the sake of something
// most launches never do. `mammoth` (Word) and `turndown` (HTML → Markdown) cost
// about 65 ms of each launch that way until 2026-11-12
// (docs/app-check-2026-11-09.md, "Launch loads the import tools every time":
// program start → window loading, median 505 → 440 ms over 24 launches each).
//
// Nothing else would notice them creeping back: an import works either way, and
// no test times a launch. So this reads the files — the same kind of check as
// tailwindOpacity.test.ts.

import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

const HEAVY = ['mammoth', 'turndown']
const ROOT = path.join(__dirname, '..')

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) return sources(full)
    return /\.ts$/.test(name) && !/\.test\.ts$/.test(name) ? [full] : []
  })
}

describe('the import tools', () => {
  it('are never imported at the top of a behind-the-scenes file', () => {
    const offenders: string[] = []
    for (const file of sources(ROOT)) {
      const text = readFileSync(file, 'utf8')
      for (const lib of HEAVY) {
        // `import x from 'lib'` / `import { x } from 'lib'` / `import 'lib'` — but not
        // `import type …`, which is erased, and not `await import('lib')`.
        const top = new RegExp(`^import\\s+(?!type\\b)[^;\\n]*['"]${lib}['"]|^import\\s+['"]${lib}['"]`, 'm')
        if (top.test(text)) offenders.push(`${path.relative(ROOT, file)} imports ${lib} at the top`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('are still loaded where they are used', () => {
    const word = readFileSync(path.join(ROOT, 'importers/word/run.ts'), 'utf8')
    const html = readFileSync(path.join(ROOT, 'importers/html/turndown.ts'), 'utf8')
    expect(word).toMatch(/await import\('mammoth'\)/)
    expect(html).toMatch(/await import\('turndown'\)/)
  })
})
