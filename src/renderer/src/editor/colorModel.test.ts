import { describe, expect, it } from 'vitest'
import { recolor } from './colorModel'

// The colour model is the fiddliest pure code in the app: it flattens a region to
// characters, re-colours the selected ones, and re-emits merged runs. Every case
// below is one the naive "wrap the selection in a tag" implementation gets wrong.
//
// Tests assert on the resulting DOCUMENT rather than on offsets, because that is
// what actually ends up in the user's .md file.

const M = (name: string, inner: string): string => `<mark class="hl-${name}">${inner}</mark>`
const S = (name: string, inner: string): string => `<span class="tc-${name}">${inner}</span>`
/** The custom-colour form, added 2026-09-05 when the picker gained "any
 *  colour". A hex is the same colour on every theme; a NAME resolves through
 *  `--hl-NAME` / `--tc-NAME`, which differ per theme. */
const MH = (hex: string, inner: string): string =>
  `<mark style="background-color: ${hex}">${inner}</mark>`
const SH = (hex: string, inner: string): string =>
  `<span style="color: ${hex}">${inner}</span>`

/** Apply a RegionChange to the document, the way colorCommands dispatches it. */
function applyTo(text: string, from: number, to: number, name: string | null, tag: 'mark' | 'span' = 'mark'): string {
  const r = recolor(text, from, to, tag, name)
  return text.slice(0, r.from) + r.insert + text.slice(r.to)
}

/** Offsets of `needle` inside `hay`, as a selection range. */
function sel(hay: string, needle: string): [number, number] {
  const i = hay.indexOf(needle)
  if (i < 0) throw new Error(`"${needle}" not in "${hay}"`)
  return [i, i + needle.length]
}

describe('recolor', () => {
  it('wraps an uncoloured selection', () => {
    const doc = 'hello world'
    expect(applyTo(doc, ...sel(doc, 'hello'), 'amber')).toBe(M('amber', 'hello') + ' world')
  })

  it('toggles off when the selection is already that colour', () => {
    const doc = M('amber', 'hello') + ' world'
    expect(applyTo(doc, ...sel(doc, 'hello'), 'amber')).toBe('hello world')
  })

  it('replaces rather than nesting when recolouring', () => {
    const doc = M('amber', 'hello') + ' world'
    const out = applyTo(doc, ...sel(doc, 'hello'), 'sky')
    expect(out).toBe(M('sky', 'hello') + ' world')
    // the failure mode this guards: <mark hl-sky><mark hl-amber>hello</mark></mark>
    expect(out).not.toContain('hl-amber')
  })

  it('splits a span the selection only partly overlaps', () => {
    const doc = M('amber', 'hello')
    expect(applyTo(doc, ...sel(doc, 'he'), 'sky')).toBe(M('sky', 'he') + M('amber', 'llo'))
  })

  it('merges into an equal-coloured neighbour instead of emitting two tags', () => {
    const doc = M('amber', 'ab') + 'cd'
    expect(applyTo(doc, ...sel(doc, 'cd'), 'amber')).toBe(M('amber', 'abcd'))
  })

  it('clears with a null name', () => {
    const doc = M('amber', 'hello') + ' world'
    expect(applyTo(doc, ...sel(doc, 'hello'), null)).toBe('hello world')
  })

  it('clearing an uncoloured selection is a no-op', () => {
    const doc = 'hello world'
    expect(applyTo(doc, ...sel(doc, 'hello'), null)).toBe(doc)
  })

  it('keeps the same text selected after the change', () => {
    const doc = 'hello world'
    const [from, to] = sel(doc, 'hello')
    const r = recolor(doc, from, to, 'mark', 'amber')
    const out = doc.slice(0, r.from) + r.insert + doc.slice(r.to)
    expect(out.slice(r.selFrom, r.selTo)).toBe('hello')
  })

  it('treats text colour and highlight as independent layers', () => {
    const doc = 'hello'
    const hl = applyTo(doc, 0, 5, 'amber', 'mark')
    expect(hl).toBe(M('amber', 'hello'))
    // the <span> pass must not see the <mark> as its own layer
    const both = applyTo(hl, ...sel(hl, 'hello'), 'sky', 'span')
    expect(both).toContain(S('sky', 'hello'))
    expect(both).toContain('hl-amber')
  })

  it('ignores a colour name outside the palette', () => {
    const doc = '<mark class="hl-chartreuse">hello</mark>'
    // not a known name, so it is not parsed as a span and the text is wrapped as-is
    expect(applyTo(doc, ...sel(doc, 'hello'), 'amber')).toContain(M('amber', 'hello'))
  })
})

// --- custom colours -------------------------------------------------------
// The hex form has to be a first-class citizen of the same model, not a second
// path bolted beside it: the region-growing, the toggle-off, the split and the
// merge all have to treat "this run is #ff0000" exactly as they treat "this run
// is amber", or selecting across one of each and recolouring produces a
// document that no longer parses back to what is on screen.
describe('recolor with a custom hex', () => {
  it('wraps an uncoloured selection in the style form', () => {
    const doc = 'hello world'
    expect(applyTo(doc, ...sel(doc, 'hello'), '#ff0000')).toBe(MH('#ff0000', 'hello') + ' world')
  })

  it('uses color: for text and background-color: for highlight', () => {
    const doc = 'hello world'
    expect(applyTo(doc, ...sel(doc, 'hello'), '#00ff00', 'span')).toBe(
      SH('#00ff00', 'hello') + ' world'
    )
  })

  it('toggles off when the selection is already that hex', () => {
    const doc = MH('#ff0000', 'hello') + ' world'
    expect(applyTo(doc, ...sel(doc, 'hello'), '#ff0000')).toBe('hello world')
  })

  it('replaces a named colour with a hex, without nesting', () => {
    const doc = M('amber', 'hello') + ' world'
    expect(applyTo(doc, ...sel(doc, 'hello'), '#ff0000')).toBe(MH('#ff0000', 'hello') + ' world')
  })

  it('replaces a hex with a named colour, without nesting', () => {
    const doc = MH('#ff0000', 'hello') + ' world'
    expect(applyTo(doc, ...sel(doc, 'hello'), 'amber')).toBe(M('amber', 'hello') + ' world')
  })

  it('does not merge two different hexes into one run', () => {
    const doc = MH('#ff0000', 'aa') + MH('#00ff00', 'bb')
    // Recolouring only the first pair leaves the second alone.
    expect(applyTo(doc, ...sel(doc, 'aa'), '#0000ff')).toBe(
      MH('#0000ff', 'aa') + MH('#00ff00', 'bb')
    )
  })

  it('merges neighbours that are the same hex', () => {
    const doc = MH('#ff0000', 'aa') + 'bb'
    expect(applyTo(doc, ...sel(doc, 'bb'), '#ff0000')).toBe(MH('#ff0000', 'aabb'))
  })

  it('splits a hex span the selection only partly covers', () => {
    const doc = MH('#ff0000', 'abcd')
    const out = applyTo(doc, ...sel(doc, 'bc'), '#00ff00')
    expect(out).toBe(MH('#ff0000', 'a') + MH('#00ff00', 'bc') + MH('#ff0000', 'd'))
  })

  it('clears a hex span like any other', () => {
    const doc = MH('#ff0000', 'hello') + ' world'
    expect(applyTo(doc, ...sel(doc, 'hello'), null)).toBe('hello world')
  })

  it('treats a hex and a name as different colours when merging', () => {
    const doc = M('amber', 'aa') + MH('#ff0000', 'bb')
    // Nothing to change: the two runs stay two runs.
    expect(applyTo(doc, ...sel(doc, 'aa'), 'amber')).toBe('aa' + MH('#ff0000', 'bb'))
  })

  it('is case-insensitive about a hex already in the document', () => {
    const doc = '<mark style="background-color: #FF0000">hello</mark> world'
    // Same colour in a different case must toggle OFF, not wrap again.
    expect(applyTo(doc, ...sel(doc, 'hello'), '#ff0000')).toBe('hello world')
  })
})
