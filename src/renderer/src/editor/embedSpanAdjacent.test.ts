// A grip asks "which embed is at this position?" (attachSelect.ts embedSpanAt). Two embeds written
// touching share a position — the first's end is the second's start — and the second's grip must
// still select the second (2026-11-07: a take's six dots ringed its master voice note).
import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { embedSpanAt } from './attachSelect'

const M = '<audio controls src="a.m4a"></audio>'
const K = '<audio controls src="b.m4a" data-name="Take 1"></audio>'

describe('embedSpanAt with two embeds touching', () => {
  const doc = 'text\n\n' + M + K + '\n'
  const state = EditorState.create({ doc })
  const mFrom = doc.indexOf(M)
  const kFrom = mFrom + M.length
  it('the second one’s grip (its start, which is also the first’s end) picks the second', () => {
    expect(embedSpanAt(state, kFrom)).toEqual({ from: kFrom, to: kFrom + K.length })
  })
  it('the first one’s grip still picks the first', () => {
    expect(embedSpanAt(state, mFrom)).toEqual({ from: mFrom, to: mFrom + M.length })
  })
  it('a voice note alone on its line is unchanged', () => {
    const s = EditorState.create({ doc: M + '\n' })
    expect(embedSpanAt(s, 0)).toEqual({ from: 0, to: M.length })
    expect(embedSpanAt(s, 5)).toEqual({ from: 0, to: M.length })
  })
})
