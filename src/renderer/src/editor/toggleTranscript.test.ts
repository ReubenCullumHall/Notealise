// A voice note's transcript fold inside a toggle list must not end the toggle (toggleModel.ts).
import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { markdown } from '@codemirror/lang-markdown'
import { ensureSyntaxTree } from '@codemirror/language'
import { findToggles, toggleMarkdown } from './toggleModel'
import { transcriptBlock } from '../../../shared/transcript'

const stateOf = (doc: string): EditorState => {
  const s = EditorState.create({ doc, extensions: [markdown({ extensions: [toggleMarkdown] })] })
  ensureSyntaxTree(s, s.doc.length, 5000)
  return s
}

describe('a transcript inside a toggle list', () => {
  it('the toggle still ends at ITS </details>, not the transcript\u2019s', () => {
    const doc = [
      '<details open><summary>Lectures</summary>',
      '',
      '<audio controls src="a.m4a"></audio>',
      ...transcriptBlock('a.m4a', ['Hello there.']).split('\n'),
      'still inside the toggle',
      '',
      '</details>',
      '',
      'after'
    ].join('\n')
    const s = stateOf(doc)
    const t = findToggles(s)
    expect(t.length).toBe(1)
    expect(s.doc.line(t[0].endLine).text).toBe('</details>')
    expect(t[0].endLine).toBe(doc.split('\n').indexOf('</details>', 9) + 1)
  })
  it('a transcript on its own makes no toggle', () => {
    const s = stateOf(['<audio controls src="a.m4a"></audio>', ...transcriptBlock('a.m4a', ['x']).split('\n')].join('\n'))
    expect(findToggles(s)).toEqual([])
  })
})
