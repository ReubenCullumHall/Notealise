import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseRelease, type MacArch } from '../shared/update'

/** The per-chip .dmg names, as electron-builder.yml really produces them, must
 *  sort AFTER the universal `Notealise.dmg`.
 *
 *  Copies installed before the split (v1.0.2 and earlier) take the FIRST .dmg
 *  in a release, and GitHub lists assets alphabetically — so this ordering is
 *  all that stands between an old install on an Intel Mac and a download that
 *  will not open. See CHIP_DMG in shared/update.ts. Read from the real config,
 *  so renaming the artifact there fails here rather than on someone's Mac.
 *
 *  It lives in `src/main/` for the same reason tailwindOpacity.test.ts does:
 *  this is the half of the project where reading files is legal. */

function macArtifactName(): string {
  const lines = readFileSync('electron-builder.yml', 'utf8').split('\n')
  const mac = lines.indexOf('mac:')
  let pattern = ''
  for (let i = mac + 1; i < lines.length && /^(\s|#|$)/.test(lines[i]); i++) {
    const m = /^\s+artifactName:\s*(\S+)/.exec(lines[i])
    if (m) pattern = m[1]
  }
  return pattern
}

const release = (...names: string[]) => ({
  tag_name: 'v2.0.0',
  assets: names.map((name) => ({
    name,
    browser_download_url: `https://github.com/x/y/releases/download/v2.0.0/${name}`
  }))
})

describe('the Mac .dmg names electron-builder.yml produces', () => {
  const pattern = macArtifactName()
  const named = (arch: MacArch) =>
    pattern.replace('${productName}', 'Notealise').replace('${arch}', arch).replace('${ext}', 'dmg')
  const names = [named('x64'), named('arm64'), 'Notealise.dmg']

  it('are found in the config at all', () => {
    expect(pattern).toContain('${arch}')
  })

  it("are recognised as each chip's own build", () => {
    const file = (arch: MacArch) => parseRelease(release(...names), arch)?.dmgUrl?.split('/').pop()
    expect(file('arm64')).toBe(named('arm64'))
    expect(file('x64')).toBe(named('x64'))
  })

  it('sort after the universal build, under either way of sorting', () => {
    expect([...names].sort((a, b) => a.localeCompare(b))[0]).toBe('Notealise.dmg')
    expect([...names].sort((a, b) => (a.toLowerCase() < b.toLowerCase() ? -1 : 1))[0]).toBe(
      'Notealise.dmg'
    )
  })
})
