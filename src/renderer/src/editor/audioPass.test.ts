import { describe, expect, it } from 'vitest'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { ensureSyntaxTree } from '@codemirror/language'
import { EditorState, type ChangeSpec } from '@codemirror/state'
import { toggleMarkdown } from './toggleModel'
import { isVoiceTarget, nameChange, retargetChange, settingsChange, voiceNotesIn, voiceSpanAt } from './audioPass'
import { selectionIsEmbed, embedSpanAt, attachmentFileOf } from './attachSelect'
import { VOICE_DEFAULTS } from '../../../shared/voiceNote'

// Which text is a voice note, and what writing a setting or a new file onto it
// does to the line — against the real markdown parser the editor uses
// (extensions.ts), not a guess about its tree. The block itself needs a DOM;
// everything that decides WHAT is drawn and WHAT is written does not.

function stateOf(doc: string): EditorState {
  const state = EditorState.create({
    doc,
    extensions: [markdown({ base: markdownLanguage, extensions: [toggleMarkdown] })]
  })
  ensureSyntaxTree(state, doc.length, 5000)
  return state
}

const notes = (doc: string) => {
  const state = stateOf(doc)
  return voiceNotesIn(state, 0, doc.length).map((n) => ({ ...n, text: doc.slice(n.from, n.to) }))
}

/** Apply one change and return the document. */
const apply = (doc: string, change: ChangeSpec | null): string =>
  change ? EditorState.create({ doc }).update({ changes: change }).state.doc.toString() : doc

describe('finding voice notes', () => {
  it('finds the line the app writes, with its settings', () => {
    const doc = 'Intro\n\n<audio controls src="memo%201.m4a" data-speed="1.25"></audio>\n\nAfter'
    const [n, ...rest] = notes(doc)
    expect(rest).toEqual([])
    expect(n.text).toBe('<audio controls src="memo%201.m4a" data-speed="1.25"></audio>')
    expect(n.form).toBe('tag')
    expect(n.src).toBe('memo%201.m4a')
    expect(n.settings).toEqual({ volume: 1, tone: 0, speed: 1.25 })
    expect(doc.slice(n.from, n.openTo)).toBe('<audio controls src="memo%201.m4a" data-speed="1.25">')
  })

  it('finds a recording written as a picture — what imported notes carry', () => {
    const [n] = notes('Notes\n\n![](memo.mp3)\n')
    expect(n).toMatchObject({ form: 'md', src: 'memo.mp3', text: '![](memo.mp3)', settings: VOICE_DEFAULTS })
    // the `<…>` destination and a title are both markdown, not part of the target
    const [m] = notes('![a memo](<my memo.M4A> "Monday")')
    expect(m.src).toBe('my memo.M4A')
  })

  it('leaves real pictures, and videos, to their own passes', () => {
    expect(notes('![](photo.png)\n\n<video controls src="clip.mp4"></video>\n\n![](clip.webm)')).toEqual([])
  })

  it('claims exactly what imagePass skips — the two may never both draw one embed', () => {
    for (const target of ['memo.m4a', 'a%20b.mp3', '<my memo.wav>', 'x.OGG', 'r.opus', 'v.qta'])
      expect(isVoiceTarget(target)).toBe(true)
    for (const target of ['photo.png', 'clip.mp4', 'rec.webm', 'notes.md', 'https://x.test/a.mp3?dl=1', ''])
      expect(isVoiceTarget(target)).toBe(false)
  })

  it('does not take a pair that crosses a line — a plugin may not replace a line break', () => {
    expect(notes('para <audio src="x.mp3">\nnext</audio>')).toEqual([])
    // and a multi-line one is an HTML block to the parser, with no tags to find
    expect(notes('<audio controls src="memo.m4a">\n</audio>')).toEqual([])
  })

  it('does not take a pair with something between the tags, or a player with nothing to play', () => {
    expect(notes('<audio src="x.mp3">fallback</audio>')).toEqual([])
    expect(notes('<audio controls></audio>')).toEqual([])
  })

  it('finds one inside a list item, and two on one line', () => {
    expect(notes('- <audio controls src="a.m4a"></audio>').map((n) => n.src)).toEqual(['a.m4a'])
    const two = notes('<audio src="a.m4a"></audio><audio src="b.m4a"></audio>')
    expect(two.map((n) => n.src)).toEqual(['a.m4a', 'b.m4a'])
  })

  it('knows which one a block means by where it starts, even back to back', () => {
    const doc = '<audio src="a.m4a"></audio><audio src="b.m4a"></audio>'
    const state = stateOf(doc)
    const second = doc.indexOf('<audio src="b')
    // the second block's own position is the first one's end — it must still get the second
    expect(voiceSpanAt(state, second)?.src).toBe('b.m4a')
    expect(voiceSpanAt(state, 0)?.src).toBe('a.m4a')
    expect(voiceSpanAt(state, 5)?.src).toBe('a.m4a')
  })
})

describe('writing the mixer onto the line', () => {
  const tag = '<audio controls src="memo.m4a"></audio>'

  it('writes only what differs from the defaults, into the open tag', () => {
    const doc = `Notes\n${tag}\n`
    const [n] = voiceNotesIn(stateOf(doc), 0, doc.length)
    const out = apply(doc, settingsChange(stateOf(doc).doc, n, { volume: 1.5, tone: 0, speed: 1 }))
    expect(out).toBe('Notes\n<audio controls src="memo.m4a" data-volume="1.5"></audio>\n')
  })

  it('goes back to the plain tag on Reset, and writes nothing when nothing changed', () => {
    const doc = '<audio controls src="memo.m4a" data-tone="-0.3" data-speed="2"></audio>'
    const state = stateOf(doc)
    const [n] = voiceNotesIn(state, 0, doc.length)
    expect(apply(doc, settingsChange(state.doc, n, VOICE_DEFAULTS))).toBe(tag)
    expect(settingsChange(state.doc, n, { volume: 1, tone: -0.3, speed: 2 })).toBeNull()
  })

  it('keeps every other attribute where it was — a hand-written tag stays hand-written', () => {
    const doc = `<audio preload="none" src='memo.m4a' data-volume="2" class="x"></audio>`
    const state = stateOf(doc)
    const [n] = voiceNotesIn(state, 0, doc.length)
    expect(apply(doc, settingsChange(state.doc, n, { volume: 1, tone: 0.4, speed: 1 }))).toBe(
      `<audio preload="none" src='memo.m4a' class="x" data-tone="0.4"></audio>`
    )
  })

  it('turns a markdown recording into the tag, target kept character for character', () => {
    const doc = 'Before\n\n![old alt](Voice%20memo%20%282%29.m4a "t")\n'
    const state = stateOf(doc)
    const [n] = voiceNotesIn(state, 0, doc.length)
    expect(apply(doc, settingsChange(state.doc, n, { volume: 1, tone: 0, speed: 1.5 }))).toBe(
      'Before\n\n<audio controls src="Voice%20memo%20%282%29.m4a" data-speed="1.5"></audio>\n'
    )
    // defaults: `![](…)` already plays with them — leave the line alone
    expect(settingsChange(state.doc, n, VOICE_DEFAULTS)).toBeNull()
  })

  it('never lets a target end the attribute early', () => {
    const doc = '![](say"hi".m4a)'
    const state = stateOf(doc)
    const [n] = voiceNotesIn(state, 0, doc.length)
    expect(apply(doc, settingsChange(state.doc, n, { volume: 2, tone: 0, speed: 1 }))).toBe(
      '<audio controls src="say%22hi%22.m4a" data-volume="2"></audio>'
    )
  })

  it('round-trips: what it writes is found again with the same settings', () => {
    const doc = '![](memo.m4a)'
    const state = stateOf(doc)
    const [n] = voiceNotesIn(state, 0, doc.length)
    const s = { volume: 0.75, tone: 0.35, speed: 2.5 }
    const next = apply(doc, settingsChange(state.doc, n, s))
    const [back] = voiceNotesIn(stateOf(next), 0, next.length)
    expect(back.settings).toEqual(s)
    expect(back.src).toBe('memo.m4a')
  })
})

describe('pointing a voice note at its playable copy', () => {
  it('swaps the src and keeps the settings', () => {
    const doc = '<audio controls src="Lecture.wma" data-speed="1.5"></audio>'
    const state = stateOf(doc)
    const [n] = voiceNotesIn(state, 0, doc.length)
    expect(apply(doc, retargetChange(state.doc, n, 'Lecture.m4a'))).toBe(
      '<audio controls src="Lecture.m4a" data-speed="1.5"></audio>'
    )
  })

  it('swaps only the destination of a markdown one — alt text and title stay', () => {
    const doc = '![Monday](<Memo one.amr> "From my phone")'
    const state = stateOf(doc)
    const [n] = voiceNotesIn(state, 0, doc.length)
    expect(apply(doc, retargetChange(state.doc, n, 'Memo%20one.m4a'))).toBe('![Monday](Memo%20one.m4a "From my phone")')
  })
})

describe('the grip treats a voice note as one embed', () => {
  const doc = 'Notes\n<audio controls src="memo.m4a" data-volume="1.5"></audio>\nMore'
  const from = doc.indexOf('<audio')
  const to = doc.indexOf('</audio>') + '</audio>'.length

  it('selects exactly the block’s range', () => {
    const state = stateOf(doc)
    expect(embedSpanAt(state, from)).toEqual({ from, to })
    expect(voiceSpanAt(state, from)).toMatchObject({ from, to })
  })

  it('knows a selection of it is an embed, not text', () => {
    const state = EditorState.create({ doc, selection: { anchor: from, head: to } })
    expect(selectionIsEmbed(state)).toBe(true)
  })

  it('bins the recording, not anything else, when it is deleted', () => {
    expect(attachmentFileOf('<audio controls src="memo%201.m4a" data-speed="2"></audio>', 'Space/Note.md')).toBe(
      'Space/memo 1.m4a'
    )
    expect(attachmentFileOf('![](memo.mp3)', 'Note.md')).toBe('memo.mp3')
    expect(attachmentFileOf('<audio controls src="Other note.md"></audio>', 'Note.md')).toBeNull()
  })
})

describe('undo after naming a voice note and then moving its mixer (bug scan 2026-10-27)', () => {
  it('takes the name back and leaves the mixer setting, with no second tag', async () => {
    const { Transaction } = await import('@codemirror/state')
    const { history, undo } = await import('@codemirror/commands')
    const doc = '<audio controls src="memo.m4a"></audio>\n'
    let state = EditorState.create({ doc, extensions: [history(), markdown({ base: markdownLanguage, extensions: [toggleMarkdown] })] })
    const span = () => {
      ensureSyntaxTree(state, state.doc.length, 5000)
      return voiceNotesIn(state, 0, state.doc.length)[0]
    }
    state = state.update({ changes: nameChange(state.doc, span(), 'Lecture')! }).state
    const vol = settingsChange(state.doc, span(), { ...VOICE_DEFAULTS, volume: 1.1 })!
    state = state.update({ changes: vol, annotations: Transaction.addToHistory.of(false) }).state
    let after = state
    undo({ state, dispatch: (tr) => (after = tr.state) })
    const text = after.doc.toString()
    expect(text.match(/<audio/g)?.length).toBe(1)
    expect(text).not.toContain('data-name')
    expect(text).toContain('data-volume="1.1"')
  })
})
