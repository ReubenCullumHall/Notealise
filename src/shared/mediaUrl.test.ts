import { describe, expect, it } from 'vitest'
import { AWKWARD_NAMES } from './awkwardNames'
import { byteRange, MEDIA_SCHEME, mediaPathOf, mediaUrl } from './mediaUrl'

const TOKEN = 'a3f1c0de5b7e4d2f9a8b6c4d2e0f1a3b'

describe('the media address', () => {
  // A picture is found by its name, and people's names carry `#`, `%`, `?`,
  // brackets, both spellings of é, emoji and spaces at the ends — every one of
  // which means something else inside an address. The path has to come back out
  // exactly as it went in, or main looks for a file that isn't there.
  it('carries every awkward name there and back unchanged', () => {
    for (const name of AWKWARD_NAMES) {
      for (const rel of [`${name}.png`, `${name}/${name}.mov`, `Space/${name}/clip (2).m4a`]) {
        expect(mediaPathOf(mediaUrl(TOKEN, rel, '1-2'), TOKEN)).toBe(rel)
      }
    }
  })

  it('carries a path that only LOOKS like it tidies away', () => {
    // A URL parser collapses these in a path; as one encoded value they survive
    // to main, whose boundary check is the thing that must judge them.
    for (const rel of ['a/../b.png', '../outside.png', './x.png', 'trailing./y.png', 'back\\slash.png', '..todo.png', 'a?b=c&p=zzz.png', 'a#b.png', '100%.png', '%2e%2e/x.png']) {
      expect(mediaPathOf(mediaUrl(TOKEN, rel, '1-2'), TOKEN)).toBe(rel)
    }
  })

  it('is refused without this launch’s token', () => {
    const url = mediaUrl(TOKEN, 'Biology/cell.png', '1-2')
    expect(mediaPathOf(url, TOKEN)).toBe('Biology/cell.png')
    expect(mediaPathOf(url, 'b'.repeat(32))).toBeNull()
    expect(mediaPathOf(url, '')).toBeNull()
    expect(mediaPathOf(`${MEDIA_SCHEME}:///?p=Biology%2Fcell.png`, '')).toBeNull() // no token at all
    expect(mediaPathOf(`${MEDIA_SCHEME}://${TOKEN}.evil/?p=x.png`, TOKEN)).toBeNull()
    expect(mediaPathOf(`${MEDIA_SCHEME}://${TOKEN}@evil/?p=x.png`, TOKEN)).toBeNull()
  })

  it('is refused for any other kind of address', () => {
    expect(mediaPathOf(`https://${TOKEN}/?p=x.png`, TOKEN)).toBeNull()
    expect(mediaPathOf(`file://${TOKEN}/?p=x.png`, TOKEN)).toBeNull()
    expect(mediaPathOf('not an address', TOKEN)).toBeNull()
    expect(mediaPathOf(`${MEDIA_SCHEME}://${TOKEN}/`, TOKEN)).toBeNull() // names no file
    expect(mediaPathOf(`${MEDIA_SCHEME}://${TOKEN}/?p=`, TOKEN)).toBeNull()
  })

  it('changes when the file does', () => {
    expect(mediaUrl(TOKEN, 'a.png', '100-5')).not.toBe(mediaUrl(TOKEN, 'a.png', '200-5'))
  })
})

describe('which bytes a player asked for', () => {
  it('the whole file when it names no range', () => {
    expect(byteRange(null, 1000)).toBe('whole')
    expect(byteRange('', 1000)).toBe('whole')
  })

  it('from a point to the end — what a video asks first', () => {
    expect(byteRange('bytes=0-', 1000)).toEqual({ start: 0, end: 999 })
    expect(byteRange('bytes=250-', 1000)).toEqual({ start: 250, end: 999 })
  })

  it('a closed range, cut off at the end of the file', () => {
    expect(byteRange('bytes=10-19', 1000)).toEqual({ start: 10, end: 19 })
    expect(byteRange('bytes=990-5000', 1000)).toEqual({ start: 990, end: 999 })
    expect(byteRange('bytes=999-999', 1000)).toEqual({ start: 999, end: 999 })
  })

  it('the last N bytes — where a film keeps its index', () => {
    expect(byteRange('bytes=-100', 1000)).toEqual({ start: 900, end: 999 })
    expect(byteRange('bytes=-5000', 1000)).toEqual({ start: 0, end: 999 })
  })

  it('nothing, when it starts past the end', () => {
    expect(byteRange('bytes=1000-', 1000)).toBe('none')
    expect(byteRange('bytes=5000-6000', 1000)).toBe('none')
    expect(byteRange('bytes=-0', 1000)).toBe('none')
    expect(byteRange('bytes=0-', 0)).toBe('none')
    expect(byteRange('bytes=-10', 0)).toBe('none')
  })

  // A server may ignore a range it does not understand and send the lot.
  it('the whole file for a range it does not understand', () => {
    expect(byteRange('bytes=0-10,20-30', 1000)).toBe('whole')
    expect(byteRange('bytes=20-10', 1000)).toBe('whole')
    expect(byteRange('bytes=-', 1000)).toBe('whole')
    expect(byteRange('items=0-10', 1000)).toBe('whole')
    expect(byteRange('bytes=abc-def', 1000)).toBe('whole')
    expect(byteRange('bytes=99999999999999999999-', 1000)).toBe('none')
  })
})
