import type { EditorView } from '@codemirror/view'
import { lineOfEmbed } from '../../../shared/attachments'
import { VOICE_DEFAULTS, type VoiceSettings } from '../../../shared/voiceNote'
import { linkEnv } from './linkEnv'
import { isRaw } from './rawView'
import { cachedVoiceUrl, loadVoice, onVoiceReset, waveFor } from './voiceAssets'
import { HIGH_SHELF_HZ, LIMITER, LOW_SHELF_HZ, skipTarget, toneGains } from './voiceMixer'
import { WAVE_MAX_BYTES, WAVE_MAX_SECONDS } from './voiceWave'

// Playing a voice note: one player per recording, kept OUTSIDE the editor.
//
// The block on screen (voicePlayerUi.ts) is a CodeMirror widget, and widgets are
// thrown away all the time — a slider writes its setting into the note (a
// document change), the block scrolls out of view, the cursor passes through
// the line. A player owned by the widget would stop or restart at every one of
// those. So the players live here, keyed by the recording's vault path, and a
// widget that is drawn again simply picks up the same player: the same <audio>
// element, the same audio graph, the same place in the recording.
//
// A player is let go when nothing shows its recording any more (see `unmount`)
// and when the vault switches (`onVoiceReset`, the same moment every cached
// picture and video goes).
//
// The sound goes through Web Audio so the mixer can work on it:
//
//   <audio> (blob: URL) → low shelf → high shelf → volume → limiter → speakers
//
// Tone is the two shelves tilted against each other, volume is a gain that may
// go past 100%, and the limiter keeps that from clipping. Speed is the element's
// own playbackRate with `preservesPitch`, so a faster voice is not a higher one.
// The graph is built on the first press of play — a user gesture, which is what
// lets the AudioContext start — and never on load.

export type PlayerState = 'loading' | 'ready' | 'missing' | 'unplayable'

interface Graph {
  source: MediaElementAudioSourceNode
  low: BiquadFilterNode
  high: BiquadFilterNode
  gain: GainNode
  limiter: DynamicsCompressorNode
}

/** One AudioContext for every voice note: Chromium allows only a handful, and
 *  only one voice note plays at a time anyway. */
let context: AudioContext | null = null
let contextFailed = false

function sharedContext(): AudioContext | null {
  if (context || contextFailed) return context
  try {
    context = new AudioContext({ latencyHint: 'playback' })
  } catch {
    contextFailed = true // no Web Audio: play straight through, volume capped at 100%
  }
  return context
}

/** Every live player, by vault path. */
const registry = new Map<string, VoicePlayer>()

let idleTimer: ReturnType<typeof setTimeout> | undefined
/** Let the sound output go once nothing has played for a moment. A running
 *  AudioContext holds the device open (and a pair of Bluetooth headphones out of
 *  their idle mode) even when it is only playing silence. */
function idleLater(): void {
  clearTimeout(idleTimer)
  idleTimer = setTimeout(() => {
    const anyPlaying = [...registry.values()].some((p) => p.playing)
    if (!anyPlaying && context?.state === 'running') void context.suspend().catch(() => {})
  }, 2000)
}

/** Move an AudioParam to `value` — gliding over 15 ms while sound is running, so
 *  a slider dragged during playback doesn't click on every step, and at once
 *  otherwise. */
function setParam(param: AudioParam, value: number, immediate: boolean): void {
  const ctx = context
  if (!ctx || immediate || ctx.state !== 'running') {
    param.cancelScheduledValues(0)
    param.value = value
    return
  }
  param.cancelScheduledValues(ctx.currentTime)
  param.setTargetAtTime(value, ctx.currentTime, 0.015)
}

export class VoicePlayer {
  /** Never put into the page. A media element taken OUT of the document is
   *  paused by the browser, so one that was never in it is the only kind that
   *  can outlive the widgets showing it. */
  readonly audio: HTMLAudioElement = document.createElement('audio')
  state: PlayerState = 'loading'
  /** seconds, once known — null until then, and for a recording whose length
   *  could not be found at all */
  duration: number | null = null
  /** the waveform's envelope (voiceWave.ts) — the loudest moment in every
   *  hundredth of a second, 0–1 — from which the block draws any stretch; null
   *  for flat bars */
  envelope: Float32Array | null = null
  /** what the sound is playing with right now */
  settings: VoiceSettings = { ...VOICE_DEFAULTS }
  released = false

  private graph: Graph | null = null
  private noGraph = false
  private readonly listeners = new Set<() => void>()
  private readonly views = new Set<EditorView>()
  private mounted = 0
  private readonly abort = new AbortController()
  private raf = 0
  private probing = false
  private probeTimer: ReturnType<typeof setTimeout> | undefined
  private releaseTimer: ReturnType<typeof setTimeout> | undefined
  private waveAsked = false

  constructor(readonly rel: string) {
    this.load()
  }

  // --- what the block reads ----------------------------------------------------

  get playing(): boolean {
    return !this.audio.paused && !this.audio.ended
  }

  /** Where playback is, in seconds. 0 while the length is being found (see
   *  `probe`), when the element is parked far past the end. */
  get position(): number {
    return this.probing ? 0 : this.audio.currentTime || 0
  }

  /** Be told whenever anything above changes — every frame while it plays. */
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private emit(): void {
    for (const fn of [...this.listeners]) fn()
  }

  // --- what the block asks for -------------------------------------------------

  /** Play with `settings` (the voice note's own, from its line). Pauses every
   *  other voice note first: two people talking at once is never wanted. */
  async play(settings?: VoiceSettings): Promise<void> {
    if (this.released || this.state !== 'ready') return
    for (const other of registry.values()) if (other !== this) other.pause()
    if (settings) this.apply(settings)
    this.ensureGraph()
    if (this.graph && context && context.state !== 'running') void context.resume().catch(() => {})
    this.endProbe()
    const a = this.audio
    // From the top again once it has finished — pressing play on a finished
    // recording means "again", not "nothing".
    if (a.ended || (this.duration !== null && a.currentTime >= this.duration - 0.05)) a.currentTime = 0
    try {
      await a.play()
    } catch {
      // A play() cut short by a pause() rejects; there is nothing to tell anyone.
    }
  }

  pause(): void {
    if (!this.audio.paused) this.audio.pause()
  }

  /** Jump to `seconds`, kept inside the recording. Works paused or playing. */
  seek(seconds: number): void {
    if (this.released || this.state !== 'ready' || !Number.isFinite(seconds)) return
    this.endProbe()
    this.audio.currentTime = Math.max(0, Math.min(this.duration ?? Infinity, seconds))
    this.emit()
  }

  /** The skip buttons: `delta` seconds back or forward, stopping at either end. */
  skip(delta: number): void {
    this.seek(skipTarget(this.position, delta, this.duration))
  }

  /** Use these mixer settings from now on — while playing, at once. */
  apply(s: VoiceSettings, immediate = false): void {
    this.settings = { volume: s.volume, tone: s.tone, speed: s.speed }
    const a = this.audio
    a.preservesPitch = true
    // Both: `playbackRate` is reset to `defaultPlaybackRate` whenever the
    // element (re)loads its source.
    a.defaultPlaybackRate = s.speed
    a.playbackRate = s.speed
    const g = this.graph
    if (g) {
      const { low, high } = toneGains(s.tone)
      setParam(g.gain.gain, s.volume, immediate)
      setParam(g.low.gain, low, immediate)
      setParam(g.high.gain, high, immediate)
    } else if (this.noGraph) {
      a.volume = Math.min(1, Math.max(0, s.volume))
    }
    this.emit()
  }

  // --- who is showing it ---------------------------------------------------------

  /** A block for this recording has been drawn in `view`. */
  mount(view: EditorView): void {
    this.mounted++
    this.views.add(view)
    clearTimeout(this.releaseTimer)
  }

  /** A block for this recording has been taken off the screen.
   *
   *  That happens constantly and mostly means nothing: the block scrolled out of
   *  view, the cursor is on its line, its own setting was just written. Playing
   *  on through all of those is the point of keeping players here. What DOES
   *  mean "stop" is the recording no longer being in any note on screen — the
   *  note was closed or switched, the line was deleted, Markdown pro is showing
   *  the source — so that is what is checked, a moment later, once CodeMirror
   *  has finished redrawing (a block being replaced unmounts before its
   *  replacement mounts). */
  unmount(): void {
    this.mounted = Math.max(0, this.mounted - 1)
    if (this.mounted > 0 || this.released) return
    clearTimeout(this.releaseTimer)
    this.releaseTimer = setTimeout(() => {
      if (!this.mounted && !this.stillInANote()) this.release()
    }, 400)
  }

  private stillInANote(): boolean {
    for (const view of [...this.views]) {
      if (view.dom.isConnected && !isRaw(view.state)) {
        const note = view.state.field(linkEnv, false)?.path ?? ''
        if (lineOfEmbed(view.state.doc.toString(), note, this.rel) > 0) return true
      }
      this.views.delete(view)
    }
    return false
  }

  /** Stop and let go of everything: the element, its decoder, the graph. A block
   *  still on screen (the vault switch) is told, and starts a fresh player. */
  release(): void {
    if (this.released) return
    this.released = true
    if (registry.get(this.rel) === this) registry.delete(this.rel)
    this.abort.abort()
    cancelAnimationFrame(this.raf)
    clearTimeout(this.probeTimer)
    clearTimeout(this.releaseTimer)
    const a = this.audio
    a.pause()
    a.removeAttribute('src')
    a.load() // drops the decoder and its buffers now, rather than whenever GC gets to it
    const g = this.graph
    this.graph = null
    if (g) {
      for (const node of [g.source, g.low, g.high, g.gain, g.limiter]) {
        try {
          node.disconnect()
        } catch {
          // already disconnected
        }
      }
    }
    this.emit()
    this.listeners.clear()
    idleLater()
  }

  // --- inside ------------------------------------------------------------------

  private load(): void {
    const a = this.audio
    a.preload = 'auto'
    a.preservesPitch = true
    const on = (type: string, fn: () => void): void =>
      a.addEventListener(type, fn, { signal: this.abort.signal })
    on('loadedmetadata', () => this.metadata())
    on('durationchange', () => this.durationChanged())
    // A file the browser cannot decode — an Apple Lossless memo, a .wma, an
    // .amr — fails here, never at `play()`. That is the block's "can't be
    // played here" state, with its way out (a converted copy).
    on('error', () => {
      if (this.released) return
      this.state = 'unplayable'
      this.emit()
    })
    on('play', () => {
      for (const other of registry.values()) if (other !== this) other.pause()
      if (!this.raf) this.raf = requestAnimationFrame(this.tick)
      this.emit()
    })
    on('pause', () => {
      this.emit()
      idleLater()
    })
    // Back to the start once it finishes, so the block reads as a recording
    // you can play, showing its length, rather than one stuck at its end.
    on('ended', () => {
      a.currentTime = 0
      this.emit()
      idleLater()
    })
    // Only while paused: playing, the frame loop below already redraws.
    on('seeked', () => {
      if (a.paused) this.emit()
    })
    on('timeupdate', () => {
      if (a.paused) this.emit()
    })

    // Never from the note's text: the bytes come over IPC from the vault file
    // the target resolves to (docs/security.md, "imagePass is the control").
    const ready = cachedVoiceUrl(this.rel)
    if (ready) a.src = ready
    else {
      void loadVoice(this.rel).then((url) => {
        if (this.released) return
        if (url) a.src = url
        else {
          this.state = 'missing'
          this.emit()
        }
      })
    }
  }

  private tick = (): void => {
    this.raf = 0
    if (this.released || this.audio.paused) return
    this.emit()
    this.raf = requestAnimationFrame(this.tick)
  }

  private metadata(): void {
    if (this.released) return
    const d = this.audio.duration
    if (this.duration === null && Number.isFinite(d) && d > 0) this.duration = d
    this.state = 'ready'
    // Loading a source resets the element's rate; put the speed back.
    this.apply(this.settings, true)
    if (this.duration === null) this.probe()
    else this.fetchWave()
    this.emit()
  }

  private durationChanged(): void {
    const d = this.audio.duration
    if (this.released || !Number.isFinite(d) || d <= 0) return
    this.duration = d
    this.endProbe()
    if (this.state === 'ready') this.fetchWave()
    this.emit()
  }

  /** Find the length of a recording that does not say what it is.
   *
   *  A recording made in the browser (MediaRecorder's .webm) has no length
   *  written in it, so <audio> reports Infinity until it has read to the end
   *  (measured by the format lab: every timesliced .webm recording). Asking it
   *  to seek far past the end makes it read that far; the real length arrives
   *  as a `durationchange`, and it is put back to the start. If that never
   *  comes, the decoded waveform supplies the length instead. */
  private probe(): void {
    this.probing = true
    this.probeTimer = setTimeout(() => {
      this.endProbe()
      // Never heard back: decode it for its length, but only a file small
      // enough that its length can't be long (see WAVE_MAX_SECONDS) — 16 MB is
      // over an hour even at a voice recorder's lowest bitrate.
      if (this.duration === null) this.fetchWave(16 * 1024 * 1024)
    }, 4000)
    try {
      this.audio.currentTime = 1e101
    } catch {
      this.endProbe()
    }
  }

  private endProbe(): void {
    if (!this.probing) return
    this.probing = false
    clearTimeout(this.probeTimer)
    try {
      this.audio.currentTime = 0
    } catch {
      // nothing loaded to seek in
    }
    this.emit()
  }

  /** The waveform — for any recording of a sensible length and size
   *  (voiceWave.ts), or, with `maxBytes`, for one whose length is still unknown. */
  private fetchWave(maxBytes?: number): void {
    if (this.waveAsked) return
    if (maxBytes === undefined && (this.duration === null || this.duration > WAVE_MAX_SECONDS)) return
    this.waveAsked = true
    void waveFor(this.rel, maxBytes ?? WAVE_MAX_BYTES).then((wave) => {
      if (this.released || !wave) return
      this.envelope = wave.envelope
      if (this.duration === null && wave.duration > 0) this.duration = wave.duration
      this.emit()
    })
  }

  private ensureGraph(): void {
    if (this.graph || this.noGraph) return
    const ctx = sharedContext()
    if (ctx) {
      try {
        const low = ctx.createBiquadFilter()
        low.type = 'lowshelf'
        low.frequency.value = LOW_SHELF_HZ
        const high = ctx.createBiquadFilter()
        high.type = 'highshelf'
        high.frequency.value = HIGH_SHELF_HZ
        const gain = ctx.createGain()
        const limiter = ctx.createDynamicsCompressor()
        limiter.threshold.value = LIMITER.threshold
        limiter.knee.value = LIMITER.knee
        limiter.ratio.value = LIMITER.ratio
        limiter.attack.value = LIMITER.attack
        limiter.release.value = LIMITER.release
        // Last, because it is the step that cannot be undone: from here on the
        // element is heard only through the graph.
        const source = ctx.createMediaElementSource(this.audio)
        source.connect(low)
        low.connect(high)
        high.connect(gain)
        gain.connect(limiter)
        limiter.connect(ctx.destination)
        this.graph = { source, low, high, gain, limiter }
      } catch {
        this.noGraph = true
      }
    } else {
      this.noGraph = true
    }
    this.apply(this.settings, true)
  }
}

/** The player for a recording, made (and starting to load) if there isn't one. */
export function playerFor(rel: string): VoicePlayer {
  const known = registry.get(rel)
  if (known && !known.released) return known
  const player = new VoicePlayer(rel)
  registry.set(rel, player)
  return player
}

// The vault switch: stop everything. Relative paths name different files now.
onVoiceReset(() => {
  for (const player of [...registry.values()]) player.release()
})
