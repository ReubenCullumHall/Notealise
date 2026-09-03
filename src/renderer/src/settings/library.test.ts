import { describe, expect, it } from 'vitest'
import { spacesWearing, spacesWearingFont, withoutFont, withoutPageLook, withoutTint } from './library'
import { DEFAULT_SETTINGS, freshSpace, type AppSettings } from '../../../shared/settings'

// The half of "remove" that is invisible until much later: a space left
// pointing at something its own picker no longer lists renders a look you
// can't see selected and can't unselect. See library.ts.

function settings(over: Partial<AppSettings>): AppSettings {
  return { ...DEFAULT_SETTINGS, ...over }
}

describe('taking something out of the collection', () => {
  it('takes a page look off every space wearing it, and leaves the others alone', () => {
    const s = settings({
      pageLookLibrary: ['dots', 'graph'],
      spaces: [
        { ...freshSpace('Revision'), pageLook: 'dots' },
        { ...freshSpace('Journal'), pageLook: 'graph' },
        { ...freshSpace('Scratch'), pageLook: 'dots' }
      ]
    })
    const patch = withoutPageLook(s, 'dots')
    expect(patch.pageLookLibrary).toEqual(['graph'])
    expect(patch.spaces?.map((x) => x.pageLook)).toEqual(['', 'graph', ''])
  })

  it('does the same for a tint, matching on the whole token', () => {
    const s = settings({
      tintLibrary: ['#abcdef@12', '#abcdef@20'],
      spaces: [
        { ...freshSpace('A'), tint: '#abcdef@12' },
        // same colour, different strength — a different tint, and it stays
        { ...freshSpace('B'), tint: '#abcdef@20' }
      ]
    })
    const patch = withoutTint(s, '#abcdef@12')
    expect(patch.tintLibrary).toEqual(['#abcdef@20'])
    expect(patch.spaces?.map((x) => x.tint)).toEqual(['', '#abcdef@20'])
  })

  it('never mutates the settings handed to it', () => {
    const s = settings({
      pageLookLibrary: ['dots'],
      spaces: [{ ...freshSpace('A'), pageLook: 'dots' }]
    })
    withoutPageLook(s, 'dots')
    expect(s.pageLookLibrary).toEqual(['dots'])
    expect(s.spaces[0].pageLook).toBe('dots')
  })

  it('counts what is wearing something, for the warning before you remove it', () => {
    const s = settings({
      spaces: [
        { ...freshSpace('A'), tint: '#abcdef@12' },
        { ...freshSpace('B'), tint: '#abcdef@12' },
        { ...freshSpace('C'), tint: '' }
      ]
    })
    expect(spacesWearing(s, 'tint', '#abcdef@12')).toBe(2)
    expect(spacesWearing(s, 'pageLook', 'dots')).toBe(0)
  })

  it('clears a removed font from all THREE of a space\u2019s font fields', () => {
    // The wrinkle a look and a tint don't have: one font id can be sitting in
    // interface, notes and easier-reading at once, and clearing one of them is
    // as bad as clearing none.
    const s = settings({
      spaces: [
        { ...freshSpace('A'), font: 'lora', uiFont: 'lora', dyslexiaFont: 'lexend' },
        { ...freshSpace('B'), font: 'lora', uiFont: '', dyslexiaFont: '' },
        { ...freshSpace('C'), font: 'manrope', uiFont: 'manrope', dyslexiaFont: '' }
      ]
    })
    const patch = withoutFont(s, 'lora')
    expect(patch.spaces?.map((x) => [x.font, x.uiFont, x.dyslexiaFont])).toEqual([
      ['', '', 'lexend'],
      ['', '', ''],
      ['manrope', 'manrope', '']
    ])
  })

  it('counts a font once per space, however many roles it fills there', () => {
    const s = settings({
      spaces: [
        { ...freshSpace('A'), font: 'lora', uiFont: 'lora', dyslexiaFont: 'lora' },
        { ...freshSpace('B'), font: '', uiFont: 'lora', dyslexiaFont: '' },
        { ...freshSpace('C'), font: '', uiFont: '', dyslexiaFont: '' }
      ]
    })
    expect(spacesWearingFont(s, 'lora')).toBe(2)
    expect(spacesWearingFont(s, 'nope')).toBe(0)
  })
})
