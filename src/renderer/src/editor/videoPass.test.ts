import { describe, expect, it } from 'vitest'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { ensureSyntaxTree } from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { toggleMarkdown } from './toggleModel'
import { videoPass } from './videoPass'

// What videoPass decides to draw as a player, against the real markdown parser.
// The pass only reads `state` and `visibleRanges` from the view, so a stand-in
// view is enough to run it without a DOM.

function drawn(doc: string): { from: number; to: number }[] {
  const state = EditorState.create({
    doc,
    extensions: [markdown({ base: markdownLanguage, extensions: [toggleMarkdown] })]
  })
  ensureSyntaxTree(state, doc.length, 5000)
  const view = { state, visibleRanges: [{ from: 0, to: doc.length }] } as unknown as EditorView
  const out: { from: number; to: number }[] = []
  videoPass(view, new Set(), (from, to) => out.push({ from, to }))
  return out
}

describe('videoPass', () => {
  it('draws a player for the pair on one line', () => {
    const doc = 'Intro\n\n<video controls src="clip.mp4"></video>\n\nAfter'
    const [p, ...rest] = drawn(doc)
    expect(rest).toEqual([])
    expect(doc.slice(p.from, p.to)).toBe('<video controls src="clip.mp4"></video>')
  })

  it('leaves a pair split across two lines as text — a plugin may not replace a line break', () => {
    // Found 2026-10-14: this made the whole editing area stop working.
    expect(drawn('<video controls src="clip.mp4">\n</video>')).toEqual([])
    expect(drawn('a <video controls src="clip.mp4">\nmore text</video>')).toEqual([])
  })
})
