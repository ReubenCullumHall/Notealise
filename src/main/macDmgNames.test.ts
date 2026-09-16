import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { INTEL_DMG } from '../shared/update'

/** The Intel .dmg's name is written in three places that nothing else ties
 *  together: release.yml names the file when it packages it, the updater looks
 *  for it (INTEL_DMG in shared/update.ts), and the download page links to it
 *  (site/mac-chip.js). Rename it in one and an Intel Mac gets no updates,
 *  or a download page that 404s — with every other check still green.
 *
 *  It lives in `src/main/` for the same reason tailwindOpacity.test.ts does:
 *  this is the half of the project where reading files is legal. */

const INTEL_PATTERN = INTEL_DMG.replace('Notealise', '${productName}').replace('.dmg', '.${ext}')

describe('the Intel Mac download name', () => {
  it('is what release.yml packages the Intel build as', () => {
    const workflow = readFileSync('.github/workflows/release.yml', 'utf8')
    expect(workflow).toContain(`-c.mac.artifactName='${INTEL_PATTERN}'`)
    expect(workflow).toContain(`"${INTEL_DMG}"`) // and what verify-release expects to find
  })

  it('is what the website offers an Intel Mac', () => {
    expect(readFileSync('site/mac-chip.js', 'utf8')).toContain(`"${INTEL_DMG}"`)
  })
})
