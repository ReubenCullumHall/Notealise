import { StateField, type EditorState, type Range } from '@codemirror/state'
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view'
import { findTranscript, separatedText, unescapeSpoken } from '../../../shared/transcript'
import { isRaw } from './rawView'
import { recordingPath, voiceNotesIn } from './audioPass'
import { linkEnv } from './linkEnv'
import { jobFor, openExtraFeatures, startTranscribe } from './transcribeUi'

// A voice note's transcript, drawn as part of the voice note (Reuben, 2026-11-05: "it
// automatically extends the audio block … gives the text underneath (up to 10 lines deep, then a
// scroll bar appears, there is a little button in the bottom left that when you hover over it, it
// says 'separate transcript from audio block'"). In the file it is the fold straight under the
// voice note's line (shared/transcript.ts); here those lines are hidden and drawn as one block that
// sits right under the voice note, so the two read as one thing.
//
// A StateField, not a pass: it hides whole lines, and only a field may replace a line break. Raw
// view (Markdown pro) shows the fold as the text it is. The cursor steps over it as one unit
// (atomic), the same as a drawn maths block — the words are changed by Separate, then editing.

/** The accuracy download is in — the "More accurate transcription" line is then not offered.
 *  Asked once, and again when a download ends. */
let accurate: boolean | null = null
function knowAccurate(): void {
  if (typeof window === 'undefined' || !window.api?.accurateStatus) return
  void window.api.accurateStatus().then((s) => (accurate = s.state === 'ready'))
}
knowAccurate()
if (typeof window !== 'undefined' && window.api?.onAccurateProgress) {
  window.api.onAccurateProgress((p) => {
    if (p.received >= p.total) knowAccurate()
  })
}

class TranscriptWidget extends WidgetType {
  constructor(
    readonly paragraphs: string[],
    /** the recording it was made from, as written on the fold */
    readonly madeFrom: string,
    /** the voice note's src now */
    readonly audioSrc: string,
    readonly rel: string | null,
    readonly name: string
  ) {
    super()
  }

  get stale(): boolean {
    return this.madeFrom !== this.audioSrc
  }

  eq(o: TranscriptWidget): boolean {
    return (
      o.madeFrom === this.madeFrom &&
      o.audioSrc === this.audioSrc &&
      o.rel === this.rel &&
      o.name === this.name &&
      o.paragraphs.join('\n\n') === this.paragraphs.join('\n\n')
    )
  }

  toDOM(view: EditorView): HTMLElement {
    const root = document.createElement('div')
    root.className = 'cm-voice-tx'
    root.setAttribute('role', 'group')
    root.setAttribute('aria-label', `Transcript of ${this.name || 'the voice note'}`)

    if (this.stale && this.rel) {
      const line = document.createElement('div')
      line.className = 'cm-voice-tx-stale'
      line.append('Transcribed before the clip was edited · ')
      const again = linkButton('Transcribe again')
      const rel = this.rel
      again.addEventListener('click', () => startTranscribe(view, this.audioSrc, rel, this.name))
      again.disabled = !!jobFor(view.state.field(linkEnv, false)?.path ?? '', this.audioSrc)
      line.appendChild(again)
      root.appendChild(line)
    }

    const text = document.createElement('div')
    text.className = 'cm-voice-tx-text'
    for (const p of this.paragraphs) {
      const el = document.createElement('p')
      el.textContent = unescapeSpoken(p)
      text.appendChild(el)
    }
    root.appendChild(text)

    const foot = document.createElement('div')
    foot.className = 'cm-voice-tx-foot'
    const sep = document.createElement('button')
    sep.type = 'button'
    sep.className = 'cm-voice-tx-separate'
    sep.setAttribute('data-tip', 'Separate transcript from audio block')
    sep.setAttribute('aria-label', 'Separate transcript from audio block')
    sep.innerHTML =
      '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 5h14v9"/><path d="M12 19l-4-4 4-4"/><path d="M8 15h11"/></svg>'
    sep.addEventListener('click', () => separate(view, root))
    foot.appendChild(sep)
    if (accurate === false) {
      const more = linkButton('More accurate transcription…')
      more.classList.add('cm-voice-tx-more')
      more.addEventListener('click', () => openExtraFeatures(view))
      foot.appendChild(more)
    }
    root.appendChild(foot)
    // In a frame the editor measures: the transcript's -36px top margin (tucking it under the
    // voice note) is not something CodeMirror counts, and every line below it drifted
    // (app.css `.cm-block-frame`).
    const frame = document.createElement('div')
    frame.className = 'cm-block-frame'
    frame.appendChild(root)
    return frame
  }

  // Its own clicks (Separate, Transcribe again) and selecting its words to copy them.
  ignoreEvent(): boolean {
    return true
  }
}

function linkButton(label: string): HTMLButtonElement {
  const b = document.createElement('button')
  b.type = 'button'
  b.className = 'cm-voice-tx-link'
  b.textContent = label
  return b
}

/** "Separate transcript from audio block": the fold's lines become the words as ordinary
 *  text, in place — one change, so one Cmd+Z puts the fold back. */
function separate(view: EditorView, dom: HTMLElement): void {
  let pos: number
  try {
    pos = view.posAtDOM(dom)
  } catch {
    return
  }
  const doc = view.state.doc
  const openLine = doc.lineAt(pos).number - 1 // 0-based
  const lines = doc.toString().split('\n')
  const found = findTranscript(lines, openLine - 1)
  if (!found) return
  const from = doc.line(found.open + 1).from
  const to = doc.line(found.close + 1).to
  view.dispatch({
    changes: { from, to, insert: separatedText(found).split('\n').join(view.state.lineBreak) },
    selection: { anchor: from },
    scrollIntoView: true
  })
  view.focus()
}

const OPEN_START = /^<details\s+data-transcript\s*=/i

function build(state: EditorState): DecorationSet {
  if (isRaw(state)) return Decoration.none
  const doc = state.doc
  const notePath = state.field(linkEnv, false)?.path ?? ''
  let lines: string[] | null = null
  const out: Range<Decoration>[] = []
  for (let n = 2; n <= doc.lines; n++) {
    const line = doc.line(n)
    if (!OPEN_START.test(line.text)) continue
    // Only straight under a voice note — anything else is ordinary HTML, left as it is.
    const above = doc.line(n - 1)
    const voice = voiceNotesIn(state, above.from, above.to)[0]
    if (!voice) continue
    lines ??= doc.toString().split('\n')
    const found = findTranscript(lines, n - 2)
    if (!found) continue
    const end = doc.line(found.close + 1)
    out.push(
      Decoration.replace({
        widget: new TranscriptWidget(found.paragraphs, found.src, voice.src, recordingPath(voice.src, notePath), voice.name),
        block: true
      }).range(line.from, end.to)
    )
    n = found.close + 1
  }
  return Decoration.set(out, true)
}

export const transcriptFold = StateField.define<DecorationSet>({
  create: build,
  update(value, tr) {
    // `reconfigured`: Markdown pro switched on or off for this note.
    if (!tr.docChanged && !tr.reconfigured) return value
    return build(tr.state)
  },
  provide: (f) => [EditorView.decorations.from(f), EditorView.atomicRanges.of((view) => view.state.field(f))]
})
