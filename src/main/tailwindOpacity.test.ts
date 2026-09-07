import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** Tailwind v3's opacity scale is MULTIPLES OF FIVE. `bg-brand-500/12` is not a
 *  class it has ever generated — it silently emits nothing, so the element ends
 *  up with no background at all while the JSX still reads as though it has one.
 *
 *  Found 2026-09-06 by running a real `electron-vite build` and grepping the
 *  output CSS, after `typecheck`, `lint` and 669 unit tests all passed on 52
 *  dead classes: 24 that had been in the app for weeks, and 28 that an accent
 *  sweep added the same day while "unifying" the selection wash onto a value
 *  that does not exist. Nothing anywhere failed. This is that grep, kept — see
 *  CLAUDE.md's rule about packaging to verify a config change.
 *
 *  It lives in `src/main/` because this is the half of the project where
 *  reading files is legal (tsconfig.node has `types: ["node"]`; the renderer's
 *  deliberately does not — rule 6). It is a source scan, not renderer code.
 *
 *  If you genuinely need an off-scale alpha, Tailwind's arbitrary syntax works:
 *  `bg-brand-500/[0.12]`, which this deliberately does not match. */
const SCALE_STEP = 5
const ROOT = 'src/renderer/src'

const MODIFIER =
  /\b(?:(?:hover|focus|focus-visible|focus-within|group-hover|active|disabled|dark|aria-\w+|data-\[[^\]]+\]):)*(?:bg|text|border|ring|from|to|via|divide|outline|shadow|placeholder|caret|accent|decoration|fill|stroke)-[a-z]+-\d{2,3}\/(\d{1,3})\b/g

function tsxFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) tsxFiles(full, out)
    else if (full.endsWith('.tsx')) out.push(full)
  }
  return out
}

describe('Tailwind opacity modifiers', () => {
  it('only uses alphas Tailwind actually generates', () => {
    const offenders: string[] = []
    for (const file of tsxFiles(ROOT)) {
      for (const m of readFileSync(file, 'utf8').matchAll(MODIFIER)) {
        if (Number(m[1]) % SCALE_STEP !== 0) offenders.push(`${file}: ${m[0]}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('is actually looking at the app, not an empty folder', () => {
    // A walk that silently found nothing would pass forever. 40+ components,
    // and every one of them uses at least one opacity modifier.
    expect(tsxFiles(ROOT).length).toBeGreaterThan(30)
  })
})
