import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

/** The Linux download's name is written in places that nothing else ties
 *  together: electron-builder.yml decides what the file is called, release.yml's
 *  verify-release checks that name uploaded, and the Linux install guide links
 *  to it (site/install/guide.js and linux.html). Rename it in one and the
 *  release goes red or the download page 404s — with every other check green.
 *  The macOS twin of this is macDmgNames.test.ts.
 *
 *  It lives in `src/main/` for the same reason that one does: this is the half
 *  of the project where reading files is legal. */

const APPIMAGE = 'Notealise.AppImage'

/** One top-level block of electron-builder.yml: from `name:` to the next
 *  unindented line that is not a comment. */
function section(yaml: string, name: string): string {
  const lines = yaml.split(/\r?\n/)
  const start = lines.findIndex((l) => l === `${name}:`)
  if (start === -1) return ''
  const rest = lines.slice(start + 1)
  const end = rest.findIndex((l) => l.length > 0 && !/^[\s#]/.test(l))
  return [lines[start], ...(end === -1 ? rest : rest.slice(0, end))].join('\n')
}

describe('the Linux download name', () => {
  it('is what electron-builder.yml builds', () => {
    const config = readFileSync('electron-builder.yml', 'utf8')
    expect(config).toMatch(/^productName: Notealise$/m)
    const linux = section(config, 'linux')
    expect(linux).toContain('target: AppImage')
    expect(linux).toContain('arch: x64')
    expect(linux).toContain('artifactName: ${productName}.${ext}')
  })

  it('is what release.yml builds on Linux and checks was uploaded, with its feed', () => {
    const workflow = readFileSync('.github/workflows/release.yml', 'utf8')
    expect(workflow).toMatch(/os: \[[^\]]*\bubuntu-latest\b[^\]]*\]/)
    expect(workflow).toContain(`"${APPIMAGE}"`)
    // latest-linux.yml is the file a Linux install reads to find updates.
    expect(workflow).toContain('linux_yml="${yml%.yml}-linux.yml"')
    expect(workflow).toContain('"$linux_yml"')
  })

  it('is what the Linux install guide downloads', () => {
    expect(readFileSync('site/install/guide.js', 'utf8')).toContain(`linux: "${APPIMAGE}"`)
    expect(readFileSync('site/install/linux.html', 'utf8')).toContain(
      `releases/latest/download/${APPIMAGE}`
    )
  })

  it('has a button on the home page', () => {
    expect(readFileSync('site/index.html', 'utf8')).toContain(
      'id="linuxBtn" class="btn" href="install/linux.html?dl=1"'
    )
  })
})
