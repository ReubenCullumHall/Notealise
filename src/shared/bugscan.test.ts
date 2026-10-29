// File names that broke photos, videos and voice notes (bug scan 2026-10-27).
import { describe, expect, it } from 'vitest'
import { encodeTarget, indexEmbeds, repointFileLinks, resolveVaultPath, voiceEmbeds } from './attachments'
import { AWKWARD_NAMES } from './awkwardNames'

describe('awkward file names in embeds', () => {
  it("an apostrophe is written encoded, so no quote can cut the name short", () => {
    expect(encodeTarget("Reuben's holiday.mp4")).toBe('Reuben%27s%20holiday.mp4')
  })
  it("an apostrophe already in a note (written by an older build) is still read whole", () => {
    const text = `<video controls src="Reuben's%20holiday.mp4"></video>\n<audio controls src="Mum's%20memo.m4a"></audio>`
    const found = indexEmbeds(text).map((t) => resolveVaultPath(t, 'Notes/Trip.md'))
    expect(found).toEqual(["Notes/Reuben's holiday.mp4", "Notes/Mum's memo.m4a"])
    expect(voiceEmbeds(text, 'Notes/Trip.md').map((v) => v.file)).toEqual(["Notes/Mum's memo.m4a"])
  })
  it('brackets in a name, as Obsidian writes them, stay one name', () => {
    expect(indexEmbeds('![](photo%20(1).png)')).toEqual(['photo%20(1).png'])
  })
  it('moving a note keeps a bracketed picture and file pointing at the same files', () => {
    const out = repointFileLinks('![](photo%20(1).png) and [Report](report%20(final).pdf)', 'A/n.md', 'B/n.md')
    const targets = [...out.matchAll(/\]\(([^)]*(?:\([^)]*\)[^)]*)*)\)/g)].map((m) => resolveVaultPath(m[1], 'B/n.md'))
    expect(targets).toEqual(['A/photo (1).png', 'A/report (final).pdf'])
  })
})


describe('every awkward name survives being put in a note and read back', () => {
  for (const name of AWKWARD_NAMES) {
    for (const [kind, ext] of [['picture', 'png'], ['video', 'mp4'], ['voice note', 'm4a']] as const) {
      it(`${kind}: ${JSON.stringify(name)}`, () => {
        const file = `${name}.${ext}`
        const t = encodeTarget(file)
        const written = kind === 'picture' ? `![](${t})` : `<${kind === 'video' ? 'video' : 'audio'} controls src="${t}"></${kind === 'video' ? 'video' : 'audio'}>`
        const found = indexEmbeds(`Before ${written} after`).map((x) => resolveVaultPath(x, 'Space/Note.md'))
        expect(found).toEqual([`Space/${file}`])
        // ...and still after the note moves to another folder
        const moved = repointFileLinks(written, 'Space/Note.md', 'Other/Deep/Note.md')
        expect(indexEmbeds(moved).map((x) => resolveVaultPath(x, 'Other/Deep/Note.md'))).toEqual([`Space/${file}`])
      })
    }
  }
})
