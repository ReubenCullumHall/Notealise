import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { syntaxTree, ensureSyntaxTree } from '@codemirror/language'
import { linkAt, textFor } from './pasteLink'

describe('what a pasted address is written as', () => {
  const url = 'https://example.com/wiki/Wave_(physics)?a=1'

  it('writes the three forms as plain Markdown', () => {
    expect(textFor('link', { url, title: 'Waves' })).toBe(url)
    expect(textFor('title', { url: 'https://a.example/x', title: 'Waves' })).toBe('[Waves](https://a.example/x)')
    expect(textFor('video', { url: 'https://youtu.be/dQw4w9WgXcQ', title: 'Waves' })).toBe('![Waves](https://youtu.be/dQw4w9WgXcQ)')
  })

  it('keeps parentheses in an address from ending the link early', () => {
    expect(textFor('title', { url, title: 'Wave' })).toBe('[Wave](https://example.com/wiki/Wave_%28physics%29?a=1)')
  })

  it('falls back to the address as the label, and to an empty label for a video', () => {
    expect(textFor('title', { url: 'https://a.example/x', title: null })).toBe('[https://a.example/x](https://a.example/x)')
    expect(textFor('video', { url: 'https://youtu.be/dQw4w9WgXcQ', title: null })).toBe('![](https://youtu.be/dQw4w9WgXcQ)')
  })

  it('writes something the editor itself reads back as a link / an image', () => {
    const state = (doc: string): EditorState => EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage })] })
    for (const [form, node] of [['title', 'Link'], ['video', 'Image']] as const) {
      const doc = textFor(form, { url, title: 'Wave' })
      const s = state(doc)
      ensureSyntaxTree(s, doc.length, 5000)
      const names: string[] = []
      syntaxTree(s).iterate({ enter: (n) => void names.push(n.name) })
      expect(names, doc).toContain(node)
    }
  })
})

describe('which web link is under a right-click', () => {
  const at = (doc: string, needle: string): ReturnType<typeof linkAt> => {
    const s = EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage })] })
    ensureSyntaxTree(s, doc.length, 5000)
    return linkAt(s, doc.indexOf(needle) + 1)
  }
  const yt = 'https://youtu.be/dQw4w9WgXcQ'

  it('reads each way a web address can be written, and what form it is in', () => {
    expect(at(`See [How waves work](${yt}) now`, 'How')).toMatchObject({ url: yt, title: 'How waves work', form: 'title' })
    expect(at(`See ${yt} now`, 'youtu')).toMatchObject({ url: yt, title: null, form: 'link' })
    expect(at(`See <${yt}> now`, 'youtu')).toMatchObject({ url: yt, form: 'link' })
    expect(at(`![How waves work](${yt})`, 'How')).toMatchObject({ url: yt, title: 'How waves work', form: 'video' })
  })

  it('hands back the whole thing to rewrite, brackets and all', () => {
    const doc = `A [Title](${yt}) b`
    const r = at(doc, 'Title')!
    expect(doc.slice(r.from, r.to)).toBe(`[Title](${yt})`)
    const b = at(`x ${yt} y`, 'youtu')!
    expect(`x ${yt} y`.slice(b.from, b.to)).toBe(yt)
  })

  it('treats a label that is just the address as no title', () => {
    expect(at(`[${yt}](${yt})`, 'youtu')).toMatchObject({ title: null, form: 'title' })
  })

  it('is null for anything that is not a web link', () => {
    expect(at('![](photo.png)', 'photo')).toBeNull()
    expect(at('[Slides.pdf](Slides.pdf)', 'Slides')).toBeNull()
    expect(at('[note](Other.md)', 'note')).toBeNull()
    expect(at('![a photo](https://example.com/p.png)', 'photo')).toBeNull()
    expect(at('just words', 'words')).toBeNull()
  })
})
