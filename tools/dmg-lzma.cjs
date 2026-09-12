// electron-builder `artifactBuildCompleted` hook (wired in electron-builder.yml).
//
// Re-compresses each finished .dmg with LZMA (hdiutil's ULMO format) before it
// is uploaded. The order is what makes this work: app-builder-lib emits this
// hook and WAITS for it before it hands the file to the publisher
// (packager.js `emitArtifactBuildCompleted` → then `emitArtifactCreated`, which
// is what PublishManager listens to), so the file that reaches the GitHub
// Release is the converted one, in CI exactly as locally.
//
// Why a hook and not `dmg.format`: electron-builder's config schema accepts only
// ULFO among the modern formats, and ULFO saved ~2%. Measured 2026-09-11 on the
// Apple silicon build — default UDZO ~111 MB, opens in ~3s; ULFO 108.7 MB, 4.1s;
// ULMO 82.6 MB, 7.1s. Reuben chose the smaller file over the faster open.
// ULMO needs macOS 10.15+ to open; the app itself already needs macOS 12.
//
// Anything that is not a .dmg (the Windows installer, blockmaps) is left alone,
// so this is a no-op on the Windows runner, which has no hdiutil.

const { execFileSync } = require('node:child_process')
const fs = require('node:fs')

module.exports = async function dmgToLzma(event) {
  const file = event && event.file
  if (typeof file !== 'string' || !file.endsWith('.dmg')) return
  const tmp = file.replace(/\.dmg$/, '.lzma.dmg')
  fs.rmSync(tmp, { force: true })
  execFileSync('hdiutil', ['convert', file, '-format', 'ULMO', '-o', tmp, '-quiet'], { stdio: 'inherit' })
  // A converted image that does not verify must never replace the good one.
  execFileSync('hdiutil', ['verify', tmp, '-quiet'], { stdio: 'inherit' })
  fs.renameSync(tmp, file)
}
