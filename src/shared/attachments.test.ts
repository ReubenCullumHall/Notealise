import { describe, expect, it } from 'vitest'
import {
  ATTACHMENT_EXTS,
  DOC_EXTS,
  IMAGE_EXTS,
  VIDEO_EXTS,
  docLinkTarget,
  extForMime,
  repointFileLinks,
  isDocFilename,
  kindForExt,
  kindForFilename,
  kindForMime,
  voiceEmbeds
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

describe('documents a note can open', () => {
  it('knows a document by its extension, any case', () => {
    for (const name of ['Slides.pdf', 'Essay.DOCX', 'notes/Budget.xlsx', 'a.b.c.pptx', 'C:\\Users\\me\\Deck.key'])
      expect(isDocFilename(name), name).toBe(true)
  })

  it('refuses everything a system would RUN, and everything that is not a document', () => {
    for (const name of [
      'run.sh', 'Setup.exe', 'Thing.app', 'x.bat', 'x.cmd', 'x.ps1', 'x.command', 'x.jar', 'x.msi', 'x.dmg',
      'x.docm', 'x.xlsm', 'x.pptm', 'x.html', 'x.htm', 'x.svg', 'x.js', 'x.lnk', 'x.url', 'x.scpt', 'x.zip',
      'Notes.md', 'photo.png', 'clip.mp4', 'pdf', '.pdf', 'noextension', 'x.pdf.exe', 'x.pdf '
    ])
      expect(isDocFilename(name), name).toBe(false)
  })

  it('shares no extension with a photo or a video', () => {
    for (const e of DOC_EXTS) expect(ATTACHMENT_EXTS).not.toContain(e)
  })

  it('finds the vault file a link points at, and only a document', () => {
    expect(docLinkTarget('Slides.pdf', 'Physics/Waves.md')).toBe('Physics/Slides.pdf')
    expect(docLinkTarget('My%20Essay%20%281%29.docx', 'Waves.md')).toBe('My Essay (1).docx')
    expect(docLinkTarget('../Shared/Deck.pptx', 'Physics/Waves.md')).toBe('Shared/Deck.pptx')
    expect(docLinkTarget('https://example.com/x.pdf', 'Waves.md')).toBeNull()
    expect(docLinkTarget('file:///etc/x.pdf', 'Waves.md')).toBeNull()
    expect(docLinkTarget('/etc/x.pdf', 'Waves.md')).toBeNull()
    expect(docLinkTarget('../../x.pdf', 'Waves.md')).toBeNull()
    expect(docLinkTarget('run.sh', 'Waves.md')).toBeNull()
    expect(docLinkTarget('Other note.md', 'Waves.md')).toBeNull()
  })
})

describe('a note moves, and its links to files follow', () => {
  const text = '# N\n\n![](pic.png)\n\n[Slides.pdf](Slides.pdf)\n\n<video controls src="clip.mp4"></video>\n'

  it('re-points photos, videos and documents when the note changes folder', () => {
    expect(repointFileLinks(text, 'A/N.md', 'B/N.md')).toBe(
      '# N\n\n![](../A/pic.png)\n\n[Slides.pdf](../A/Slides.pdf)\n\n<video controls src="../A/clip.mp4"></video>\n'
    )
  })

  it('goes up and down, and out to the vault root', () => {
    expect(repointFileLinks('![](pic.png)', 'A/B/N.md', 'N.md')).toBe('![](A/B/pic.png)')
    expect(repointFileLinks('![](pic.png)', 'N.md', 'A/N.md')).toBe('![](../pic.png)')
    expect(repointFileLinks('![](../x.png)', 'A/B/N.md', 'A/N.md')).toBe('![](x.png)')
  })

  it('leaves a note that needs nothing exactly as it was', () => {
    expect(repointFileLinks(text, 'A/N.md', 'A/Renamed.md')).toBe(text)
    expect(repointFileLinks('![](../Shared/x.png)', 'A/N.md', 'B/N.md')).toBe('![](../Shared/x.png)')
  })

  it('keeps names with spaces and brackets encoded, and a title or <angle> form intact', () => {
    expect(repointFileLinks('![](my%20pic%20%281%29.png "Beach")', 'A/N.md', 'B/N.md')).toBe(
      '![](../A/my%20pic%20%281%29.png "Beach")'
    )
    expect(repointFileLinks('![](<my pic.png>)', 'A/N.md', 'B/N.md')).toBe('![](<../A/my%20pic.png>)')
  })

  it('does not touch web addresses, data: URIs, ordinary links, or what is not a file', () => {
    const other =
      '![](https://youtu.be/dQw4w9WgXcQ) ![](data:image/png;base64,AAAA) [note](Other.md) [site](https://example.com/a.pdf) [x](../../../out.pdf) [c](#heading)'
    expect(repointFileLinks(other, 'A/N.md', 'B/N.md')).toBe(other)
  })

  it('does not mistake the alt text for the target', () => {
    expect(repointFileLinks('![pic.png](pic.png)', 'A/N.md', 'B/N.md')).toBe('![pic.png](../A/pic.png)')
    expect(repointFileLinks('[Slides.pdf](Slides.pdf)', 'A/N.md', 'B/N.md')).toBe('[Slides.pdf](../A/Slides.pdf)')
  })

  it('a moved FOLDER carries its own files: only links out of it change', () => {
    const moved = (f: string): string => (f === 'A' ? 'B/A' : f.startsWith('A/') ? 'B/' + f : f)
    // the sibling photo went with the folder; the one in Shared did not
    expect(repointFileLinks('![](pic.png) ![](../Shared/x.png)', 'A/N.md', 'B/A/N.md', moved)).toBe(
      '![](pic.png) ![](../../Shared/x.png)'
    )
  })

  it('a note that STAYED, linking into a folder that moved or was renamed', () => {
    const moved = (f: string): string => (f.startsWith('Photos/') ? 'Archive/' + f : f)
    expect(repointFileLinks('![](Photos/pic.png) [s](Photos/s.pdf)', 'N.md', 'N.md', moved)).toBe(
      '![](Archive/Photos/pic.png) [s](Archive/Photos/s.pdf)'
    )
    // from a deeper folder, and the same note written twice
    expect(repointFileLinks('![](../Photos/pic.png)', 'Sub/N.md', 'Sub/N.md', moved)).toBe('![](../Archive/Photos/pic.png)')
    // a folder renamed in place, written the way the app writes a name with a space
    const renamed = (f: string): string => (f.startsWith('My Photos/') ? 'Pictures' + f.slice('My Photos'.length) : f)
    expect(repointFileLinks('![](My%20Photos/pic.png)', 'N.md', 'N.md', renamed)).toBe('![](Pictures/pic.png)')
    // everything that is not in that folder is left exactly as it was
    const other = '![](Other/pic.png) ![](https://example.com/a.png) [n](Photos.md) ![](../x.png)'
    expect(repointFileLinks(other, 'N.md', 'N.md', moved)).toBe(other)
  })

  it('a top-level folder (a space) renamed: a note outside it follows', () => {
    const renamed = (f: string): string => (f.startsWith('Notes/') ? 'Docs' + f.slice('Notes'.length) : f)
    expect(repointFileLinks('![](../Notes/pic.png)', 'Other/N.md', 'Other/N.md', renamed)).toBe('![](../Docs/pic.png)')
    expect(repointFileLinks('![](Notes/pic.png)', 'Loose.md', 'Loose.md', renamed)).toBe('![](Docs/pic.png)')
  })

  it('is a no-op the second time', () => {
    const once = repointFileLinks(text, 'A/N.md', 'B/N.md')
    expect(repointFileLinks(once, 'B/N.md', 'B/N.md')).toBe(once)
  })
})

describe('voiceEmbeds', () => {
  const note = 'Lectures/Week 1.md'

  it('finds both forms, in order, resolved against the note, with the embed as written', () => {
    const text = [
      '# Week 1',
      '<audio controls src="Voice%20note%202026-10-15%2014.32.m4a" data-speed="1.25"></audio>',
      'A photo ![](board.png) and a video <video controls src="clip.mp4"></video>',
      '![](../Imported/memo.mp3)'
    ].join('\n')
    expect(voiceEmbeds(text, note)).toEqual([
      {
        file: 'Lectures/Voice note 2026-10-15 14.32.m4a',
        embed: '<audio controls src="Voice%20note%202026-10-15%2014.32.m4a" data-speed="1.25">'
      },
      { file: 'Imported/memo.mp3', embed: '![](../Imported/memo.mp3)' }
    ])
  })

  it('takes an <audio> tag at its word whatever the extension — a browser recording is .webm', () => {
    expect(voiceEmbeds('<audio controls src="rec.webm"></audio>', note).map((v) => v.file)).toEqual(['Lectures/rec.webm'])
    // …while a markdown picture of a .webm is not a voice note (it is a video)
    expect(voiceEmbeds('![](rec.webm)', note)).toEqual([])
  })

  it('lists a recording used twice once, and nothing for a note without one', () => {
    const twice = '<audio controls src="a.m4a"></audio>\n\n<audio controls src="a.m4a" data-volume="2"></audio>'
    expect(voiceEmbeds(twice, note)).toHaveLength(1)
    expect(voiceEmbeds('# Plain\n\n![](pic.png)', note)).toEqual([])
  })
})
