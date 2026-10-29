import { StateEffect, StateField, type Extension } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, WidgetType, type ViewUpdate } from '@codemirror/view'
import { dirName, titleOf } from '../../../shared/links'
import { encodeTarget } from '../../../shared/attachments'
import { audioTag, voiceFileName } from '../../../shared/voiceNote'
import type { MicAccess } from '../../../shared/types'
import { linkEnv, linkHandlersFacet, notifyError, notifyUser } from './linkEnv'
import { notePathOf, onNoteShown, viewsShowing } from './viewRegistry'
import { motionOn } from '../tabs/tabStyles'
import { liveStart, stripAt, LIVE_SECONDS } from './voiceMixer'
import { BARS, MIN_BAR } from './voiceWave'
import {
  addedAtEnd,
  addedWhenOpened,
  baseNameOf,
  blockPlacement,
  chooseRecording,
  endInsert,
  extForRecordedMime,
  formatElapsed,
  micAccessMessage,
  platformOf,
  recorderErrorMessage,
  recordingInsert,
  shouldConfirmDiscard,
  type RecorderPlan
} from './voiceRecModel'

// `/voice`: record a voice note straight into the note, where the cursor is.
//
// The command opens a panel in the note, where the voice note will go, with a
// Start recording button (Reuben, 2026-10-14 — it used to start at once). The
// microphone is only asked for, and only opened, when that is pressed. While it
// records, the panel shows the voice as it comes in: bars filling from the left
// across the last 30 seconds, then sliding left as it carries on (the player
// shows the whole length once it is saved); beside them a red dot, the time,
// Pause / Stop / Discard. Stop saves the recording beside the note, like a pasted
// photo, and writes the one line a voice note is (shared/voiceNote.ts) in the
// block's place. The block itself is never text: nothing is written into the
// note until there is a file for the line to point at, so a crash mid-recording
// can't leave a dangling player behind.
//
// Never losing what was said is the rule everything else bends to:
//   • switching the note this editor shows, or closing it, STOPS AND SAVES —
//     and the recording still ends up IN its note: at the end of it, in any
//     editor showing it, or the moment one does (`addToItsNote`);
//   • quitting saves too — App's before-quit flush waits for `flushRecordings`,
//     which also writes any such line still waiting straight into its file;
//   • a save that fails keeps the sound in memory and offers Try again;
//   • Escape does nothing here at all, and Discard asks first once there is
//     more than a few seconds to lose;
//   • AAC is only asked for where the format lab saw it work (a 44.1 or 48 kHz
//     microphone, 64 kbps — `chooseRecording`); a Bluetooth headset's 16/24 kHz
//     goes straight to Opus. And if AAC refuses anyway, an Opus recorder that has
//     been running alongside it since the first moment takes over.
//
// One recording at a time across the whole app — there is one microphone — so
// the live one is module state, and a second `/voice` just shows you it.

/** MediaRecorder hands over what it has once a second, so a recording is in
 *  memory in pieces as it goes rather than all at once on Stop. */
const TIMESLICE_MS = 1000
/** How long a recorder gets to hand over its first sound before it is taken
 *  to have failed: AAC's Opus understudy (`chooseRecording`) takes over, or, with
 *  none, the recording stops and says so. The first piece is due after one
 *  timeslice; the format lab saw it at about 0.3 s (250 ms slices) and 1 s. */
const PROBATION_MS = 3000
/** The most a quitting app waits for a recording to be saved. Main gives the
 *  whole before-quit flush 1.5 s (main/index.ts), and the note itself still has
 *  to be written after this. */
const QUIT_BUDGET_MS = 1100
/** One bar of the live waveform, in seconds: the last 30 seconds across the
 *  same number of bars the player draws, so a short recording's bars are the
 *  player's bars. */
const LIVE_SLOT = LIVE_SECONDS / BARS

const UNEXPECTED_STOP = 'Recording stopped unexpectedly — saving what was recorded.'

// --- where the block is ------------------------------------------------------------

interface RecorderSpot {
  id: number
  /** where the voice note's line goes, mapped through every edit — the same
   *  idea as attachInput's targets: a number captured before an await is not a
   *  position by the time the await is over */
  pos: number
  /** the note the recording belongs to. The view outlives the note in it
   *  (CodeEditor swaps documents in place), so a position alone can't tell a
   *  different note from the same one — see attachInput's insertAtTarget. */
  notePath: string
}

const showRecorder = StateEffect.define<RecorderSpot>()
const hideRecorder = StateEffect.define<number>()
/** The note being recorded into was renamed or moved: the block goes with it. */
const recorderMoved = StateEffect.define<{ from: string; to: string }>()

const recorderSpot = StateField.define<RecorderSpot | null>({
  create: () => null,
  update(spot, tr) {
    if (spot && tr.docChanged) spot = { ...spot, pos: tr.changes.mapPos(spot.pos, -1) }
    for (const e of tr.effects) {
      if (e.is(showRecorder)) spot = e.value
      else if (e.is(hideRecorder) && spot?.id === e.value) spot = null
      else if (e.is(recorderMoved) && spot?.notePath === e.value.from) spot = { ...spot, notePath: e.value.to }
    }
    // Another note in this editor: the block goes with the note it belonged to.
    // The recording itself is stopped and saved by `recorderWatch` below.
    if (spot && (tr.state.field(linkEnv, false)?.path ?? '') !== spot.notePath) return null
    return spot
  }
})

/** The block, as a block widget. From the state (a facet computed off the
 *  field) rather than a view plugin, because CodeMirror only takes BLOCK
 *  decorations that way. */
const recorderBlock = EditorView.decorations.compute([recorderSpot], (state) => {
  const spot = state.field(recorderSpot)
  if (!spot) return Decoration.none
  const pos = Math.min(spot.pos, state.doc.length)
  const line = state.doc.lineAt(pos)
  const { at, side } = blockPlacement(pos, line.from, line.to)
  return Decoration.set([Decoration.widget({ widget: new RecorderWidget(spot.id), block: true, side }).range(at)])
})

/** Stops and saves the recording when its editor moves to another note or goes
 *  away. Never dispatches from inside the update (CodeMirror forbids it): the
 *  save starts a moment later, which is also after the document swap is done. */
const recorderWatch = ViewPlugin.fromClass(
  class {
    constructor(readonly view: EditorView) {}
    update(u: ViewUpdate): void {
      const rec = live
      if (!rec || rec.view !== u.view || rec.leaving) return
      if ((u.state.field(linkEnv, false)?.path ?? '') === rec.notePath) return
      rec.leaving = true
      queueMicrotask(() => void rec.finish())
    }
    destroy(): void {
      const rec = live
      if (!rec || rec.view !== this.view) return
      rec.viewGone = true
      void rec.finish()
    }
  }
)

const recorderExtension: Extension = [recorderSpot, recorderBlock, recorderWatch]

/** Added to an editor the first time it records rather than to every editor up
 *  front: nothing about it costs anything until then. */
function ensureInstalled(view: EditorView): void {
  if (view.state.field(recorderSpot, false) !== undefined) return
  view.dispatch({ effects: StateEffect.appendConfig.of(recorderExtension) })
}

// --- the block's DOM -------------------------------------------------------------

interface RecorderUi {
  root: HTMLElement
  /** Start recording — the panel's one button until it is pressed */
  start: HTMLButtonElement
  /** the dot, what it is doing and the time: there once it has started */
  state: HTMLElement
  status: HTMLElement
  time: HTMLElement
  /** the live waveform's row of bars, one more than shows (it slides) */
  wave: HTMLElement
  bars: HTMLElement[]
  /** the heights on screen, so a frame only touches the bars that changed */
  shownBars: string[]
  shownShift: string
  actions: HTMLElement
  pause: HTMLButtonElement
  stop: HTMLButtonElement
  discard: HTMLButtonElement
  ask: HTMLElement
  askYes: HTMLButtonElement
  askNo: HTMLButtonElement
}

const SVG = 'http://www.w3.org/2000/svg'

type Glyph = 'pause' | 'play' | 'stop' | 'record'

/** A small filled icon for a button face — pause bars, a play triangle, a stop
 *  square, the record dot. Drawn in currentColor so it follows the button's
 *  text (the record dot is coloured by app.css). */
function glyph(kind: Glyph): SVGElement {
  const svg = document.createElementNS(SVG, 'svg')
  svg.setAttribute('viewBox', '0 0 16 16')
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('class', `cm-voice-rec-glyph is-${kind}`)
  const path = document.createElementNS(SVG, 'path')
  path.setAttribute(
    'd',
    kind === 'pause'
      ? 'M4 3h3v10H4zM9 3h3v10H9z'
      : kind === 'play'
        ? 'M5 3l8 5-8 5z'
        : kind === 'stop'
          ? 'M4 4h8v8H4z'
          : 'M8 3a5 5 0 1 0 0 10A5 5 0 1 0 8 3z'
  )
  path.setAttribute('fill', 'currentColor')
  svg.appendChild(path)
  return svg
}

function button(cls: string): HTMLButtonElement {
  const b = document.createElement('button')
  b.type = 'button'
  b.className = 'cm-voice-rec-btn' + (cls ? ' ' + cls : '')
  // Keep the caret in the note: a click on Pause must not take the keyboard
  // away from someone who is typing while they talk.
  b.addEventListener('mousedown', (e) => e.preventDefault())
  return b
}

/** A button's face and labels. `tip` is the hover text (data-tip — never
 *  `title`, CLAUDE.md), `aria` what a screen reader says. */
function face(b: HTMLButtonElement, icon: Glyph | null, text: string, aria: string, tip: string): void {
  b.replaceChildren(...(icon ? [glyph(icon)] : []), document.createTextNode(text))
  b.setAttribute('aria-label', aria)
  b.dataset.tip = tip
}

function buildUi(): RecorderUi {
  const root = document.createElement('div')
  root.className = 'cm-voice-rec'
  root.setAttribute('role', 'group')
  root.setAttribute('aria-label', 'Voice note recorder')

  const start = button('is-record')
  face(start, 'record', 'Start recording', 'Start recording', 'Start recording — the microphone turns on now')

  const state = document.createElement('span')
  state.className = 'cm-voice-rec-state'
  const dot = document.createElement('span')
  dot.className = 'cm-voice-rec-dot'
  dot.setAttribute('aria-hidden', 'true')
  const status = document.createElement('span')
  status.className = 'cm-voice-rec-status'
  status.setAttribute('aria-live', 'polite')
  const time = document.createElement('span')
  time.className = 'cm-voice-rec-time'
  state.append(dot, status, time)

  // The live waveform: the player's bars (voicePlayerUi.ts), on the same grid,
  // with a hairline under them so an empty one still reads as where the voice
  // will show.
  const box = document.createElement('span')
  box.className = 'cm-voice-rec-wavebox'
  box.setAttribute('aria-hidden', 'true')
  const wave = document.createElement('span')
  wave.className = 'cm-voice-rec-wave'
  const bars: HTMLElement[] = []
  for (let i = 0; i <= BARS; i++) bars.push(wave.appendChild(document.createElement('i')))
  box.appendChild(wave)

  const actions = document.createElement('span')
  actions.className = 'cm-voice-rec-actions'
  const pause = button('')
  const stop = button('is-primary')
  const discard = button('is-quiet')
  actions.append(pause, stop, discard)

  const ask = document.createElement('span')
  ask.className = 'cm-voice-rec-actions cm-voice-rec-ask'
  ask.hidden = true
  const askYes = button('is-danger')
  face(askYes, null, 'Discard', 'Yes, discard the recording', 'Throw it away')
  const askNo = button('')
  face(askNo, null, 'Keep', 'No, keep the recording', 'Keep it')
  ask.append(askYes, askNo)

  root.append(start, state, box, actions, ask)
  return {
    root,
    start,
    state,
    status,
    time,
    wave,
    bars,
    shownBars: bars.map(() => '?'), // nothing drawn yet: the first paint sets every bar
    shownShift: '',
    actions,
    pause,
    stop,
    discard,
    ask,
    askYes,
    askNo
  }
}

class RecorderWidget extends WidgetType {
  constructor(readonly id: number) {
    super()
  }
  /** Same recording, same element — so the block is not rebuilt (and its meter
   *  not restarted) on every keystroke typed while it records. */
  eq(other: RecorderWidget): boolean {
    return other.id === this.id
  }
  toDOM(): HTMLElement {
    const ui = buildUi()
    if (live && live.id === this.id) live.mount(ui)
    else ui.root.dataset.phase = 'saving'
    return ui.root
  }
  destroy(dom: HTMLElement): void {
    live?.unmount(dom)
  }
  /** The block owns its own clicks. CodeMirror must not turn one into a cursor
   *  placement (the same reasoning as the video player's widget). */
  ignoreEvent(): boolean {
    return true
  }
  get estimatedHeight(): number {
    return 46
  }
}

// --- the recording ------------------------------------------------------------------

/** `ready`: the panel is up and nothing has been recorded — Start recording. */
type Phase = 'ready' | 'starting' | 'recording' | 'paused' | 'confirm' | 'saving' | 'failed'

/** One MediaRecorder and what it has produced. Two run at once only while AAC
 *  is unproven (see `chooseRecording`). */
interface Take {
  recorder: MediaRecorder
  plan: RecorderPlan
  chunks: Blob[]
  bytes: number
  failed: boolean
  /** settles once this recorder has stopped (or broken) */
  stopped: Promise<void>
}

let nextId = 1
/** The recording in progress, if any — one microphone, so one at a time. */
let live: Recording | null = null

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

class Recording {
  readonly id = nextId++
  /** when Start was pressed — what the recording's file is named after */
  startedAt = new Date()
  phase: Phase = 'ready'
  /** set once its editor has been destroyed — nothing may be dispatched to it */
  viewGone = false
  /** set once its editor has moved to another note — the save is under way */
  leaving = false
  /** finished one way or another: saved, discarded or abandoned */
  private over = false
  private askedFrom: Phase = 'recording'
  private stream: MediaStream | null = null
  private take: Take | null = null
  private backup: Take | null = null
  /** recorded time so far, not counting pauses, up to `since` */
  private activeMs = 0
  /** when the current unpaused stretch began, or null while not recording */
  private since: number | null = null
  private ctx: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  private samples: Float32Array<ArrayBuffer> | null = null
  /** the live waveform: the loudest moment in each of its slots (each
   *  LIVE_SECONDS / BARS long), from the start of the recording, and the
   *  loudest of all — the bars are drawn against that, as the player draws
   *  against the loudest moment of the whole recording */
  private readonly levels: number[] = []
  private loudest = 0
  private raf = 0
  private shownTime = ''
  private readonly uis = new Set<RecorderUi>()
  private saving: Promise<void> | null = null
  /** the finished recording, kept until it is safely on disk */
  private bytes: Uint8Array | null = null
  private ext = 'm4a'

  constructor(
    readonly view: EditorView,
    public notePath: string
  ) {}

  recordedMs(): number {
    return this.activeMs + (this.since === null ? 0 : performance.now() - this.since)
  }

  // --- starting -------------------------------------------------------------

  /** Start recording, pressed. The microphone is asked for — and opened — now,
   *  never before: the panel alone never turns it on. */
  start(): void {
    if (this.phase !== 'ready' || this.over) return
    this.startedAt = new Date()
    this.phase = 'starting'
    this.render()
    void this.begin()
  }

  async begin(): Promise<void> {
    try {
      await this.open()
    } catch (e) {
      // Anything unforeseen: never leave a block saying "Starting…" for ever,
      // or the microphone open with nothing listening to it.
      console.error('voice recording failed to start', e)
      this.abandon('Couldn’t start recording.')
    }
  }

  private async open(): Promise<void> {
    let access: MicAccess | null = null
    try {
      access = await window.api.microphoneAccess()
    } catch (e) {
      // The question couldn't be asked (an older main, a broken channel). The
      // microphone request below is the real test, so carry on and let it say.
      console.warn('could not ask main about the microphone', e)
    }
    if (this.over) return
    const blocked = access ? micAccessMessage(access) : null
    if (blocked) return this.abandon(blocked)

    const devices = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined
    if (!devices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      return this.abandon('Recording isn’t available here.')
    }
    let stream: MediaStream
    try {
      stream = await devices.getUserMedia({ audio: true })
    } catch (e) {
      console.error('could not open the microphone', e)
      const name = (e as { name?: unknown } | null)?.name
      return this.abandon(recorderErrorMessage(typeof name === 'string' ? name : '', platformOf(navigator.userAgent)))
    }
    // Discarded while the microphone was being opened: let go of it at once.
    if (this.over) {
      for (const t of stream.getTracks()) t.stop()
      return
    }
    this.stream = stream
    // Unplugged mid-recording: keep what there is.
    for (const t of stream.getAudioTracks()) {
      t.addEventListener('ended', () => this.stoppedByItself('The microphone was disconnected — saving what was recorded.'))
    }

    let started: boolean
    try {
      started = this.startTakes(stream)
    } catch (e) {
      console.error('could not start the recorder', e)
      return this.abandon('Couldn’t start recording.')
    }
    if (!started) return this.abandon('Recording isn’t available here.')
    this.startMeter(stream)
    this.phase = 'recording'
    this.since = performance.now()
    this.render()
    this.tick()
  }

  /** False when this recorder can make neither kind of .m4a. */
  private startTakes(stream: MediaStream): boolean {
    const rate = stream.getAudioTracks()[0]?.getSettings().sampleRate
    const plan = chooseRecording((m) => MediaRecorder.isTypeSupported(m), rate)
    if (!plan) return false
    this.take = this.makeTake(stream, plan.first)
    if (plan.understudy) {
      try {
        this.backup = this.makeTake(stream, plan.understudy)
      } catch (e) {
        console.warn('no backup recorder', e)
      }
    }
    this.take.recorder.start(TIMESLICE_MS)
    try {
      this.backup?.recorder.start(TIMESLICE_MS)
    } catch (e) {
      console.warn('backup recorder would not start', e)
      this.backup = null
    }
    return true
  }

  private makeTake(stream: MediaStream, plan: RecorderPlan): Take {
    // Always a named type: left to itself the recorder picks WebM (see voiceRecModel).
    const recorder = new MediaRecorder(stream, { mimeType: plan.mime, audioBitsPerSecond: plan.bitsPerSecond })
    let settle: () => void = () => {}
    const stopped = new Promise<void>((r) => (settle = r))
    const take: Take = { recorder, plan, chunks: [], bytes: 0, failed: false, stopped }
    recorder.addEventListener('dataavailable', (e) => {
      if (!e.data || e.data.size === 0) return
      take.chunks.push(e.data)
      take.bytes += e.data.size
      // AAC has produced sound: it works with this microphone, so the
      // understudy can go.
      if (take === this.take && this.backup) this.dropBackup()
    })
    recorder.addEventListener('error', (e) => {
      settle()
      this.takeFailed(take, e)
    })
    recorder.addEventListener('stop', () => {
      settle()
      // A recorder that stops without being asked lost its microphone.
      if (take === this.take && !this.over && !this.saving) this.stoppedByItself(UNEXPECTED_STOP)
    })
    return take
  }

  private dropBackup(): void {
    const b = this.backup
    this.backup = null
    if (b && b.recorder.state !== 'inactive') {
      try {
        b.recorder.stop()
      } catch {
        // already stopping
      }
    }
  }

  private takeFailed(take: Take, why: unknown): void {
    if (take.failed) return
    take.failed = true
    console.error('voice recorder failed', why)
    if (this.over) return
    if (take === this.backup) {
      this.backup = null
      return
    }
    if (take !== this.take) return
    if (this.backup && take.bytes === 0) {
      // AAC never produced a sound. Opus has been recording since the start,
      // so it takes over and nothing said so far is lost.
      this.take = this.backup
      this.backup = null
      try {
        if (take.recorder.state !== 'inactive') take.recorder.stop()
      } catch {
        // already stopped itself
      }
      return
    }
    // Broke partway (or never produced a sound, with nothing to take over):
    // keep whatever it got, and say so — the block is about to go.
    this.stoppedByItself(take.bytes > 0 ? UNEXPECTED_STOP : null)
  }

  private startMeter(stream: MediaStream): void {
    try {
      const ctx = new AudioContext()
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 1024
      // Into the analyser and nowhere else — never to the speakers.
      ctx.createMediaStreamSource(stream).connect(analyser)
      void ctx.resume().catch(() => {})
      this.ctx = ctx
      this.analyser = analyser
      this.samples = new Float32Array(analyser.fftSize)
    } catch (e) {
      console.warn('no level meter', e)
    }
  }

  // --- while recording ----------------------------------------------------------

  private tick = (): void => {
    this.raf = 0
    if (this.over || this.since === null) return
    if (this.analyser && this.samples) {
      this.analyser.getFloatTimeDomainData(this.samples)
      let peak = 0
      for (let i = 0; i < this.samples.length; i++) {
        const v = Math.abs(this.samples[i])
        if (v > peak) peak = v
      }
      // The loudest moment in this slot of the live waveform. A slot the window
      // was hidden for (no frames ran) simply stays a stub.
      const k = Math.floor(this.recordedMs() / 1000 / LIVE_SLOT)
      if (peak > (this.levels[k] ?? 0)) this.levels[k] = peak
      if (peak > this.loudest) this.loudest = peak
    }
    // A recorder that has handed over nothing at all by now never will (no error
    // is promised). With an understudy, it takes over; without one, the person
    // is told now — not after talking for ten minutes into nothing.
    if (this.take && !this.take.failed && this.take.bytes === 0 && this.recordedMs() > PROBATION_MS) {
      this.takeFailed(this.take, new Error('the recorder produced no sound'))
    }
    this.paint()
    this.raf = requestAnimationFrame(this.tick)
  }

  pause(): void {
    if (this.phase !== 'recording') return
    for (const t of [this.take, this.backup]) {
      if (t?.recorder.state === 'recording') t.recorder.pause()
    }
    if (this.since !== null) this.activeMs += performance.now() - this.since
    this.since = null
    this.phase = 'paused'
    this.render()
  }

  resume(): void {
    if (this.phase !== 'paused') return
    for (const t of [this.take, this.backup]) {
      if (t?.recorder.state === 'paused') t.recorder.resume()
    }
    this.since = performance.now()
    this.phase = 'recording'
    this.render()
    if (!this.raf) this.tick()
  }

  discard(): void {
    if (this.over || this.phase === 'saving') return
    if (this.phase === 'ready' || this.phase === 'starting') return this.abandon(null)
    if (this.phase === 'confirm') return
    if (!shouldConfirmDiscard(this.recordedMs())) return this.abandon(null)
    this.askedFrom = this.phase
    this.phase = 'confirm'
    this.render()
  }

  keep(): void {
    if (this.phase !== 'confirm') return
    this.phase = this.askedFrom
    this.render()
  }

  /** A second `/voice` while this one runs: bring it into view and light it up. */
  reveal(): void {
    if (!this.viewGone) {
      const spot = this.view.state.field(recorderSpot, false)
      if (spot?.id === this.id) {
        this.view.dispatch({
          effects: EditorView.scrollIntoView(Math.min(spot.pos, this.view.state.doc.length), { y: 'center' })
        })
      }
    }
    requestAnimationFrame(() => {
      for (const ui of this.uis) {
        ui.root.classList.remove('is-flash')
        void ui.root.offsetWidth // restart the animation
        ui.root.classList.add('is-flash')
      }
    })
  }

  // --- finishing -----------------------------------------------------------------

  /** The recording ended without anyone pressing Stop: say so (when there is
   *  something to say), then save what there is like any other stop. */
  private stoppedByItself(message: string | null): void {
    if (this.over || this.saving || this.phase === 'failed') return
    if (message) notifyUser(this.view.state, message)
    void this.finish()
  }

  /** Stop and save. Safe to call any number of times, from anywhere — Stop,
   *  a note switch, the editor closing, the app quitting. */
  finish(): Promise<void> {
    if (this.phase === 'failed') return this.retry()
    if (this.saving) return this.saving
    if (this.over) return Promise.resolve()
    if (this.phase === 'ready' || this.phase === 'starting') {
      this.abandon(null)
      return Promise.resolve()
    }
    if (this.since !== null) this.activeMs += performance.now() - this.since
    this.since = null
    this.phase = 'saving'
    this.render()
    this.saving = this.stopAndSave()
    return this.saving
  }

  private async stopAndSave(): Promise<void> {
    const takes = [this.take, this.backup].filter((t): t is Take => t !== null)
    for (const t of takes) {
      try {
        if (t.recorder.state !== 'inactive') t.recorder.stop()
      } catch {
        // stopped itself already
      }
    }
    // The last piece arrives just before 'stop'. Don't wait forever for a
    // recorder that has gone quiet — whatever it has handed over is kept.
    await Promise.race([Promise.all(takes.map((t) => t.stopped)), delay(2000)])
    this.releaseMic()

    const chosen = takes.find((t) => !t.failed && t.bytes > 0) ?? takes.find((t) => t.bytes > 0)
    if (!chosen) {
      this.end()
      const broke = takes.length > 0 && takes.every((t) => t.failed)
      notifyUser(this.view.state, broke ? 'Couldn’t record from the microphone.' : 'Nothing was recorded.')
      return
    }
    const type = chosen.recorder.mimeType || chosen.plan.mime
    this.ext = extForRecordedMime(type, chosen.plan.ext)
    this.bytes = new Uint8Array(await new Blob(chosen.chunks, { type }).arrayBuffer())
    await this.write()
  }

  private retry(): Promise<void> {
    if (this.phase !== 'failed' || !this.bytes) return this.saving ?? Promise.resolve()
    this.phase = 'saving'
    this.render()
    this.saving = this.write()
    return this.saving
  }

  private async write(): Promise<void> {
    const bytes = this.bytes
    if (!bytes) return
    let name: string
    try {
      name = baseNameOf(await window.api.writeAsset(dirName(this.notePath), voiceFileName(this.startedAt, this.ext), bytes))
    } catch (e) {
      console.error('could not save the recording', e)
      notifyError(this.view.state, 'Couldn’t save the recording', e)
      if (this.blockShowing()) {
        // The sound is still in memory — keep it, and offer to try again.
        this.phase = 'failed'
        this.saving = null
        this.render()
      } else {
        this.end()
      }
      return
    }
    this.bytes = null
    const added = this.insert(name)
    this.end()
    if (!added) addToItsNote(this.view, this.notePath, name)
  }

  /** Write the voice note's line where the block is, on a line of its own, in
   *  the same transaction that takes the block away. False when the note it
   *  belongs in is no longer on screen — the file is saved either way. */
  private insert(name: string): boolean {
    if (this.viewGone) return false
    const view = this.view
    if ((view.state.field(linkEnv, false)?.path ?? '') !== this.notePath) return false
    const spot = view.state.field(recorderSpot, false)
    if (!spot || spot.id !== this.id) return false
    const doc = view.state.doc
    const pos = Math.min(spot.pos, doc.length)
    const line = doc.lineAt(pos)
    const { at, text } = recordingInsert(line.text, line.from, pos, audioTag(encodeTarget(name)))
    // Someone still sitting where they typed `/voice` carries on below the new
    // line; someone who has moved on — elsewhere, or further along that same
    // line — is left where they are.
    const sel = view.state.selection.main
    const follow = sel.empty && sel.head === pos && at === pos
    view.dispatch({
      changes: { from: at, insert: text },
      effects: hideRecorder.of(this.id),
      ...(follow ? { selection: { anchor: at + text.length } } : {})
    })
    return true
  }

  private blockShowing(): boolean {
    if (this.viewGone) return false
    return this.view.state.field(recorderSpot, false)?.id === this.id
  }

  /** Give up before anything was recorded (or throw away what was), saying
   *  `message` if there is something to say. */
  private abandon(message: string | null): void {
    if (this.over) return
    for (const t of [this.take, this.backup]) {
      if (!t) continue
      t.failed = true
      try {
        if (t.recorder.state !== 'inactive') t.recorder.stop()
      } catch {
        // already stopped
      }
    }
    this.releaseMic()
    this.end()
    if (message) notifyUser(this.view.state, message)
  }

  /** Discard, confirmed (or under the few seconds that need no asking). */
  throwAway(): void {
    this.bytes = null
    this.abandon(null)
  }

  /** Let go of the microphone — the moment the system's "recording" light goes
   *  out — and of the meter. */
  private releaseMic(): void {
    if (this.raf) cancelAnimationFrame(this.raf)
    this.raf = 0
    for (const t of this.stream?.getTracks() ?? []) t.stop()
    this.stream = null
    const ctx = this.ctx
    this.ctx = null
    this.analyser = null
    this.samples = null
    if (ctx) void ctx.close().catch(() => {})
  }

  /** Over: the block goes and the app is free to record again. */
  private end(): void {
    this.over = true
    this.since = null
    if (!this.viewGone && this.blockShowing()) this.view.dispatch({ effects: hideRecorder.of(this.id) })
    if (live === this) live = null
  }

  // --- the block -------------------------------------------------------------------

  mount(ui: RecorderUi): void {
    this.uis.add(ui)
    ui.start.addEventListener('click', () => this.start())
    ui.pause.addEventListener('click', () => (this.phase === 'paused' ? this.resume() : this.pause()))
    ui.stop.addEventListener('click', () => void this.finish())
    ui.discard.addEventListener('click', () => this.discard())
    ui.askYes.addEventListener('click', () => this.throwAway())
    ui.askNo.addEventListener('click', () => this.keep())
    this.shownTime = ''
    this.render()
  }

  unmount(root: HTMLElement): void {
    for (const ui of this.uis) if (ui.root === root) this.uis.delete(ui)
  }

  private render(): void {
    const p = this.phase
    const recording = p === 'recording' || (p === 'confirm' && this.askedFrom === 'recording')
    // Nothing recorded yet: closing the panel throws nothing away, and says so.
    const unstarted = p === 'ready' || p === 'starting'
    for (const ui of this.uis) {
      ui.root.dataset.phase = p
      ui.start.hidden = p !== 'ready'
      ui.state.hidden = p === 'ready'
      ui.status.textContent =
        p === 'ready'
          ? ''
          : p === 'starting'
            ? 'Starting the microphone…'
            : p === 'recording'
              ? 'Recording'
              : p === 'paused'
                ? 'Paused'
                : p === 'confirm'
                  ? 'Discard this recording?'
                  : p === 'saving'
                    ? 'Saving…'
                    : 'Couldn’t save the recording.'
      ui.time.hidden = unstarted
      ui.actions.hidden = p === 'confirm'
      ui.ask.hidden = p !== 'confirm'
      // Pause and Stop mean nothing until there is a recording to pause or stop.
      ui.pause.hidden = p === 'ready'
      ui.stop.hidden = p === 'ready'
      if (p === 'paused') face(ui.pause, 'play', 'Resume', 'Resume recording', 'Carry on recording')
      else face(ui.pause, 'pause', 'Pause', 'Pause recording', 'Pause — nothing is recorded until you resume')
      if (p === 'failed') face(ui.stop, null, 'Try again', 'Try saving the recording again', 'Try saving it again')
      else face(ui.stop, 'stop', 'Stop', 'Stop and add the recording to the note', 'Stop and add it to the note')
      if (unstarted) face(ui.discard, null, 'Cancel', 'Close the recorder', 'Close this — nothing has been recorded')
      else face(ui.discard, null, 'Discard', 'Discard the recording', 'Throw this recording away')
      ui.pause.disabled = !(p === 'recording' || p === 'paused')
      ui.stop.disabled = !(p === 'recording' || p === 'paused' || p === 'failed')
      ui.discard.disabled = p === 'saving'
      ui.root.classList.toggle('is-live', recording)
    }
    this.shownTime = ''
    this.paint()
  }

  /** The parts that move: the time, and the live waveform — the last 30
   *  seconds, filling from the left and then sliding left with the newest sound
   *  at the right edge (`liveStart`). Bars sit on a fixed grid of slots and the
   *  row slides by the part-slot in between, so it glides rather than steps;
   *  with motion off it steps a whole bar at a time. */
  private paint(): void {
    const ms = this.recordedMs()
    const time = formatElapsed(ms)
    const sec = ms / 1000
    const { first, offset } = stripAt(liveStart(sec), LIVE_SLOT)
    const shift = motionOn() && offset > 0 ? `translateX(-${((offset * 100) / (BARS + 1)).toFixed(3)}%)` : ''
    // Against the loudest so far, as the player's bars are against the loudest
    // of the whole — with a floor, so a silent room isn't blown up to full height.
    const scale = Math.max(this.loudest, 0.02)
    const heights: string[] = []
    for (let i = 0; i <= BARS; i++) {
      const k = first + i
      // A slot not reached yet has no bar; one recorded in silence is a stub.
      const v = Math.min(1, Math.max(MIN_BAR, (this.levels[k] ?? 0) / scale))
      heights.push(k * LIVE_SLOT < sec ? `${Math.round(v * 100)}%` : '')
    }
    for (const ui of this.uis) {
      if (time !== this.shownTime) ui.time.textContent = time
      if (shift !== ui.shownShift) {
        ui.shownShift = shift
        ui.wave.style.transform = shift
      }
      for (let i = 0; i <= BARS; i++) {
        if (heights[i] === ui.shownBars[i]) continue
        ui.shownBars[i] = heights[i]
        ui.bars[i].style.height = heights[i] || '0px'
        ui.bars[i].style.visibility = heights[i] ? '' : 'hidden'
      }
    }
    this.shownTime = time
  }
}

// --- a recording whose note left the screen -------------------------------------------
//
// The block's spot belonged to a document that is no longer in front of anyone
// (another note was opened over it, or its tab was closed), so the voice note
// goes at the END of its note instead — never into whatever note is on screen
// now. Three ways it gets there, in order:
//   (a) some editor shows that note right now: added there, at once;
//   (b) none does: it waits, and is added the moment an editor shows the note
//       (viewRegistry's `onNoteShown`) — through the editor, so the app's own
//       copy of the note and its autosave both have it;
//   (c) the app quits first: `flushRecordings` writes it into the note's file.

interface WaitingLine {
  name: string
  /** the voice note's line, exactly as it will be written */
  tag: string
}

/** Lines still waiting for their note, by note path. */
const waiting = new Map<string, WaitingLine[]>()
/** Notes an add is already in progress for — one at a time per note. */
const adding = new Set<string>()
/** Notes whose editor changed while an add was in progress: look again after. */
const lookAgain = new Set<string>()
let watching = false

/** A note was renamed or moved (App's remapOpen). A recording running in it
 *  keeps going and lands in it under its new name, and a voice note still
 *  waiting for it follows it. Before this, renaming a note mid-recording
 *  stopped the recording and queued it for the OLD name — a later new note of
 *  that name got it instead (bug scan 2026-10-27). */
export function voiceNoteMoved(from: string, to: string): void {
  const remap = (p: string): string => (p === from ? to : p.startsWith(from + '/') ? to + p.slice(from.length) : p)
  const rec = live
  if (rec && !rec.leaving) {
    const next = remap(rec.notePath)
    if (next !== rec.notePath) {
      if (!rec.viewGone) rec.view.dispatch({ effects: recorderMoved.of({ from: rec.notePath, to: next }) })
      rec.notePath = next
    }
  }
  for (const [p, list] of [...waiting]) {
    const n = remap(p)
    if (n === p) continue
    waiting.delete(p)
    waiting.set(n, [...(waiting.get(n) ?? []), ...list])
  }
}

function addToItsNote(from: EditorView, notePath: string, name: string): void {
  const list = waiting.get(notePath) ?? []
  list.push({ name, tag: audioTag(encodeTarget(name)) })
  waiting.set(notePath, list)
  if (!watching) {
    watching = true
    // Inside CodeMirror's update: note the view, act once the update is over.
    onNoteShown((view) => {
      if (waiting.has(notePathOf(view))) queueMicrotask(() => void addWaiting(view))
    })
  }
  const shown = viewsShowing(notePath)
  if (shown.length) void addWaiting(shown[0])
  else notifyUser(from.state, addedWhenOpened(name, titleOf(notePath)))
}

/** Add whatever is waiting for the note `view` shows, at the end of it — but
 *  only once `view` really holds that note. A pane given a note it hasn't
 *  loaded yet shows an EMPTY stand-in until the text arrives and replaces it;
 *  a line added to the stand-in would be thrown away by that replacement, and
 *  its autosave could write the note as that one line. So the text in the
 *  editor must match the app's own copy of the note (`readNote` answers with the
 *  open copy when there is one), and an empty note is given a moment to fill
 *  before it is believed empty. Not ready: it stays waiting, and the next change
 *  in an editor showing the note tries again. */
async function addWaiting(view: EditorView): Promise<void> {
  const path = notePathOf(view)
  if (!path || !waiting.get(path)?.length) return
  if (adding.has(path)) {
    // The stand-in being replaced by the real text arrives exactly now, while
    // the first look is still deciding — it must not be dropped.
    lookAgain.add(path)
    return
  }
  adding.add(path)
  try {
    const before = view.state.doc.toString()
    const handlers = view.state.facet(linkHandlersFacet)?.current
    // The app's copy of a CRLF note keeps its \r\n until it is first edited;
    // the editor's never has them — compare the text, not the line endings.
    const truth = (handlers ? await handlers.readNote(path) : before).replace(/\r\n?/g, '\n')
    if (before === '') await delay(400)
    if (!view.dom.isConnected || notePathOf(view) !== path) return
    if (view.state.doc.toString() !== before || truth !== before) return
    const lines = waiting.get(path) ?? []
    if (!lines.length) return
    waiting.delete(path)
    view.dispatch({
      changes: { from: view.state.doc.length, insert: endInsert(before, lines.map((l) => l.tag)) }
    })
    notifyUser(view.state, addedAtEnd(lines.map((l) => l.name), titleOf(path)))
  } catch (e) {
    console.error('could not add a waiting voice note', e)
  } finally {
    adding.delete(path)
    if (lookAgain.delete(path) && waiting.get(path)?.length) queueMicrotask(() => void addWaiting(view))
  }
}

/** At quit, nothing will show these notes again: write each waiting line into
 *  its note's file. Every open note has had its own before-quit save by now
 *  (started alongside this; the pause lets it land first), so nothing writes
 *  over it afterwards. Only the end of the file changes — the writer restores a
 *  CRLF file's endings — and a note that has gone (renamed, binned) is left
 *  alone rather than written back into being. */
async function writeWaitingIntoFiles(settleMs: number): Promise<void> {
  if (!waiting.size) return
  await delay(settleMs)
  for (const [path, lines] of [...waiting]) {
    let text: string
    try {
      text = await window.api.readNote(path)
    } catch {
      continue // the note isn't there any more; the recording stays beside where it was
    }
    try {
      await window.api.writeNote(path, text + endInsert(text, lines.map((l) => l.tag)))
      waiting.delete(path)
    } catch (e) {
      console.error(`could not add a voice note to ${path}`, e)
    }
  }
}

// --- the two ways in -----------------------------------------------------------------

/** The `/voice` command: the recorder panel at the cursor, ready to start. A
 *  second one while a panel is up doesn't open another — it shows that one. */
export function startVoiceNote(view: EditorView): void {
  if (live) {
    live.reveal()
    return
  }
  const notePath = view.state.field(linkEnv, false)?.path ?? ''
  if (!notePath) {
    notifyUser(view.state, 'Open a note first, then record into it.')
    return
  }
  ensureInstalled(view)
  const rec = new Recording(view, notePath)
  live = rec
  // The panel only: recording waits for its Start recording button.
  view.dispatch({ effects: showRecorder.of({ id: rec.id, pos: view.state.selection.main.head, notePath }) })
}

/** Is any of a recording still only in memory — one running or being saved, or
 *  a saved one whose line is waiting for its note? (A panel whose Start has not
 *  been pressed holds nothing.) App holds a window close on this — closing the
 *  window is how the app quits on Windows. */
export function recordingsPending(): boolean {
  const recorded = live !== null && live.phase !== 'ready' && live.phase !== 'starting'
  return recorded || waiting.size > 0
}

/** Stop and save whatever is recording — App's before-quit flush waits on this,
 *  so quitting mid-sentence keeps the sentence. Settles within the quit budget
 *  whatever happens; the note's own save runs after it. */
export async function flushRecordings(): Promise<void> {
  const started = Date.now()
  const rec = live
  if (rec) await Promise.race([rec.finish(), delay(QUIT_BUDGET_MS)])
  await writeWaitingIntoFiles(Math.max(0, Math.min(200, QUIT_BUDGET_MS - (Date.now() - started))))
}
