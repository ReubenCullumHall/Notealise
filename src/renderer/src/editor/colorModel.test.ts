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
