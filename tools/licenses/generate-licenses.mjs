#!/usr/bin/env node
// GENERATOR for src/renderer/src/settings/ossLicenses.generated.ts — the data
// behind Settings → General → "Open source licenses".
//
// Walks the shipped dependency graph from package-lock.json, starting at the
// root package's "dependencies" plus the devDependencies the renderer bundles
// (see rendererImports below) — never build tools, which never ship. The graph
// comes from the LOCKFILE, not a scan of the
// installed node_modules on disk: this project's OneDrive node_modules is a
// Windows-targeted install (see CLAUDE.md's "two trees" gotcha) and isn't
// always fully in sync with the lockfile, so a name+version+license lookup
// against package-lock.json's "packages" map is the source of truth. Package
// names are resolved the way npm itself would — walking up through ancestor
// "node_modules/…" keys — so a nested/duplicated version resolves to the
// copy that dependency actually requires.
//
// Full license TEXT is still read from disk where the package happens to be
// present locally (best effort) — the lockfile only carries the SPDX
// identifier, not the file contents. Where the text isn't available, the
// generated entry carries licenseText: null and the UI says to check the
// project's own repository instead of fabricating text no one has verified.
//
// Regenerate after any dependency change:
//   node tools/licenses/generate-licenses.mjs
// Never hand-edit the generated file — same rule as tools/wordmark's output.

import { readFileSync, existsSync, writeFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../..')

function readJson(p) {
  return JSON.parse(readFileSync(p, 'utf8'))
}

const lock = readJson(path.join(ROOT, 'package-lock.json'))
const packages = lock.packages ?? {}

// `fromKey` is a lockfile package key ("" for root, "node_modules/@scope/x"
// for everyone else). Mirrors Node's own module resolution: check this
// level's node_modules/<name>, then walk up one node_modules segment at a
// time until root.
function resolveInLock(name, fromKey) {
  let key = fromKey
  for (;;) {
    const candidate = key === '' ? `node_modules/${name}` : `${key}/node_modules/${name}`
    if (packages[candidate]) return candidate
    if (key === '') return null
    const idx = key.lastIndexOf('/node_modules/')
    key = idx === -1 ? '' : key.slice(0, idx)
  }
}

function licenseIdOf(entry) {
  if (typeof entry.license === 'string') return entry.license
  if (entry.license && typeof entry.license === 'object') return entry.license.type ?? null
  if (Array.isArray(entry.licenses) && entry.licenses[0]) return entry.licenses[0].type ?? null
  return null
}

const LICENSE_FILENAMES = [
  'LICENSE',
  'LICENSE.md',
  'LICENSE.txt',
  'LICENSE-MIT',
  'License',
  'license',
  'COPYING',
  'COPYING.md'
]

function findLicenseTextOnDisk(lockKey) {
  const dir = path.join(ROOT, lockKey)
  for (const name of LICENSE_FILENAMES) {
    const p = path.join(dir, name)
    if (existsSync(p)) return readFileSync(p, 'utf8').trim()
  }
  return null
}

// The renderer's libraries (React, CodeMirror, KaTeX…) are devDependencies ON
// PURPOSE. Vite bundles them into out/renderer, so leaving them under
// "dependencies" made electron-builder copy a second, never-loaded set into the
// package as well (~18 MB, removed 2026-09-11). They still SHIP — inside that
// bundle — so their licences still belong here. Which devDependencies those are
// is read off the renderer's own imports rather than kept as a list, so a new
// renderer library cannot be left out.
function rendererImports() {
  const found = new Set()
  const walk = (dir) => {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name)
      if (ent.isDirectory()) walk(p)
      else if (/\.(tsx?|jsx?|css)$/.test(ent.name) && !/\.test\./.test(ent.name)) {
        const src = readFileSync(p, 'utf8')
        for (const m of src.matchAll(/(?:from\s+|import\s*\(\s*|import\s+|@import\s+)['"]([^'"./][^'"]*)['"]/g)) {
          const parts = m[1].split('/')
          found.add(m[1].startsWith('@') ? parts.slice(0, 2).join('/') : parts[0])
        }
      }
    }
  }
  walk(path.join(ROOT, 'src/renderer'))
  return found
}

const seen = new Map()
const rootDeps = packages[''].dependencies ?? {}
const devDeps = packages[''].devDependencies ?? {}
const bundled = [...rendererImports()].filter((name) => name in devDeps && !name.startsWith('@types/'))
const queue = [...Object.keys(rootDeps), ...bundled].map((name) => ({ name, fromKey: '' }))

while (queue.length > 0) {
  const { name, fromKey } = queue.shift()
  if (seen.has(name)) continue
  const key = resolveInLock(name, fromKey)
  if (!key) {
    console.warn(`  ! could not resolve ${name} (from "${fromKey}") in package-lock.json — skipping`)
    continue
  }
  const entry = packages[key]
  seen.set(name, {
    name,
    version: entry.version ?? 'unknown',
    license: licenseIdOf(entry) ?? 'UNKNOWN',
    licenseText: findLicenseTextOnDisk(key)
  })
  for (const dep of Object.keys(entry.dependencies ?? {})) {
    queue.push({ name: dep, fromKey: key })
  }
}

// Things that ship but are not npm packages, so the lockfile walk above can't
// see them: the five bundled font files and the emoji names list. The copyright
// lines are the ones inside each font file's own name table (and OpenDyslexic's
// carries its Reserved Font Name); every font here is SIL OFL 1.1, whose full
// text is kept beside the Noto Emoji font. Add a line here when a font is bundled.
const FONTS_DIR = path.join(ROOT, 'src/renderer/src/assets/fonts')
const ofl = readFileSync(path.join(FONTS_DIR, 'noto-emoji/OFL.txt'), 'utf8').trim()
const oflBody = ofl.slice(ofl.indexOf('This Font Software'))
const fontEntry = (name, version, copyright) => ({
  name: `${name} (font)`,
  version,
  license: 'OFL-1.1',
  licenseText: `${copyright}\n\n${oflBody}`
})
const bundledAssets = [
  fontEntry('Inter', '4.001', 'Copyright 2016 The Inter Project Authors (https://github.com/rsms/inter)'),
  fontEntry('Fraunces', '1.000', 'Copyright 2020 The Fraunces Project Authors (github.com/undercasetype/Fraunces)'),
  fontEntry(
    'JetBrains Mono',
    '2.211',
    'Copyright 2020 The JetBrains Mono Project Authors (https://github.com/JetBrains/JetBrainsMono)'
  ),
  fontEntry(
    'OpenDyslexic',
    '0.920',
    'Copyright (c) 2019-07-29, Abbie Gonzalez (https://abbiecod.es|support@abbiecod.es),\nwith Reserved Font Name OpenDyslexic.\nCopyright (c) 12/2012 - 2019'
  ),
  { name: 'Noto Emoji (font)', version: '3.006', license: 'OFL-1.1', licenseText: ofl },
  {
    name: 'emojibase-data (emoji names)',
    version: '17.0.0',
    license: 'MIT',
    licenseText: readFileSync(path.join(ROOT, 'tools/licenses/emojibase-data-LICENSE.txt'), 'utf8').trim()
  }
]

const list = [...seen.values(), ...bundledAssets].sort((a, b) => a.name.localeCompare(b.name))

const withoutText = list.filter((p) => !p.licenseText)
if (withoutText.length > 0) {
  console.warn(`  ! no license file on disk for: ${withoutText.map((p) => p.name).join(', ')}`)
}
const withoutId = list.filter((p) => p.license === 'UNKNOWN')
if (withoutId.length > 0) {
  console.warn(`  ! no license field in lockfile for: ${withoutId.map((p) => p.name).join(', ')}`)
}

const header = `// GENERATED by tools/licenses/generate-licenses.mjs — do not hand-edit.
// Regenerate after any dependency change: node tools/licenses/generate-licenses.mjs

`

const body = `export interface OssLicense {
  name: string
  version: string
  license: string
  licenseText: string | null
}

export const OSS_LICENSES: OssLicense[] = ${JSON.stringify(list, null, 2)}
`

const outPath = path.join(ROOT, 'src/renderer/src/settings/ossLicenses.generated.ts')
writeFileSync(outPath, header + body)
console.log(`Wrote ${list.length} packages to ${path.relative(ROOT, outPath)}`)
