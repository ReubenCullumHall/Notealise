// Transcribe, from the voice note: starting one, what the block shows while it works, and putting
// the words into the note when it ends (docs/plans/transcribe.md).
//
// A transcription belongs to a RECORDING in a NOTE, not to the block on screen: blocks are
// redrawn as you scroll and type, and you can switch notes while it works. So the running jobs
// live here, keyed by note + recording, and a block drawn for one shows its progress. When it ends
// the words go into an editor showing that note — or, if none is, wait until one does (the same
// way a recording made in another note lands, voiceRecorder.ts).

import type { EditorView } from '@codemirror/view'
import { placeTranscript } from '../../../shared/transcript'
import type { TranscribeProgress } from '../../../shared/types'
import { linkHandlersFacet, notifyUser } from './linkEnv'
import { transcribeRecording, type TranscribeOutcome } from './transcribeRun'
import { voiceNotesIn } from './audioPass'
import { notePathOf, onNoteShown, viewsShowing } from './viewRegistry'

export interface TranscribeJob {
  notePath: string
  src: string
  rel: string
  name: string
  progress: Omit<TranscribeProgress, 'job'>
  cancel(): void
}

const jobs = new Map<string, TranscribeJob>()
const listeners = new Set<() => void>()
const keyOf = (notePath: string, src: string): string => `${notePath}\u0000${src}`

/** The job for this recording in this note, if one is running. */
export function jobFor(notePath: string, src: string): TranscribeJob | undefined {
  return jobs.get(keyOf(notePath, src))
}

/** Be told whenever any job starts, moves on or ends. Returns the way to stop. */
export function onJobs(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
const changed = (): void => listeners.forEach((fn) => fn())

/** Words waiting for their note to be on screen. */
const waiting = new Map<string, { src: string; paragraphs: string[]; name: string }[]>()
let watching = false

/** Start transcribing the voice note `src` (resolving to `rel`) in the note `view` shows. */
export function startTranscribe(view: EditorView, src: string, rel: string, name: string): void {
  const notePath = notePathOf(view)
  if (jobs.has(keyOf(notePath, src))) return
  // The job object itself is what the callbacks hold: its note can be renamed while it runs
  // (transcribeNoteMoved re-keys it), so it is never looked up by its old key.
  const job: TranscribeJob = { notePath, src, rel, name, progress: { percent: 0, etaMs: null, waiting: 0 }, cancel: () => {} }
  const run = transcribeRecording(rel, (p) => {
    job.progress = p
    changed()
  })
  job.cancel = run.cancel
  jobs.set(keyOf(notePath, src), job)
  changed()
  void run.done.then((r) => {
    for (const [k, j] of jobs) if (j === job) jobs.delete(k)
    changed()
    finished(view, job.notePath, src, name, r)
  })
}

/** The words a person reads when it didn't work (docs/voice.md: plain, what to do next). */
function failure(r: Exclude<TranscribeOutcome, { ok: true }>, title: string): string | null {
  switch (r.reason) {
    case 'cancelled':
      return null
    case 'empty':
      return `No words were heard in ${title}.`
    case 'unreadable':
      return `${title} can’t be read, so it can’t be transcribed.`
    case 'too-long':
      return `${title} is over two hours long — too long to transcribe.`
    case 'unavailable':
      return 'Transcribe isn’t part of this copy of the app.'
    default:
      return `Transcribing ${title} didn’t finish. Try again.`
  }
}

function finished(started: EditorView, notePath: string, src: string, name: string, r: TranscribeOutcome): void {
  const title = name || 'the voice note'
  const on = viewsShowing(notePath)[0] ?? (started.dom.isConnected ? started : null)
  if (!r.ok) {
    const msg = failure(r, title)
    if (msg) notifyUser((on ?? started).state, msg)
    return
  }
  const item = { src, paragraphs: r.paragraphs, name }
  if (on && notePathOf(on) === notePath && put(on, item)) return
  // Not on screen: it goes in when the note is next shown.
  const list = waiting.get(notePath) ?? []
  list.push(item)
  waiting.set(notePath, list)
  if (!watching) {
    watching = true
    // Inside CodeMirror's update: note the view, act once the update is over.
    onNoteShown((view) => {
      if (waiting.has(notePathOf(view))) queueMicrotask(() => void putWaiting(view))
    })
  }
  notifyUser(started.state, `${title} is transcribed — the words go in when you open its note.`)
}

/** The words go under the voice note with this src, as one change (one Cmd+Z takes them back
 *  out). False when the voice note isn't in this note any more. */
function put(view: EditorView, item: { src: string; paragraphs: string[] }): boolean {
  const state = view.state
  const voice = voiceNotesIn(state, 0, state.doc.length).find((v) => v.src === item.src)
  if (!voice) return false
  const lines = state.doc.toString().split('\n')
  const audioLine = state.doc.lineAt(voice.from).number - 1
  const p = placeTranscript(lines, audioLine, item.src, item.paragraphs)
  const doc = state.doc
  const nl = state.lineBreak
  if (p.from === p.to) {
    // Insert after the voice note's own line.
    const at = doc.line(audioLine + 1).to
    view.dispatch({ changes: { from: at, insert: nl + p.lines.join(nl) } })
  } else {
    const from = doc.line(p.from + 1).from
    const to = doc.line(p.to).to
    view.dispatch({ changes: { from, to, insert: p.lines.join(nl) } })
  }
  return true
}

/** Words that waited for their note: put in once the editor really holds it (not the empty
 *  stand-in a pane shows before the text arrives — voiceRecorder.ts `addWaiting`). */
async function putWaiting(view: EditorView): Promise<void> {
  const path = notePathOf(view)
  const list = waiting.get(path)
  if (!path || !list?.length) return
  const before = view.state.doc.toString()
  const handlers = view.state.facet(linkHandlersFacet)?.current
  const truth = (handlers ? await handlers.readNote(path) : before).replace(/\r\n?/g, '\n')
  if (!view.dom.isConnected || notePathOf(view) !== path) return
  if (view.state.doc.toString() !== before || truth !== before) return
  waiting.delete(path)
  const left = list.filter((item) => !put(view, item))
  if (left.length) notifyUser(view.state, `${left[0].name || 'A voice note'} isn’t in this note any more, so its words weren’t added.`)
}

/** A note renamed or moved (App's remapOpen, like voiceNoteMoved): running and waiting
 *  transcriptions follow it. */
export function transcribeNoteMoved(from: string, to: string): void {
  const remap = (p: string): string => (p === from ? to : p.startsWith(from + '/') ? to + p.slice(from.length) : p)
  for (const [k, j] of [...jobs]) {
    const n = remap(j.notePath)
    if (n === j.notePath) continue
    jobs.delete(k)
    j.notePath = n
    jobs.set(keyOf(n, j.src), j)
  }
  for (const [p, list] of [...waiting]) {
    const n = remap(p)
    if (n === p) continue
    waiting.delete(p)
    waiting.set(n, [...(waiting.get(n) ?? []), ...list])
  }
  changed()
}

/** Open Settings at Extra features (the "More accurate transcription" line). */
export function openExtraFeatures(view: EditorView): void {
  view.state.facet(linkHandlersFacet)?.current?.openSettings?.('extras')
}
