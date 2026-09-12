import { describe, expect, it } from 'vitest'
import { pickLocale } from './intl'

// The OS region arrives as a launch argument (main/index.ts → preload), so it is
// text from outside the app. Every date and number in the UI is formatted with
// it, and Intl THROWS on a malformed tag — so a bad value must fall back to the
// default, not reach Intl.
describe('pickLocale', () => {
  it('accepts what the OS hands over, in either separator style', () => {
    expect(pickLocale('fr-FR')).toBe('fr-FR')
    expect(pickLocale('en-GB')).toBe('en-GB')
    expect(pickLocale('en_GB')).toBe('en-GB')
  })

  it('drops anything that is not a locale instead of throwing', () => {
    expect(pickLocale('')).toBeUndefined()
    expect(pickLocale('   ')).toBeUndefined()
    expect(pickLocale('not a locale!')).toBeUndefined()
    expect(pickLocale(undefined)).toBeUndefined()
    expect(pickLocale(42)).toBeUndefined()
  })
})
