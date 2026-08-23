import { describe, expect, it } from 'vitest'
import { attachmentFileOf } from './attachSelect'

// What gets DELETED FROM THE VAULT when a photo or video is taken out of a note
// (attachSelect.ts -> MediaDelete.file -> App's binMedia). Everything else about
// this feature is recoverable from the bin; picking the wrong path here is the
// one way it could remove something nobody asked it to.
describe('attachmentFileOf', () => {
  const NOTE = 'Space/Sub/Note.md'

  it('reads an image target, relative to the note holding it', () => {
    expect(attachmentFileOf('![](photo.png)', NOTE)).toBe('Space/Sub/photo.png')
    expect(attachmentFileOf('![alt text](photo.png)', NOTE)).toBe('Space/Sub/photo.png')
    expect(attachmentFileOf('![](../up.jpg)', NOTE)).toBe('Space/up.jpg')
    expect(attachmentFileOf('![](photo.png)', 'Root.md')).toBe('photo.png')
  })

  it('decodes the percent-escapes attachInput writes for spaces and parens', () => {
    expect(attachmentFileOf('![](my%20holiday.png)', NOTE)).toBe('Space/Sub/my holiday.png')
    expect(attachmentFileOf('![](a%28b%29.png)', NOTE)).toBe('Space/Sub/a(b).png')
  })

  it('reads a video target, either quote style', () => {
    expect(attachmentFileOf('<video controls src="clip.mp4"></video>', NOTE)).toBe('Space/Sub/clip.mp4')
    expect(attachmentFileOf("<video controls src='clip.mov'></video>", NOTE)).toBe('Space/Sub/clip.mov')
  })

  // Shapes attachInput never writes, but a hand-typed embed can.
  it('handles a title after the destination, and an angle-bracketed one', () => {
    expect(attachmentFileOf('![](photo.png "Look at this")', NOTE)).toBe('Space/Sub/photo.png')
    expect(attachmentFileOf('![](<my holiday.png>)', NOTE)).toBe('Space/Sub/my holiday.png')
  })

  it('refuses anything that is not a photo or video — a note above all', () => {
    // The whole point of the extension check: this line is writable Markdown,
    // and binning the note it names would be catastrophic and silent.
    expect(attachmentFileOf('![](Some note.md)', NOTE)).toBeNull()
    expect(attachmentFileOf('![](archive.zip)', NOTE)).toBeNull()
    expect(attachmentFileOf('![](noextension)', NOTE)).toBeNull()
    expect(attachmentFileOf('![](.png)', NOTE)).toBeNull()
  })

  it('refuses anything with no file behind it', () => {
    expect(attachmentFileOf('![](https://example.com/photo.png)', NOTE)).toBeNull()
    expect(attachmentFileOf('![](data:image/png;base64,AAAA)', NOTE)).toBeNull()
    expect(attachmentFileOf('![](/absolute/photo.png)', NOTE)).toBeNull()
    expect(attachmentFileOf('![](../../../escape.png)', 'Note.md')).toBeNull()
    expect(attachmentFileOf('![]()', NOTE)).toBeNull()
    expect(attachmentFileOf('just some text', NOTE)).toBeNull()
  })
})
