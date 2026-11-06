// The voice note editor (docs/plans/voice-editor.md): a panel over the app,
// Settings' frame with the notes blurred behind, for trimming a recording,
// cutting bits out of it, splitting it into takes, shortening its pauses and
// saving it faster or slower. Opened from a voice note's scissors button or its
// right-click menu (audioPass.ts → open.ts).
//
// Kept smooth on long recordings by drawing the waveform on a canvas and moving
// the playhead without React: React only redraws on an edit, a drag or a
// button, never sixty times a second.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '../../icons'
import { ClipWords } from './WordList'
import { placeWords, wordTimesOf, type WordTime } from './words'
import { HelpTip } from '../../Tooltip'
import { playerFor } from '../voicePlayer'
import { MAX_EDIT_SECONDS, RATE, editedFileName, loadRecording, previewWav, saveClip, startTake, withTake, type Recording, type TakeRecorder } from './audio'
import {
  appendTake, cut, deleteSection, editPoints, sectionNumbers, joins, keepOnly, moveSection, sectionAt, sectionBounds, lengthOf, shortenPauses, split, splitTimes, takes, toClip,
  toOriginal, trimEnd, trimStart, unsplit, untouched, wholeClip, type Clip
} from './model'
import { editedName, sectionName } from './names'
import { BREATH, pausesIn, quietSlices, sliceLevels } from './silence'
import { clipCells, gridFor, liveCells, pyramid, CELL } from './bars'
import { onClipEditor, onClipEditorCommand, setClipEditorOpen, type ClipEditRequest } from './open'

/** The closest the zoom goes: this many seconds across the waveform. */
const MIN_SPAN = 2
/** Bars are this wide with this gap, in screen pixels — the voice note's look. */
const BAR = 3
const GAP = 2
/** How near a handle or a split line a press must be to take it, in pixels. */
const GRAB = 8
/** How near, in pixels, a drag snaps onto a split, a join, an end or the playhead. */
const SNAP = 7
/** The arrow keys' steps, seconds (Shift for the bigger one). */
const NUDGE = 0.1
/** While a take records: how much the waveform shows (the recorder's 30 s) and how finely its live bars are kept. */
const LIVE_SPAN = 30
const LIVE_SLOT = 0.05
const NUDGE_BIG = 1

const IS_MAC = typeof navigator !== 'undefined' && /Mac/.test(navigator.userAgent)
const MOD_LABEL = IS_MAC ? '⌘Z' : 'Ctrl+Z'

const fmt = (t: number): string => {
  const s = Math.max(0, t)
  const m = Math.floor(s / 60)
  const rest = s - m * 60
  return `${m}:${rest.toFixed(1).padStart(4, '0')}`
}
/** The keys, one to a line, in the "?" beside the title (Reuben, 2026-11-05:
 *  they were nowhere to be found; 2026-11-06: a line under the buttons
 *  "overcrowds it"). Each platform's own names. */
const KEYS = (
  IS_MAC
    ? ['Space — play / pause', '← → — step (⇧ for a second)', '↑ ↓ — jump between cuts', 'I  O — mark a stretch', 'S or ⌘B — split', '⌫ — delete', 'P — hear it without the selection', '⌘Z — undo', '⌘S — save', '⌥-drag — no snapping', 'Words under the sound — press or drag across them to select']
    : ['Space — play / pause', '← → — step (Shift for a second)', '↑ ↓ — jump between cuts', 'I  O — mark a stretch', 'S or Ctrl+B — split', 'Del — delete', 'P — hear it without the selection', 'Ctrl+Z — undo', 'Ctrl+S — save', 'Alt-drag — no snapping', 'Words under the sound — press or drag across them to select']
).join('\n')
/** How much either side of a selection P plays, seconds. */
const AROUND = 2
const speedWords = (s: number): string => `${Number(s.toFixed(2))}×`

type View = readonly [number, number]
type Drag =
  | { kind: 'select'; from: number; moved: boolean; x: number }
  | { kind: 'trim'; side: 'start' | 'end'; at: number }
  | { kind: 'split'; at: number; x: number; moved: boolean; from: number }
  | { kind: 'pan'; x: number; view: View }
  | { kind: 'head' }
  | { kind: 'edge'; keep: number }

/** After Save swapped `file` for `made`: the note's text now, and the way back. */
export type Replaced = (file: string, note: string, text: string, made: string[], revert: () => boolean) => void

// --- the host App mounts once ----------------------------------------------------

/** Mount once (App). `onReplaced` is told when Save swapped a recording for its
 *  edit, with the note's text afterwards — App bins the original if nothing
 *  else uses it, the same rule a photo's file follows. */
export function ClipEditorHost({
  onReplaced,
  onDiscard
}: {
  onReplaced: Replaced
  /** Files a failed save had already written: to the bin (App keeps its count right). */
  onDiscard: (files: string[]) => void
}): React.JSX.Element | null {
  const [req, setReq] = useState<ClipEditRequest | null>(null)
  useEffect(() => onClipEditor((r) => setReq(r)), [])
  useEffect(() => {
    setClipEditorOpen(req !== null)
  }, [req])
  if (!req) return null
  return createPortal(<ClipEditor req={req} onReplaced={onReplaced} onDiscard={onDiscard} onGone={() => setReq(null)} />, document.body)
}

// --- the panel ----------------------------------------------------------------------

function ClipEditor({
  req,
  onReplaced,
  onDiscard,
  onGone
}: {
  req: ClipEditRequest
  onReplaced: Replaced
  onDiscard: (files: string[]) => void
  onGone: () => void
}): React.JSX.Element {
  const [rec, setRec] = useState<Recording | null>(null)
  const [clip, setClip] = useState<Clip>(wholeClip(0))
  const [past, setPast] = useState<Clip[]>([])
  const [, setFuture] = useState<Clip[]>([])
  const [sel, setSel] = useState<[number, number] | null>(null)
  /** the transcript's words with their times, when this recording has been transcribed (words.ts) */
  const [words, setWords] = useState<WordTime[] | null>(null)
  const [view, setView] = useState<View | null>(null)
  const [speed, setSpeed] = useState(1)
  const [playing, setPlaying] = useState(false)
  const [drag, setDrag] = useState<Drag | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setBusy] = useState(false)
  /** A take being recorded (Reuben, 2026-11-05: "Record another take"). While
   *  it runs everything else waits — `busy` covers both. */
  const [recording, setRecording] = useState(false)
  /** Seconds into the take being recorded — moves the view, the ruler and the take's block. */
  const [recNow, setRecNow] = useState(0)
  /** The take's live bars: the loudest moment in each LIVE_SLOT, as it comes in. */
  const liveLevels = useRef<number[]>([])
  const busy = saving || recording
  const [asking, setAsking] = useState(false)
  const [closing, setClosing] = useState(false)
  /** The waveform's width in pixels — how much room each section's label has. */
  const [boxW, setBoxW] = useState(0)

  const rootRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const overRef = useRef<HTMLCanvasElement>(null)
  const headRef = useRef<HTMLDivElement>(null)
  const playedRef = useRef<HTMLDivElement>(null)
  const playedInRef = useRef<HTMLCanvasElement>(null)
  const timeRef = useRef<HTMLSpanElement>(null)
  const head = useRef(0)
  const audio = useRef<HTMLAudioElement | null>(null)
  const audioFor = useRef<Clip | null>(null)
  const blobUrl = useRef<string | null>(null)
  const frame = useRef(0)
  /** the preview's sound is being made (play) */
  const preparing = useRef(false)
  /** P: playing the two seconds either side of the selection, skipping it */
  const around = useRef<{ skip: number; to: number; stop: number } | null>(null)

  const len = lengthOf(clip)
  // While a take records, the view is the recorder's own: the last 30 seconds,
  // filling from the left and then sliding along (voiceRecorder.ts).
  const shown: View = recording
    ? [Math.max(0, len + recNow - LIVE_SPAN), Math.max(len + recNow, Math.min(LIVE_SPAN, Math.max(len, 1)))]
    : (view ?? [0, len])
  const dirty = rec !== null && (!untouched(clip, rec.duration) || Math.abs(speed - 1) > 1e-3)

  // Live values for the drawing loop and the key handler, which outlive renders.
  // The clip's waveform bars, measured once per edit on a fixed grid (bars.ts) —
  // so zooming, scrolling or a take coming in only moves them, never re-measures.
  const bars = useMemo(() => (rec ? pyramid(clipCells(rec.envelope, clip)) : null), [rec, clip])
  const clipWords = useMemo(() => (words ? placeWords(words, clip) : []), [words, clip])
  /** marks the word being said (WordList.tsx), moved by the drawing loop like the playhead */
  const wordHead = useRef<((t: number) => void) | null>(null)
  const setWordHead = useCallback((fn: ((t: number) => void) | null): void => {
    wordHead.current = fn
  }, [])
  const live = useRef({ clip, shown, sel, rec, len, speed, recording, bars, recNow, boxW })
  live.current = { clip, shown, sel, rec, len, speed, recording, bars, recNow, boxW }

  // --- reading the recording ---------------------------------------------------
  // Once per opening. `onGone` is read from a ref: it is a new function every
  // time App draws, and as a dependency it re-read the recording — and threw
  // the edits away — each time anything behind the panel changed.
  const gone = useRef(onGone)
  gone.current = onGone
  useEffect(() => {
    playerFor(req.rel).pause()
    let stale = false
    loadRecording(req.rel).then((r) => {
      if (stale) return
      if (r === 'too-long') {
        req.notify(`This recording is too long to edit here (over ${MAX_EDIT_SECONDS / 60} minutes)`)
        gone.current()
      } else if (r === 'unreadable') {
        req.notify('Couldn’t read this recording')
        gone.current()
      } else {
        setRec(r)
        setClip(wholeClip(r.duration))
      }
    })
    // Its words, if Transcribe has been run on it (and it hasn't changed since).
    // Never transcribes by itself; a computer without it just has no words here.
    wordTimesOf(req.rel)
      .then((w) => {
        if (!stale) setWords(w && w.length ? w : null)
      })
      .catch(() => {})
    return () => {
      stale = true
    }
  }, [req])

  // The keys go to the panel, never to the note behind it.
  const returnFocus = useRef<Element | null>(null)
  useEffect(() => {
    returnFocus.current = document.activeElement
    rootRef.current?.focus()
    return () => {
      const el = returnFocus.current
      if (el instanceof HTMLElement && el.isConnected) el.focus()
    }
  }, [])

  // The preview player: plays the edited clip as a WAV, at the panel's speed
  // with the voice's pitch kept — the same way the voice note plays (voicePlayer.ts).
  useEffect(() => {
    const a = new Audio()
    a.preservesPitch = true
    audio.current = a
    const ended = (): void => setPlaying(false)
    a.addEventListener('ended', ended)
    return () => {
      a.pause()
      a.removeEventListener('ended', ended)
      a.removeAttribute('src')
      a.load()
      if (blobUrl.current) URL.revokeObjectURL(blobUrl.current)
      cancelAnimationFrame(frame.current)
    }
  }, [])

  // --- drawing --------------------------------------------------------------------
  // What was last drawn into the canvases — they are redrawn only when the
  // picture changes (an edit, a zoom, a take coming in), never because the
  // playhead moved (Reuben, 2026-11-05: "the playhead is really laggy").
  const drawn = useRef<{ bars: Float32Array[] | null; v0: number; v1: number; w: number; n: number } | null>(null)
  const drawnOver = useRef<{ bars: Float32Array[] | null; len: number; w: number } | null>(null)
  const draw = useCallback((): void => {
    const { clip: c, shown: [v0, v1], rec: r, boxW: W } = live.current
    const t = head.current
    // The playhead, and how much of the sound is "played": moved, never redrawn.
    // Both are transforms on layers of their own, so a move costs the window a
    // recomposite, not a repaint — the cheapest thing it can do.
    const inView = t >= v0 && t <= v1 && v1 > v0
    const x = v1 > v0 ? Math.max(0, Math.min(W, ((t - v0) / (v1 - v0)) * W)) : 0
    if (headRef.current) {
      headRef.current.style.display = inView ? '' : 'none'
      headRef.current.style.transform = `translateX(${x}px)`
    }
    if (playedRef.current && playedInRef.current) {
      playedRef.current.style.transform = `translateX(${x - W}px)`
      playedInRef.current.style.transform = `translateX(${W - x}px)`
    }
    if (timeRef.current) timeRef.current.textContent = fmt(t)
    wordHead.current?.(t)
    const base = live.current.bars
    const takeN = live.current.recording ? liveLevels.current.length + live.current.recNow : -1
    const last = drawn.current
    if (!last || last.bars !== base || last.v0 !== v0 || last.v1 !== v1 || last.w !== W || last.n !== takeN) {
      drawn.current = { bars: base, v0, v1, w: W, n: takeN }
      // A take coming in: its cells on the end of the clip's, the grids rebuilt
      // from them (cheap — the clip's own were measured once, `bars` below).
      let bars = base
      if (base && r && live.current.recording) {
        const take = liveCells(liveLevels.current, LIVE_SLOT, live.current.recNow, r.peak)
        const cells = new Float32Array(base[0].length + take.length)
        cells.set(base[0])
        cells.set(take, base[0].length)
        bars = pyramid(cells)
      }
      const from = base && live.current.recording ? base[0].length : Infinity
      paint(canvasRef.current, bars, v0, v1, 'ahead', from, false)
      paint(playedInRef.current, bars, v0, v1, 'played', from, false)
    }
    const len0 = lengthOf(c)
    const ow = overRef.current?.clientWidth ?? 0
    const lo = drawnOver.current
    if (!lo || lo.bars !== base || lo.len !== len0 || lo.w !== ow) {
      drawnOver.current = { bars: base, len: len0, w: ow }
      paint(overRef.current, base, 0, len0, 'faint', Infinity, true)
    }
  }, [])

  useLayoutEffect(draw, [draw, clip, view, rec, len, recNow, recording, bars, boxW])
  useEffect(() => {
    const ro = new ResizeObserver(() => {
      draw()
      setBoxW(innerRef.current?.clientWidth ?? 0)
    })
    if (canvasRef.current) ro.observe(canvasRef.current)
    return () => ro.disconnect()
  }, [draw])

  const loop = useCallback((): void => {
    const a = audio.current
    if (a && !a.paused) {
      head.current = Math.min(a.currentTime, live.current.len)
      // Hearing around a selection (P): jump over it, stop a moment after.
      const ar = around.current
      if (ar) {
        if (head.current >= ar.skip && head.current < ar.to) {
          a.currentTime = ar.to
          head.current = ar.to
        } else if (head.current >= ar.stop) {
          around.current = null
          a.pause()
          setPlaying(false)
          head.current = ar.skip
          draw()
          return
        }
      }
      // Zoomed in, the view follows the playhead once it runs off the right.
      const [v0, v1] = live.current.shown
      if (live.current.shown[1] - live.current.shown[0] < live.current.len - 1e-6 && head.current > v1) {
        const span = v1 - v0
        setView([head.current, Math.min(live.current.len, head.current + span)])
      }
      draw()
      frame.current = requestAnimationFrame(loop)
    } else draw()
  }, [draw])

  // --- playing ------------------------------------------------------------------
  const pause = useCallback((): void => {
    around.current = null
    audio.current?.pause()
    setPlaying(false)
  }, [])

  const play = useCallback(async (): Promise<void> => {
    const a = audio.current
    const { rec: r, clip: c, len: l, speed: s } = live.current
    if (!a || !r || l <= 0) return
    if (audioFor.current !== c) {
      // Made in slices, so a long clip doesn't hold the window still; a second
      // press while it is being made waits for the same one.
      if (preparing.current) return
      preparing.current = true
      let wav: Uint8Array
      try {
        wav = await previewWav(r, c.segs)
      } finally {
        preparing.current = false
      }
      // Edited (or closed) while it was being made: that sound is out of date.
      if (live.current.clip !== c || audio.current !== a) return
      if (blobUrl.current) URL.revokeObjectURL(blobUrl.current)
      blobUrl.current = URL.createObjectURL(new Blob([wav as Uint8Array<ArrayBuffer>], { type: 'audio/wav' }))
      a.src = blobUrl.current
      audioFor.current = c
      await new Promise<void>((done) => {
        if (a.readyState >= 1) return done()
        a.addEventListener('loadedmetadata', () => done(), { once: true })
      })
    }
    if (head.current >= l - 0.02) head.current = 0
    a.currentTime = head.current
    a.playbackRate = s
    try {
      await a.play()
    } catch {
      return
    }
    setPlaying(true)
    cancelAnimationFrame(frame.current)
    frame.current = requestAnimationFrame(loop)
  }, [loop])

  /** P (Reuben's idea list, 2026-11-06: "hear around a cut"): the two seconds
   *  before the selection, straight on to the two after — how it will sound
   *  with the stretch taken out, before taking it out. */
  const hearAround = useCallback((): void => {
    const s = live.current.sel
    if (!s || s[1] - s[0] < 0.02) {
      setNote('Select a stretch first, then P plays it without that stretch')
      return
    }
    pause()
    around.current = { skip: s[0], to: s[1], stop: Math.min(live.current.len, s[1] + AROUND) }
    head.current = Math.max(0, s[0] - AROUND)
    void play()
  }, [pause, play])

  const toggle = useCallback((): void => {
    if (audio.current && !audio.current.paused) pause()
    else void play()
  }, [pause, play])

  useEffect(() => {
    if (audio.current) audio.current.playbackRate = speed
  }, [speed])

  /** Move the playhead. `follow` false: the player isn't told — a drag moves
   *  only the playhead, and the sound jumps once, on release (see rulerDown). */
  const seek = useCallback(
    (t: number, follow = true): void => {
      head.current = Math.max(0, Math.min(live.current.len, t))
      if (follow && audio.current && audioFor.current === live.current.clip) audio.current.currentTime = head.current
      draw()
    },
    [draw]
  )
  /** A drag on the ruler while the clip plays: playback holds while you drag
   *  and carries on from where you let go, as in Resolve. Telling a playing
   *  player to jump on every move stalled the window for a fifth of a second,
   *  and the playing loop kept pulling the playhead back to the sound
   *  (Reuben, 2026-11-05: "the playhead is really laggy"). */
  const scrubResume = useRef(false)

  // --- editing --------------------------------------------------------------------
  /** Every edit: into the undo list, the selection cleared, the player stopped
   *  (it is playing the clip as it WAS), the playhead kept on the same moment. */
  const commit = useCallback(
    (next: Clip, message: string | null = null): void => {
      const c = live.current.clip
      if (next === c) {
        if (message) setNote(message)
        return
      }
      pause()
      const o = toOriginal(c, head.current)
      head.current = Math.min(lengthOf(next), toClip(next, o) ?? Math.min(head.current, lengthOf(next)))
      setPast((p) => [...p, c])
      setFuture([])
      setClip(next)
      setSel(null)
      setNote(message)
      setError(null)
      setView((v) => clampView(v, lengthOf(next)))
    },
    [pause]
  )

  const undo = useCallback((): void => {
    setPast((p) => {
      if (!p.length) return p
      const prev = p[p.length - 1]
      setFuture((f) => [live.current.clip, ...f])
      pause()
      setClip(prev)
      setSel(null)
      setNote(null)
      head.current = Math.min(head.current, lengthOf(prev))
      setView((v) => clampView(v, lengthOf(prev)))
      return p.slice(0, -1)
    })
  }, [pause])

  const redo = useCallback((): void => {
    setFuture((f) => {
      if (!f.length) return f
      const next = f[0]
      setPast((p) => [...p, live.current.clip])
      pause()
      setClip(next)
      setSel(null)
      setNote(null)
      head.current = Math.min(head.current, lengthOf(next))
      setView((v) => clampView(v, lengthOf(next)))
      return f.slice(1)
    })
  }, [pause])

  /** Backspace / Delete: take the selection out. Nothing selected, nothing happens. */
  const deleteSel = useCallback((): void => {
    const s = live.current.sel
    if (s) commit(cut(live.current.clip, s[0], s[1]))
  }, [commit])
  const doKeep = useCallback((): void => {
    const s = live.current.sel
    if (s) {
      head.current = 0
      commit(keepOnly(live.current.clip, s[0], s[1]))
    }
  }, [commit])
  /** I: the selection starts at the playhead (and runs to its old end, or the
   *  clip's end). O: it ends at the playhead. */
  const markIn = useCallback((): void => {
    const t = head.current
    const s = live.current.sel
    const end = s && s[1] > t + 0.02 ? s[1] : live.current.len
    if (end - t >= 0.02) setSel([t, end])
  }, [])
  const markOut = useCallback((): void => {
    const t = head.current
    const s = live.current.sel
    const start = s && s[0] < t - 0.02 ? s[0] : 0
    if (t - start >= 0.02) setSel([start, t])
  }, [])
  /** ↑/↓: the playhead to the previous or next edit — an end, a split or a join. */
  const jumpEdit = useCallback(
    (dir: -1 | 1): void => {
      const pts = editPoints(live.current.clip)
      const t = head.current
      const to = dir < 0 ? [...pts].reverse().find((p) => p < t - 0.01) : pts.find((p) => p > t + 0.01)
      if (to !== undefined) seek(to)
    },
    [seek]
  )
  const doDeleteSection = useCallback(
    (k: number): void => {
      commit(deleteSection(live.current.clip, k), `Deleted section ${sectionNumbers(live.current.clip)[k]}`)
    },
    [commit]
  )
  const doSplit = useCallback((): void => {
    const next = split(live.current.clip, head.current)
    commit(next, next === live.current.clip ? 'Move the playhead away from the ends to split there' : null)
  }, [commit])

  const quiet = useMemo(() => (rec ? quietSlices(sliceLevels(rec.samples, RATE)) : null), [rec])
  const doSilences = useCallback((): void => {
    if (!quiet) return
    const c = live.current.clip
    const pauses = pausesIn(c, quiet).filter(([a, b]) => b - a > BREATH)
    if (!pauses.length) {
      setNote('No pauses longer than 1 second')
      return
    }
    const next = shortenPauses(c, pauses, BREATH)
    const n = pauses.length
    commit(next, `Shortened ${n} ${n === 1 ? 'pause' : 'pauses'} to a breath`)
  }, [quiet, commit])

  // --- recording another take ---------------------------------------------------------
  const take = useRef<TakeRecorder | null>(null)
  useEffect(() => () => take.current?.cancel(), [])
  const startRecording = useCallback(async (): Promise<void> => {
    if (take.current || !live.current.rec) return
    pause()
    setNote(null)
    setError(null)
    setRecording(true)
    const r = await startTake()
    if (typeof r === 'string') {
      setRecording(false)
      setError(r)
      return
    }
    take.current = r
    liveLevels.current = []
    setRecNow(0)
    const started = performance.now()
    const tick = (): void => {
      if (take.current !== r) return
      const secs = (performance.now() - started) / 1000
      const k = Math.floor(secs / LIVE_SLOT)
      const lvl = r.level()
      if (lvl > (liveLevels.current[k] ?? 0)) liveLevels.current[k] = lvl
      // The playhead rides the end of the take, as the first recording's does.
      head.current = live.current.len + secs
      setRecNow(secs)
      // Never past the editor's limit: stop there and keep what there is.
      if ((live.current.rec?.duration ?? 0) + secs >= MAX_EDIT_SECONDS) return void stopRef.current()
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }, [pause])
  const stopRecording = useCallback(async (): Promise<void> => {
    const r = take.current
    if (!r) return
    take.current = null
    const samples = await r.stop()
    setRecording(false)
    setRecNow(0)
    liveLevels.current = []
    const before = live.current.rec
    if (!before || !samples || samples.length < RATE * 0.2) {
      head.current = Math.min(head.current, live.current.len)
      setNote('Nothing was recorded')
      return
    }
    const grown = await withTake(before, samples)
    if (live.current.rec !== before) return // closed or changed meanwhile
    const startsAt = live.current.len
    const next = appendTake(live.current.clip, before.duration, grown.duration)
    setRec(grown)
    commit(next, `Added the take as section ${sectionNumbers(next).at(-1)}`)
    // The playhead to the start of the new take, ready to play it back.
    head.current = startsAt
    draw()
  }, [commit, draw])
  const stopRef = useRef(stopRecording)
  stopRef.current = stopRecording

  // --- zoom -----------------------------------------------------------------------
  const zoomTo = useCallback((span: number, centre: number): void => {
    const l = live.current.len
    if (l <= 0) return
    const s = Math.max(Math.min(MIN_SPAN, l), Math.min(l, span))
    if (s >= l - 1e-6) return setView(null)
    let v0 = centre - s / 2
    v0 = Math.max(0, Math.min(l - s, v0))
    setView([v0, v0 + s])
  }, [])
  const zoomLevel = len > MIN_SPAN ? Math.log((shown[1] - shown[0]) / len) / Math.log(MIN_SPAN / len) : 0

  // --- pointer on the waveform ------------------------------------------------------
  const timeAt = (clientX: number): { t: number; px: number; w: number } => {
    const box = innerRef.current!.getBoundingClientRect()
    const px = clientX - box.left
    const [v0, v1] = live.current.shown
    return { t: v0 + (Math.max(0, Math.min(box.width, px)) / box.width) * (v1 - v0), px, w: box.width }
  }
  const pxOf = (t: number, w: number): number => ((t - shown[0]) / (shown[1] - shown[0])) * w

  /** Snap `t` onto the nearest edit point (and the playhead, unless that is
   *  what is moving) within SNAP pixels — Resolve's snapping, always on. */
  const snap = (t: number, w: number, withHead = true, free = false): number => {
    // Alt/Option held: no snapping, for a spot a hair off a line (Reuben, 2026-11-05).
    if (free) return t
    const points = editPoints(clip)
    if (withHead) points.push(head.current)
    let best = t
    let bestPx = SNAP
    for (const p of points) {
      const d = Math.abs(pxOf(p, w) - pxOf(t, w))
      if (d < bestPx) {
        bestPx = d
        best = p
      }
    }
    return best
  }

  const onPointerDown = (e: React.PointerEvent): void => {
    if (!rec || busy || e.button !== 0 || len <= 0) return
    const { t, px, w } = timeAt(e.clientX)
    if (IS_MAC ? e.metaKey : e.ctrlKey) {
      const span = shown[1] - shown[0]
      zoomTo(e.shiftKey ? span * 4 : span / 4, t)
      return
    }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    const box = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const y = e.clientY - box.top
    // In order: a selection's edges (Resolve: drag an edge to change it),
    // except over a trim handle's grip; the trim handles; a split line;
    // otherwise a new selection. The playhead is the ruler's (rulerDown).
    const onGrip = Math.abs(y - box.height / 2) <= 18
    const nearStart = Math.abs(px - pxOf(0, w)) <= GRAB
    const nearEnd = Math.abs(px - pxOf(len, w)) <= GRAB
    if (sel && !((nearStart || nearEnd) && onGrip)) {
      if (Math.abs(px - pxOf(sel[0], w)) <= GRAB) return setDrag({ kind: 'edge', keep: sel[1] })
      if (Math.abs(px - pxOf(sel[1], w)) <= GRAB) return setDrag({ kind: 'edge', keep: sel[0] })
    }
    if (nearStart) return setDrag({ kind: 'trim', side: 'start', at: 0 })
    if (nearEnd) return setDrag({ kind: 'trim', side: 'end', at: len })
    const onSplit = splitTimes(clip).find((s) => Math.abs(px - pxOf(s, w)) <= GRAB / 2)
    if (onSplit !== undefined) return setDrag({ kind: 'split', at: onSplit, x: e.clientX, moved: false, from: t })
    setDrag({ kind: 'select', from: snap(t, w, true, e.altKey), moved: false, x: e.clientX })
  }
  /** The ruler: a press puts the playhead there and a drag moves it — the
   *  playhead's marker lives in the ruler (Reuben, 2026-11-05). */
  const rulerDown = (e: React.PointerEvent): void => {
    if (!rec || busy || e.button !== 0 || len <= 0) return
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    const { t, w } = timeAt(e.clientX)
    const a = audio.current
    scrubResume.current = !!a && !a.paused
    if (scrubResume.current) a?.pause()
    setDrag({ kind: 'head' })
    seek(snap(t, w, false, e.altKey), false)
  }
  // Right-click inside a section picks all of it, so Backspace or Cut deletes it
  // and Keep only this keeps it (Reuben, 2026-11-04).
  const selectSection = (k: number): void => {
    const b = sectionBounds(clip, k)
    if (b) setSel([b[0], b[1]])
  }
  const onContextMenu = (e: React.MouseEvent): void => {
    e.preventDefault()
    if (!rec || busy || splitTimes(clip).length === 0) return
    selectSection(sectionAt(clip, timeAt(e.clientX).t))
  }
  const onPointerMove = (e: React.PointerEvent): void => {
    if (!drag) return
    const { t: raw, w } = timeAt(e.clientX)
    if (drag.kind === 'head') return seek(snap(raw, w, false, e.altKey), false)
    const t = snap(raw, w, true, e.altKey)
    if (drag.kind === 'trim') setDrag({ ...drag, at: t })
    else if (drag.kind === 'edge') setSel([Math.min(drag.keep, t), Math.max(drag.keep, t)])
    else if (drag.kind === 'select' || drag.kind === 'split') {
      if (!drag.moved && Math.abs(e.clientX - drag.x) < 3) return
      setDrag({ kind: 'select', from: drag.from, moved: true, x: drag.x })
      setSel([Math.min(drag.from, t), Math.max(drag.from, t)])
    }
  }
  const onPointerUp = (e: React.PointerEvent): void => {
    if (!drag) return
    const { t: raw, w } = timeAt(e.clientX)
    setDrag(null)
    if (drag.kind === 'head') {
      seek(snap(raw, w, false, e.altKey))
      if (scrubResume.current) {
        scrubResume.current = false
        void play()
      }
      return
    }
    const t = snap(raw, w, true, e.altKey)
    if (drag.kind === 'trim') {
      if (drag.side === 'start' && t > 0.005) commit(trimStart(clip, t))
      if (drag.side === 'end' && t < len - 0.005) commit(trimEnd(clip, t))
    } else if (drag.kind === 'split' && !drag.moved) {
      commit(unsplit(clip, drag.at))
    } else if (drag.kind === 'edge') {
      if (sel && sel[1] - sel[0] < 0.02) setSel(null)
    } else if (drag.kind === 'select') {
      if (!drag.moved) {
        setSel(null)
        seek(snap(raw, w, false, e.altKey))
      } else if (sel && sel[1] - sel[0] < 0.02) setSel(null)
    }
  }

  // A section's six dots: drag it to a new place — a line shows where it will
  // land, between sections — or click to select it (the table's column handle,
  // blockTable.ts `columnHandle`; Reuben, 2026-11-04).
  const [moving, setMoving] = useState<{ from: number; to: number; x: number; moved: boolean } | null>(null)
  const boundaryAt = (clientX: number): number => {
    const { t } = timeAt(clientX)
    const at = [0, ...splitTimes(clip), len]
    return at.reduce((best, b, i) => (Math.abs(b - t) < Math.abs(at[best] - t) ? i : best), 0)
  }
  const gripDown = (k: number) => (e: React.PointerEvent): void => {
    if (e.button !== 0 || busy) return
    e.stopPropagation()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    setMoving({ from: k, to: k, x: e.clientX, moved: false })
  }
  const gripMove = (e: React.PointerEvent): void => {
    if (!moving) return
    if (!moving.moved && Math.abs(e.clientX - moving.x) < 4) return
    setMoving({ ...moving, moved: true, to: boundaryAt(e.clientX) })
  }
  const gripUp = (): void => {
    if (!moving) return
    const m = moving
    setMoving(null)
    if (!m.moved) return selectSection(m.from)
    const next = moveSection(clip, m.from, m.to)
    if (next !== clip) {
      head.current = 0
      commit(next, `Moved section ${sectionNumbers(clip)[m.from]}`)
    }
  }

  // Sideways scroll moves a zoomed-in view along. Every sideways wheel inside
  // the panel is taken, so a two-finger swipe never changes space behind it
  // (App's swipe leaves alone a wheel already defaultPrevented).
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const onWheel = (e: WheelEvent): void => {
      // A trackpad pinch arrives as a wheel with Ctrl held; Cmd+scroll (Ctrl+scroll
      // on Windows) too. Either zooms around the pointer, as Resolve's timeline does.
      if ((e.ctrlKey || e.metaKey) && innerRef.current && innerRef.current.contains(e.target as Node)) {
        e.preventDefault()
        const { shown: [v0, v1], len: l } = live.current
        const box = innerRef.current.getBoundingClientRect()
        const f = Math.max(0, Math.min(1, (e.clientX - box.left) / box.width))
        const at = v0 + f * (v1 - v0)
        const span = Math.max(Math.min(MIN_SPAN, l), Math.min(l, (v1 - v0) * Math.exp(e.deltaY * 0.01)))
        if (span >= l - 1e-6) return setView(null)
        const n0 = Math.max(0, Math.min(l - span, at - f * span))
        return setView([n0, n0 + span])
      }
      const dx = Math.abs(e.deltaX) >= Math.abs(e.deltaY) ? e.deltaX : e.shiftKey ? e.deltaY : 0
      if (!dx) return
      e.preventDefault()
      const { shown: [v0, v1], len: l } = live.current
      if (!innerRef.current || v1 - v0 >= l - 1e-6) return
      const per = (v1 - v0) / innerRef.current.clientWidth
      const span = v1 - v0
      const n0 = Math.max(0, Math.min(l - span, v0 + dx * per))
      setView([n0, n0 + span])
    }
    root.addEventListener('wheel', onWheel, { passive: false })
    return () => root.removeEventListener('wheel', onWheel)
  }, [])

  // The overview strip (only when zoomed in): press to put the view there, drag to move it.
  const overDown = (e: React.PointerEvent): void => {
    if (!view || e.button !== 0) return
    const box = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const t = ((e.clientX - box.left) / box.width) * len
    const span = view[1] - view[0]
    const v0 = Math.max(0, Math.min(len - span, t - span / 2))
    const next: View = [v0, v0 + span]
    setView(next)
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    setDrag({ kind: 'pan', x: e.clientX, view: next })
  }
  const overMove = (e: React.PointerEvent): void => {
    if (drag?.kind !== 'pan') return
    const box = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const dt = ((e.clientX - drag.x) / box.width) * len
    const span = drag.view[1] - drag.view[0]
    const v0 = Math.max(0, Math.min(len - span, drag.view[0] + dt))
    setView([v0, v0 + span])
  }

  // --- closing and saving -------------------------------------------------------------
  const close = useCallback((): void => {
    pause()
    setClosing(true)
  }, [pause])
  const tryClose = useCallback((): void => {
    if (busy) return
    if (dirty) setAsking(true)
    else close()
  }, [busy, dirty, close])

  const save = async (replace: boolean): Promise<void> => {
    if (!rec || busy) return
    if (replace && !dirty) return close()
    pause()
    setBusy(true)
    setError(null)
    const files: { rel: string; name: string }[] = []
    try {
      const parts = takes(clip)
      if (!parts.length) throw new Error('There’s nothing left to save')
      const many = parts.length > 1
      const nums = sectionNumbers(clip)
      for (let i = 0; i < parts.length; i++) {
        const stem = editedFileName(req.rel, many ? nums[i] : null)
        const rel = await saveClip(rec, parts[i], speed, req.notePath, stem)
        const name = many ? sectionName(req.name, nums[i]) : replace ? req.name : editedName(req.name)
        files.push({ rel, name })
      }
      const done = req.apply({ files, replace, speedSaved: Math.abs(speed - 1) > 1e-3 })
      if (done === null) req.notify('Saved, but the voice note had moved — the new recordings are beside the note')
      else if (replace)
        onReplaced(
          req.rel,
          req.notePath,
          done.text,
          files.map((f) => f.rel),
          done.revert
        )
      close()
    } catch (e) {
      setBusy(false)
      const why = e instanceof Error && e.message ? e.message : 'Couldn’t save the clip'
      // A save that fails part-way (section 3 of 3) has already written the
      // first ones. They're in no note, so they go to the bin rather than sit
      // beside the note unexplained; the note itself was never touched.
      if (files.length) {
        onDiscard(files.map((f) => f.rel))
        setError(`${why}. Nothing in the note changed — the ${files.length === 1 ? 'part' : 'parts'} already saved went to the bin.`)
      } else setError(why)
    }
  }
  // The app menu's Cmd/Ctrl+S, while the panel is open: Save (open.ts).
  const saveRef = useRef(save)
  saveRef.current = save
  const recordingRef = useRef(recording)
  recordingRef.current = recording
  const guard = useRef({ busy, asking, closing })
  guard.current = { busy, asking, closing }
  useEffect(
    () =>
      onClipEditorCommand((cmd) => {
        const g = guard.current
        if (cmd === 'toggle-sidebar' && !g.busy && !g.asking && !g.closing) void saveRef.current(true)
      }),
    []
  )

  // --- keys -----------------------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (closing) return
      const mod = IS_MAC ? e.metaKey : e.ctrlKey
      const k = e.key
      let done = true
      if (take.current || recordingRef.current) {
        if (k === ' ' || k === 'Escape') void stopRef.current()
        e.preventDefault()
        e.stopPropagation()
        return
      }
      if (k === 'Escape') {
        if (asking) setAsking(false)
        else tryClose()
      } else if (asking || busy) {
        done = k === ' ' || k === 'Backspace' || k === 'Delete'
      } else if (k === ' ' && !mod) {
        // Not while a slider has the keys: Space would move it as well.
        toggle()
      } else if ((k === 'Backspace' || k === 'Delete') && !mod) deleteSel()
      else if (((k === 's' || k === 'S') && !mod && !e.altKey) || (mod && (k === 'b' || k === 'B'))) doSplit()
      // Resolve's keys (Reuben, 2026-11-04): I and O mark where a selection
      // starts and ends, the arrows step the playhead, ↑/↓ jump between edits.
      else if ((k === 'p' || k === 'P') && !mod) hearAround()
      else if ((k === 'i' || k === 'I') && !mod) markIn()
      else if ((k === 'o' || k === 'O') && !mod) markOut()
      else if ((k === 'ArrowLeft' || k === 'ArrowRight') && !mod)
        seek(head.current + (k === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? NUDGE_BIG : NUDGE))
      else if ((k === 'ArrowUp' || k === 'ArrowDown') && !mod) jumpEdit(k === 'ArrowUp' ? -1 : 1)
      else if (k === 'Home' && !mod) seek(0)
      else if (k === 'End' && !mod) seek(live.current.len)
      else if (mod && (k === 'z' || k === 'Z') && !e.shiftKey) undo()
      else if (mod && (((k === 'z' || k === 'Z') && e.shiftKey) || (!IS_MAC && (k === 'y' || k === 'Y')))) redo()
      else done = false
      if (done) {
        e.preventDefault()
        e.stopPropagation()
      }
    }
    // Space also clicks a focused button on key-UP: stop that, the key is the player's.
    const onUp = (e: KeyboardEvent): void => {
      if (e.key === ' ') e.preventDefault()
    }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('keyup', onUp, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('keyup', onUp, true)
    }
  }, [closing, asking, busy, tryClose, toggle, deleteSel, doSplit, undo, redo, markIn, markOut, jumpEdit, seek, hearAround])

  // --- what the bottom line says ------------------------------------------------------
  const tks = splitTimes(clip).length + 1
  let summary: React.ReactNode
  if (!rec) summary = 'Reading the recording…'
  else if (recording)
    summary = (
      <span className="clip-ed-recording">
        Recording a new take · {fmt(recNow)} · Space or Stop to finish — it goes on the end
      </span>
    )
  else if (busy) summary = tks > 1 ? `Saving ${tks} voice notes…` : 'Saving…'
  else if (error) summary = <span className="clip-ed-error">{error}</span>
  else if (sel && sel[1] - sel[0] >= 0.02)
    summary = (
      <>
        <b>{(sel[1] - sel[0]).toFixed(1)} s</b> selected · Delete takes it out, Keep only this keeps just it · P hears it without
      </>
    )
  else if (note) summary = note
  else if (tks > 1)
    summary = (
      <>
        Saves as <b>{tks} voice notes</b>, one under the other
      </>
    )
  else if (!dirty) summary = 'Drag across the waveform to choose a stretch'
  else
    summary = (
      <>
        Keeps <b>{fmt(len / speed)}</b> of {fmt(rec.duration)}
      </>
    )

  // --- the overlays -------------------------------------------------------------------
  const X = (t: number): string => `${((t - shown[0]) / (shown[1] - shown[0] || 1)) * 100}%`
  const visible = (t: number): boolean => t >= shown[0] - 1e-6 && t <= shown[1] + 1e-6
  const splits = splitTimes(clip)
  const nums = sectionNumbers(clip)
  /** How much of its label a section has room for, so no label ever sits on the
   *  next one's (Reuben, 2026-11-05; CLAUDE.md "Nothing covers a control"): all
   *  of it, its number and ×, its number alone, or nothing on a sliver. Measured
   *  against the label's own widths at the app's 11px type. */
  const labelFit = (i: number): 'full' | 'short' | 'number' | 'none' => {
    const ends = [0, ...splits, len]
    const onScreen = Math.min(ends[i + 1], shown[1]) - Math.max(ends[i], shown[0])
    const px = (Math.max(0, onScreen) / (shown[1] - shown[0] || 1)) * boxW
    return px >= 124 ? 'full' : px >= 54 ? 'short' : px >= 22 ? 'number' : 'none'
  }
  const trimAt = drag?.kind === 'trim' ? Math.max(0, Math.min(len, drag.at)) : null
  const hasSel = sel !== null && sel[1] - sel[0] >= 0.02

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-label="Edit clip"
      onAnimationEnd={(e) => {
        if (closing && e.target === e.currentTarget.lastElementChild) onGone()
      }}
    >
      <div
        aria-hidden="true"
        onClick={tryClose}
        className={'genie-backdrop absolute inset-0 bg-paper/50 backdrop-blur-[5px] ' + (closing ? 'closing' : '')}
      />
      <div
        ref={rootRef}
        tabIndex={-1}
        className={
          'clip-ed relative flex max-h-[calc(100vh-24px)] w-[min(1040px,80vw)] flex-col overflow-hidden border border-ink-300/25 bg-surface shadow-float outline-none ' +
          (closing ? 'closing' : '')
        }
      >
        <div className="grid shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-3 border-b border-ink-300/20 px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="text-brand-500">
              <Icon name="scissors" className="h-4 w-4" />
            </span>
            <p className="font-display text-[15px] font-semibold text-ink-900">Edit clip</p>
            <HelpTip text={KEYS} />
          </div>
          <p className="max-w-[44ch] truncate text-[13px] text-ink-500">{req.name}</p>
          <div className="flex justify-end">
            <button
              onClick={tryClose}
              data-tip="Close (Esc)"
              aria-label="Close"
              className="rounded-lg border-none bg-transparent p-1.5 text-ink-400 outline-none transition duration-200 hover:bg-ink-300/15 hover:text-ink-900 focus-visible:ring-2 focus-visible:ring-brand-300"
            >
              <Icon name="x" className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Scrolls inside a short window (the title row and the buttons at the
            foot stay put) — with the words under the sound it is taller than
            a small window (2026-11-06). */}
        <div className="flex min-h-0 flex-col gap-3 overflow-y-auto overflow-x-hidden px-6 py-5">
          {/* The timeline, top to bottom (Reuben, 2026-11-05: "rearrange the
              timeline area to make it easier to understand"): the time ruler,
              where the playhead is picked up and dragged, as in Resolve; the
              sections as blocks, like clips on a track; the sound; and, zoomed
              in, the whole clip as a strip under it, like a scroll bar. One
              playhead line runs through all three rows. */}
          <div className="clip-ed-track">
            <div
              className={'clip-ed-rulerrow' + (drag?.kind === 'head' ? ' is-scrubbing' : '')}
              onPointerDown={rulerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={() => {
                setDrag(null)
                if (scrubResume.current) {
                  scrubResume.current = false
                  void play()
                }
              }}
              data-tip={drag ? undefined : 'Click or drag to move the playhead'}
            >
              <Ruler from={shown[0]} to={shown[1]} />
            </div>

            <div className="clip-ed-lane">
              {rec && tks === 1 && !recording && (
                <div className="clip-ed-band is-whole" style={{ left: X(Math.max(0, shown[0])), width: `calc(${X(Math.min(len, shown[1]))} - ${X(Math.max(0, shown[0]))})` }}>
                  <span className="clip-ed-band-hint">Split (S) to cut this into sections you can move or delete</span>
                </div>
              )}
              {tks > 1 &&
                [0, ...splits].map((t, i) => {
                  const end = i < splits.length ? splits[i] : len
                  if (end < shown[0] || t > shown[1]) return null
                  const fit = labelFit(i)
                  const on = hasSel && Math.abs(sel[0] - t) < 1e-6 && Math.abs(sel[1] - end) < 1e-6
                  // Zoomed in, a block is cut to what's on screen, so its name
                  // stays in view and it never runs past the panel's edge.
                  const a = Math.max(t, shown[0])
                  const z = Math.min(end, shown[1])
                  return (
                    <div
                      key={`b${i}`}
                      className={'clip-ed-band' + (on ? ' is-on' : '') + (moving?.moved && moving.from === i ? ' is-lifted' : '')}
                      style={{ left: X(a), width: `calc(${X(z)} - ${X(a)})` }}
                      onPointerDown={gripDown(i)}
                      onPointerMove={gripMove}
                      onPointerUp={gripUp}
                      onPointerCancel={() => setMoving(null)}
                    >
                      {/* The whole block but its × is the handle: click selects the
                          section (then Backspace deletes it), drag moves it. */}
                      <button
                        className="clip-ed-take-grip"
                        aria-label={`Section ${nums[i]} — drag to move, click to select`}
                        data-tip={moving ? undefined : 'Click to select — drag to move'}
                        disabled={busy}
                        onMouseDown={(e) => e.preventDefault()}
                        // From the keyboard (Enter/Space on a focused block): select it.
                        onClick={(e) => {
                          if (e.detail === 0) selectSection(i)
                        }}
                      >
                        {fit === 'full' && (
                          <span className="clip-ed-take-dots">
                            <GripIcon />
                          </span>
                        )}
                        {fit === 'none' ? '' : fit === 'full' ? `Section ${nums[i]}` : nums[i]}
                      </button>
                      {(fit === 'full' || fit === 'short') && (
                        <button
                          className="clip-ed-take-x"
                          aria-label={`Delete section ${nums[i]}`}
                          data-tip="Delete this section"
                          disabled={busy}
                          onPointerDown={(e) => e.stopPropagation()}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => doDeleteSection(i)}
                        >
                          <Icon name="x" className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  )
                })}
              {recording && (
                <div className="clip-ed-band is-recording" style={{ left: X(len), width: `calc(${X(len + recNow)} - ${X(len)})` }}>
                  <span className="clip-ed-band-hint">Recording · {fmt(recNow)}</span>
                </div>
              )}
            </div>

            <div
              className={'clip-ed-wave' + (drag?.kind === 'select' ? ' is-selecting' : '')}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={() => setDrag(null)}
              onContextMenu={onContextMenu}
            >
              <div ref={innerRef} className="clip-ed-in">
                <canvas ref={canvasRef} className="clip-ed-canvas" />
                {/* The same bars in the "played" ink, uncovered up to the playhead
                    by moving this window over them — see `draw`. */}
                <div ref={playedRef} className="clip-ed-played">
                  <canvas ref={playedInRef} className="clip-ed-canvas" />
                </div>
                {!rec && <span className="clip-ed-loading">Reading the recording…</span>}
                {trimAt !== null && drag?.kind === 'trim' && (
                  <div
                    className="clip-ed-going"
                    style={drag.side === 'start' ? { left: X(0), width: `calc(${X(trimAt)} - ${X(0)})` } : { left: X(trimAt), width: `calc(${X(len)} - ${X(trimAt)})` }}
                  />
                )}
                {hasSel && <div className="clip-ed-sel" style={{ left: X(sel[0]), width: `calc(${X(sel[1])} - ${X(sel[0])})` }} />}
                {joins(clip)
                  .filter((t) => visible(t) && !splits.some((s) => Math.abs(s - t) < 1e-6))
                  .map((t, i) => (
                    <div key={`j${i}`} className="clip-ed-join" style={{ left: X(t) }} />
                  ))}
                {splits.filter(visible).map((t) => (
                  <div key={`s${t}`} className="clip-ed-split" style={{ left: X(t) }} data-tip="Click to take this split out" />
                ))}
                {rec && !recording && visible(0) && trimAt === null && <div className="clip-ed-trim" style={{ left: X(0) }} />}
                {rec && !recording && visible(len) && trimAt === null && <div className="clip-ed-trim" style={{ left: X(len) }} />}
                {trimAt !== null && <div className="clip-ed-trim" style={{ left: X(trimAt) }} />}
                {moving?.moved &&
                  (() => {
                    const b = sectionBounds(clip, moving.from)
                    return b ? <div className="clip-ed-lifted" style={{ left: X(b[0]), width: `calc(${X(b[1])} - ${X(b[0])})` }} /> : null
                  })()}
              </div>
            </div>

            {/* Drawn over all three rows; never takes a press (the ruler does). */}
            <div className="clip-ed-overlay">
              {moving?.moved && <div className="clip-ed-drop" style={{ left: X([0, ...splits, len][moving.to]) }} />}
              <div ref={headRef} className={'clip-ed-head' + (recording ? ' is-recording' : '')} />
            </div>
          </div>

          {view && !recording && (
            <div className="clip-ed-over" onPointerDown={overDown} onPointerMove={overMove} onPointerUp={() => setDrag(null)} data-tip="The whole clip — drag the box to look at another part">
              <canvas ref={overRef} className="clip-ed-canvas" />
              <div className="clip-ed-window" style={{ left: `${(view[0] / len) * 100}%`, width: `${((view[1] - view[0]) / len) * 100}%` }} />
            </div>
          )}

          {clipWords.length > 0 && !recording && (
            <ClipWords words={clipWords} sel={sel} onSelect={(r) => setSel(r)} onSeek={(t) => seek(t)} onHead={setWordHead} />
          )}

          <div className="clip-ed-row">
            <button
              className="clip-ed-play"
              onClick={toggle}
              onMouseDown={(e) => e.preventDefault()}
              disabled={!rec || busy}
              aria-label={playing ? 'Pause' : 'Play'}
              data-tip={playing ? 'Pause (Space)' : 'Play (Space)'}
            >
              {playing ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <rect x="6" y="5" width="4" height="14" rx="1" />
                  <rect x="14" y="5" width="4" height="14" rx="1" />
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M8 5.5v13l10.5-6.5z" />
                </svg>
              )}
            </button>
            {/* Record another take: it goes on the end as a section of its own. */}
            <button
              className={'clip-ed-rec' + (recording ? ' is-on' : '')}
              onClick={() => void (recording ? stopRecording() : startRecording())}
              onMouseDown={(e) => e.preventDefault()}
              disabled={!rec || saving}
              aria-label={recording ? 'Stop recording' : 'Record another take'}
              data-tip={recording ? 'Stop recording (Space)' : 'Record another take — it goes on the end'}
            >
              {recording ? (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <rect x="5" y="5" width="14" height="14" rx="2" />
                </svg>
              ) : (
                <Icon name="mic" className="h-4 w-4" />
              )}
            </button>
            <span className="clip-ed-time">
              <span ref={timeRef}>{fmt(head.current)}</span> <em>/ {fmt(recording ? len + recNow : len)}</em>
            </span>
            <div className="clip-ed-tools">
              {/* One job each, in plain words (Reuben, 2026-11-05: "its confusing,
                  figure it out" — a Cut that split at the playhead did what Split
                  here did). Split cuts the clip in two where the playhead is;
                  Delete takes the selected stretch out. */}
              <Tool onClick={doSplit} disabled={!rec || busy} hint="S" tip="Split the clip in two at the playhead">
                Split
              </Tool>
              <Tool onClick={deleteSel} disabled={!hasSel || busy} hint={IS_MAC ? '⌫' : 'Del'} tip="Take the selected stretch out">
                Delete
              </Tool>
              <Tool onClick={doKeep} disabled={!hasSel || busy}>
                Keep only this
              </Tool>
              <Tool onClick={doSilences} disabled={!rec || busy}>
                Remove silences
              </Tool>
              <Tool onClick={undo} disabled={!past.length || busy} hint={MOD_LABEL}>
                Undo
              </Tool>
            </div>
            <label className="clip-ed-zoom" data-tip={`Zoom (${IS_MAC ? '⌘' : 'Ctrl'}-click the waveform too)`}>
              <ZoomIcon plus={false} />
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={zoomLevel}
                disabled={!rec || len <= MIN_SPAN}
                aria-label="Zoom"
                onChange={(e) => zoomTo(len * Math.pow(MIN_SPAN / len, Number(e.target.value)), head.current)}
              />
              <ZoomIcon plus />
            </label>
          </div>

          <div className="clip-ed-speed border-t border-ink-300/20 pt-4">
            <span>Speed</span>
            <span className="clip-ed-ends">0.5×</span>
            <input
              type="range"
              min={0.5}
              max={2}
              step={0.05}
              value={speed}
              disabled={!rec || busy}
              aria-label="Speed"
              onChange={(e) => setSpeed(Number(e.target.value))}
            />
            <span className="clip-ed-ends">2×</span>
            <span className="clip-ed-value">{speedWords(speed)}</span>
            <span className="clip-ed-ends">The voice keeps its pitch</span>
          </div>
        </div>

        <div className="clip-ed-foot border-t border-ink-300/20 px-4 py-3">
          {asking ? (
            <>
              <span className="clip-ed-sum">Discard your changes to this clip?</span>
              <div className="flex gap-2">
                <button onClick={() => setAsking(false)} autoFocus>
                  Keep editing
                </button>
                <button className="danger" onClick={close}>
                  Discard
                </button>
              </div>
            </>
          ) : (
            <>
              <span className="clip-ed-sum">{summary}</span>
              <div className="flex gap-2">
                <button onClick={tryClose} disabled={busy}>
                  Cancel
                </button>
                <button onClick={() => void save(false)} disabled={!rec || busy}>
                  {tks > 1 ? 'Save as separate sections' : 'Save as new clip'}
                </button>
                <button className="primary" onClick={() => void save(true)} disabled={!rec || busy}>
                  Save
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function clampView(v: View | null, len: number): View | null {
  if (!v) return null
  const span = v[1] - v[0]
  if (span >= len - 1e-6) return null
  const v0 = Math.max(0, Math.min(len - span, v[0]))
  return [v0, v0 + span]
}

/** Draw clip time [v0, v1] into `canvas` from the fixed-grid bars (bars.ts):
 *  played (before `head`) dark, still to play mid-grey — the voice note's own
 *  two inks — and a take coming in (cells from `liveFrom` on) in the recorder's
 *  red. Each bar is one grid cell placed at its own time, so moving the view
 *  moves bars smoothly instead of re-measuring them (Reuben, 2026-11-05: the
 *  bars "kind of dance" while zooming or recording). */
function paint(
  canvas: HTMLCanvasElement | null,
  bars: Float32Array[] | null,
  v0: number,
  v1: number,
  ink: 'played' | 'ahead' | 'faint',
  liveFrom: number,
  small: boolean
): void {
  if (!canvas) return
  const w = canvas.clientWidth
  const h = canvas.clientHeight
  if (!w || !h) return
  const dpr = window.devicePixelRatio || 1
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr)
    canvas.height = Math.round(h * dpr)
  }
  const g = canvas.getContext('2d')
  if (!g) return
  g.setTransform(dpr, 0, 0, dpr, 0, 0)
  g.clearRect(0, 0, w, h)
  if (!bars || !bars.length || !(v1 > v0)) return
  const css = getComputedStyle(canvas)
  const colour = `rgb(${css.getPropertyValue(ink === 'played' ? '--ink-800' : ink === 'faint' ? '--ink-400' : '--ink-500').trim()})`
  const red = `rgb(${css.getPropertyValue('--clip-rec-red').trim() || '229 72 77'})`
  const pps = w / (v1 - v0)
  const bar = small ? 2 : BAR
  const pitch = small ? 3 : BAR + GAP
  const { level, mix } = gridFor(pps, pitch, bars.length, 0.5)
  // Near the switch to the next grid up, each pair of bars glides together and
  // takes on the pair's height (`mix` 0→1), so by the switch they already sit
  // as one bar — the change can't be seen. No fading: both layers half-see-
  // through looked washed out.
  const cells = bars[level]
  const parent = bars[level + 1]
  const span = CELL * 2 ** level
  const px = span * pps
  const width = Math.min(bar, Math.max(1, px * 0.6))
  const first = Math.max(0, Math.floor(v0 / span) - 1)
  const last = Math.min(cells.length, Math.ceil(v1 / span) + 1)
  const m = parent ? mix : 0
  const height = (v: number): number => Math.max(2, Math.pow(v, 0.7) * h * 0.92)
  for (let b = first; b < last; b++) {
    const own = (b + 0.5) * span
    const pair = ((b >> 1) + 0.5) * span * 2
    const centre = own + (pair - own) * m
    const bh = height(cells[b]) + (height(parent?.[b >> 1] ?? cells[b]) - height(cells[b])) * m
    g.fillStyle = b * 2 ** level >= liveFrom ? red : colour
    g.fillRect((centre - v0) * pps - width / 2, (h - bh) / 2, width, bh)
  }
}

function Ruler({ from, to }: { from: number; to: number }): React.JSX.Element {
  const span = to - from
  // A label about every 100 px of a ~1000 px waveform, on a round number.
  const steps = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600]
  const label = steps.find((s) => span / s <= 10) ?? 600
  const tick = steps[Math.max(0, steps.indexOf(label) - 2)] ?? label / 5
  const marks: React.JSX.Element[] = []
  const pct = (t: number): string => `${((t - from) / (span || 1)) * 100}%`
  for (let t = Math.ceil(from / tick) * tick; t <= to + 1e-9; t += tick) {
    const r = Math.round(t / tick) * tick
    marks.push(<b key={`k${r.toFixed(3)}`} style={{ left: pct(r) }} />)
    const isLabel = Math.abs(r / label - Math.round(r / label)) < 1e-6
    if (isLabel && r > from + span * 0.02 && r < to - span * 0.04)
      marks.push(
        <span key={`l${r.toFixed(3)}`} style={{ left: pct(r) }}>
          {label < 1 ? fmt(r) : fmt(r).replace(/\.0$/, '')}
        </span>
      )
  }
  return <div className="clip-ed-ruler">{marks}</div>
}

function Tool({
  onClick,
  disabled,
  hint,
  tip,
  children
}: {
  onClick: () => void
  disabled: boolean
  hint?: string
  tip?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button className="mini clip-ed-tool" onClick={onClick} onMouseDown={(e) => e.preventDefault()} disabled={disabled} data-tip={tip}>
      {children}
      {hint && <span className="clip-ed-kbd">{hint}</span>}
    </button>
  )
}

/** The six-dot grip every drag handle in the app draws (blockTable.ts `gripIcon`). */
function GripIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="11" height="11" aria-hidden="true">
      <g fill="currentColor">
        {[
          [9, 6],
          [9, 12],
          [9, 18],
          [15, 6],
          [15, 12],
          [15, 18]
        ].map(([cx, cy]) => (
          <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="1.6" />
        ))}
      </g>
    </svg>
  )
}

function ZoomIcon({ plus }: { plus: boolean }): React.JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d={plus ? 'M20 20l-3.5-3.5M8 11h6M11 8v6' : 'M20 20l-3.5-3.5M8 11h6'} />
    </svg>
  )
}
