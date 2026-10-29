// The importer bugs found by the 2026-10-27 scan, kept as tests so they stay
// fixed. Each runs a real importer into a real temporary vault.
import { beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { setVaultRoot } from '../vault'
import { notionZipImporter } from './notionZip/run'
import { htmlImporter } from './html/run'
import { markdownImporter } from './markdown/run'

const ID1 = '0123456789abcdef0123456789abcdef'
const ID2 = 'fedcba9876543210fedcba9876543210'
const page = (body: string, title = 'Page'): string =>
  `<!doctype html><html><head><title>${title}</title></head><body><article><div class="page-body">${body}</div></article></body></html>`

let vault = ''
let src = ''
beforeEach(() => {
  vault = mkdtempSync(path.join(os.tmpdir(), 'bugscan-vault-'))
  src = mkdtempSync(path.join(os.tmpdir(), 'bugscan-src-'))
  setVaultRoot(vault)
})

/** Every file in the vault (minus .mdnotes), path → text. */
function dump(dir = vault, rel = ''): Record<string, string> {
  const out: Record<string, string> = {}
  for (const name of readdirSync(dir)) {
    if (name === '.mdnotes') continue
    const abs = path.join(dir, name)
    const r = rel ? `${rel}/${name}` : name
    if (statSync(abs).isDirectory()) Object.assign(out, dump(abs, r))
    else out[r] = readFileSync(abs, 'utf8')
  }
  return out
}

describe('Notion import', () => {
  it('two pages each with an image.png keep their own pictures', async () => {
    writeFileSync(path.join(src, `Page A ${ID1}.html`), page('<p>A</p><img src="Page%20A/image.png">'))
    writeFileSync(path.join(src, `Page B ${ID2}.html`), page('<p>B</p><img src="Page%20B/image.png">'))
    mkdirSync(path.join(src, 'Page A'))
    mkdirSync(path.join(src, 'Page B'))
    writeFileSync(path.join(src, 'Page A', 'image.png'), 'PICTURE-OF-A')
    writeFileSync(path.join(src, 'Page B', 'image.png'), 'PICTURE-OF-B')
    await notionZipImporter.run([src], 'N', () => {})
    const files = dump()
    const pictures = Object.entries(files).filter(([p]) => p.endsWith('.png')).map(([, t]) => t).sort()
    expect(pictures).toEqual(['PICTURE-OF-A', 'PICTURE-OF-B'])
    const linkOf = (note: string): string => /!\[\]\(([^)]+)\)/.exec(files[note])![1]
    expect(linkOf('N/Page A.md')).not.toBe(linkOf('N/Page B.md'))
  })

  it('a stray % in a link does not stop the import or empty the notes', async () => {
    writeFileSync(path.join(src, `Good ${ID1}.html`), page('<p>good content here</p>'))
    writeFileSync(path.join(src, `Bad ${ID2}.html`), page('<p>Read <a href="http://www.example.fr/caf%E9.html">this</a></p>'))
    await notionZipImporter.run([src], 'N', () => {})
    const files = dump()
    expect(files['N/Good.md']).toContain('good content here')
    expect(files['N/Bad.md']).toContain('Read')
  })

  it('table cells keep pictures, links, bold and line breaks', async () => {
    writeFileSync(
      path.join(src, `T ${ID1}.html`),
      page(`<table><tbody>
<tr><td>Name</td><td>Notes</td></tr>
<tr><td><strong>Bold</strong> <a href="https://x.com">link</a></td><td><p>Line one</p><p>Line two</p></td></tr>
<tr><td>Pic</td><td><img src="T/pic.png"></td></tr>
<tr><td>Br</td><td>first<br>second</td></tr>
</tbody></table>`)
    )
    mkdirSync(path.join(src, 'T'))
    writeFileSync(path.join(src, 'T', 'pic.png'), 'PIC')
    await notionZipImporter.run([src], 'N', () => {})
    const t = dump()['N/T.md']
    expect(t).toContain('**Bold**')
    expect(t).toContain('[link](https://x.com)')
    expect(t).toContain('Line one<br>Line two')
    expect(t).toContain('first<br>second')
    expect(t).toMatch(/!\[\]\(pic\.png\)/)
  })

  it('brackets in a file name and $\' in link text survive', async () => {
    writeFileSync(
      path.join(src, `P ${ID1}.html`),
      page('<p>x</p><img src="P/photo%20(1).png" alt="photo"><p><a href="P/doc.pdf">Prices $\' list</a></p>')
    )
    mkdirSync(path.join(src, 'P'))
    writeFileSync(path.join(src, 'P', 'photo (1).png'), 'PHOTO')
    writeFileSync(path.join(src, 'P', 'doc.pdf'), 'PDF')
    const res = await notionZipImporter.run([src], 'N', () => {})
    const files = dump()
    expect(files['N/photo (1).png']).toBe('PHOTO')
    expect(files['N/P.md']).toContain('![photo](photo%20%281%29.png)')
    expect(files['N/P.md']).toContain("[Prices $' list](doc.pdf)")
    expect(res.lossy).toEqual([])
  })

  it('a mailto: link is not reported as a file that could not be copied', async () => {
    writeFileSync(path.join(src, `M ${ID1}.html`), page('<p><a href="mailto:me@example.com">mail me</a></p>'))
    const res = await notionZipImporter.run([src], 'N', () => {})
    expect(res.lossy).toEqual([])
  })
})

describe('HTML import', () => {
  it('two pages sharing image001.png keep their own pictures', async () => {
    for (const [n, pic] of [['one', 'ONE-PIC'], ['two', 'TWO-PIC']]) {
      mkdirSync(path.join(src, `${n}_files`))
      writeFileSync(path.join(src, `${n}_files`, 'image001.png'), pic)
      writeFileSync(path.join(src, `${n}.html`), page(`<p>${n}</p><img src="${n}_files/image001.png">`, n))
    }
    await htmlImporter.run([src], 'H', () => {})
    const pictures = Object.entries(dump()).filter(([p]) => p.endsWith('.png')).map(([, t]) => t).sort()
    expect(pictures).toEqual(['ONE-PIC', 'TWO-PIC'])
  })

  it('a page title keeps its real characters, not &amp; codes', async () => {
    writeFileSync(path.join(src, 'qa.html'), page('<p>hi</p>', 'Q&amp;A &#8211; Tom&#39;s notes'))
    await htmlImporter.run([src], 'H', () => {})
    expect(Object.keys(dump())).toContain('H/Q&A – Tom\'s notes.md')
  })
})

describe('Markdown / Obsidian import', () => {
  it('brings recordings, videos, .heic and documents too, and turns ![[pic.png]] into a picture', async () => {
    writeFileSync(path.join(src, 'Trip.md'), 'Look: ![[keep.png]] and ![[memo.m4a|300]] and ![[clip.mp4]] and ![[plan.docx]]\n')
    for (const f of ['keep.png', 'memo.m4a', 'clip.mp4', 'photo.heic', 'plan.docx']) writeFileSync(path.join(src, f), f)
    await markdownImporter.run([src], 'M', () => {})
    const files = dump()
    for (const f of ['keep.png', 'memo.m4a', 'clip.mp4', 'photo.heic', 'plan.docx']) expect(files[`M/${f}`]).toBe(f)
    expect(files['M/Trip.md']).toBe(
      'Look: ![](keep.png) and ![](memo.m4a) and <video controls src="clip.mp4"></video> and [plan.docx](plan.docx)\n'
    )
  })

  it('leaves an embed it cannot find exactly as written', async () => {
    writeFileSync(path.join(src, 'Note.md'), 'See ![[missing.png]] and [[Other note]]\n')
    await markdownImporter.run([src], 'M', () => {})
    expect(dump()['M/Note.md']).toBe('See ![[missing.png]] and [[Other note]]\n')
  })
})
