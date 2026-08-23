import { describe, expect, it } from 'vitest'
import {
  ATTACHMENT_EXTS,
  IMAGE_EXTS,
  VIDEO_EXTS,
  extForMime,
  kindForExt,
  kindForFilename,
  kindForMime
} from './attachments'

// This catalogue exists because main and the renderer used to keep separate
// lists, keyed differently (extensions vs MIME types), and they could disagree
// about what the app accepts. So the tests worth having are the ones that check
// the two keyings still describe the SAME set — plus the filename edge case that
// used to write a hidden, unopenable dotfile into someone's vault.

describe('the two keyings agree', () => {
  it('every MIME type resolves to an extension that resolves back to the same kind', () => {
    for (const mime of [
      'image/png',
      'image/jpeg',
      'image/gif',
      'image/webp',
      'image/svg+xml',
      'image/bmp',
      'image/avif',
      'video/mp4',
      'video/webm',
      'video/quicktime',
      'video/x-m4v',
      'video/ogg'
    ]) {
      const kind = kindForMime(mime)
      const ext = extForMime(mime)
      expect(kind, mime).not.toBeNull()
      expect(ext, mime).not.toBeNull()
      expect(kindForExt(ext as string), mime).toBe(kind)
      expect(ATTACHMENT_EXTS, mime).toContain(ext)
    }
  })

  it('the picker lists are exactly the extensions each kind claims', () => {
    for (const ext of IMAGE_EXTS) expect(kindForExt(ext), ext).toBe('image')
    for (const ext of VIDEO_EXTS) expect(kindForExt(ext), ext).toBe('video')
    expect(ATTACHMENT_EXTS).toEqual([...IMAGE_EXTS, ...VIDEO_EXTS])
  })

  it('takes .jpg and .jpeg alike — both are what image/jpeg arrives as', () => {
    expect(kindForExt('jpg')).toBe('image')
    expect(kindForExt('jpeg')).toBe('image')
    // The canonical one is what a nameless paste is saved as, so it must be short.
    expect(extForMime('image/jpeg')).toBe('jpg')
  })
})

describe('kindForFilename', () => {
  it('reads the extension, whatever case it is written in', () => {
    expect(kindForFilename('holiday.PNG')).toBe('image')
    expect(kindForFilename('clip.MoV')).toBe('video')
  })

  it('handles a name with dots in it', () => {
    expect(kindForFilename('my.holiday.photo.png')).toBe('image')
  })

  it('takes only the basename, on either platform’s separator', () => {
    expect(kindForFilename('Import/2024/clip.mp4')).toBe('video')
    expect(kindForFilename('C:\\Users\\me\\clip.mp4')).toBe('video')
  })

  it('refuses a name that is nothing but a dotted suffix', () => {
    // ".png" has NO extension by path.parse's reading — it is a hidden,
    // extensionless file that nothing will open. Refusing it here is what keeps
    // it out of the vault, since main validates every attachment write with this.
    expect(kindForFilename('.png')).toBeNull()
    expect(kindForFilename('.mp4')).toBeNull()
  })

  it('refuses anything that is not a photo or a video', () => {
    expect(kindForFilename('notes.md')).toBeNull()
    expect(kindForFilename('archive.zip')).toBeNull()
    expect(kindForFilename('script.sh')).toBeNull()
    expect(kindForFilename('no-extension')).toBeNull()
    expect(kindForFilename('')).toBeNull()
  })
})

describe('kindForMime', () => {
  it('refuses a type nothing here handles', () => {
    expect(kindForMime('application/pdf')).toBeNull()
    expect(kindForMime('text/plain')).toBeNull()
    expect(kindForMime('')).toBeNull()
    expect(extForMime('application/pdf')).toBeNull()
  })
})
