import type { EditorView } from '@codemirror/view'
import {
  VOICE_DEFAULTS,
  VOICE_NAME_MAX,
  isDefaultVoice,
  normalizeVoice,
  skipWords,
  type VoiceSettings,
  type VoiceSkip
} from '../../../shared/voiceNote'
import { BOUNCE, BOUNCE_MS, motionOn } from '../tabs/tabStyles'
import { createPress } from '../organise/archivePress'
import { EMBED_SOURCE, attachDragHandle } from './attachMove'
import { sourceCaption } from './mediaSource'
import { playerFor, type VoicePlayer } from './voicePlayer'
import {
  SLIDER,
  ZOOM_MIN_SECONDS,
  clockTime,
  createPanGesture,
  fileNameOf,
  followPlayhead,
  panBy,
  recordingName,
  sliderFromValue,
  speedLabel,
  stripAt,
  timeReadout,
  toneLabel,
  valueFromSlider,
  volumeLabel,
  zoomAt,
  type ZoomWindow
} from './voiceMixer'
import { BARS, ENVELOPE_PER_SECOND, barsFor } from './voiceWave'

// The voice note block as drawn in the note: plain DOM, built once per widget
// and kept up to date from its player (voicePlayer.ts) — not React, for the
// same reason the video and table widgets aren't: CodeMirror owns this DOM and
// throws it away whenever it likes.
//
// One row, the full width of the text column (Reuben, 2026-10-13):
//
//   [▶]  ▁▃▅▇▅▃▁▂▅▇▆▃▁ … waveform, click or drag to seek …   0:12  [↺10] [↻10] [≡]
//
// The waveform's played part turns stronger as it plays. The last button opens
// the mixer underneath — Volume, Tone, Speed — whose settings are written onto
// the voice note's own line when a slider is let go (audioPass.ts does the
// writing; this only reports what was chosen).
//
// Added 2026-10-14 (Reuben): play/pause presses in and bounces back (since
// 2026-10-27 a squeeze toward its centre, organise/archivePress.ts) while its
// icon morphs between the two shapes; Cmd-click on the waveform (Ctrl-click
// off a Mac) zooms in where you click and Cmd+Shift-click zooms back out;
// each skip button is set on its own by right-clicking it (5 s to a minute);
// and the mixer slides open and shut the way a new note grows into the sidebar.
//
// The six-dot grip sits in the line's gutter, where every line's grip is, so
// nothing in the row is covered; while the pointer is on the block the gutter's
// own line grip steps aside for it (app.css, VOICE NOTE BLOCK).

export interface VoiceBlockProps {
  /** the target exactly as written in the note */
  src: string
  /** the vault file it resolves to; null for anything that is not one — a web
   *  address, a file: path, a path out of the vault — which is never fetched */
  rel: string | null
  /** the mixer settings written on the line */
  settings: VoiceSettings
  /** the name written on the line, '' for none — shown above the player */
  name: string
  /** the grip has selected it as one object: ring it */
  selected: boolean
  /** the eye is on: this source goes under the block */
  source: string | null
  /** how far the two skip buttons jump — the app's setting (shared/settings.ts) */
  skip: VoiceSkip
}

export interface VoiceBlockActions {
  /** Write these settings onto the voice note's line (a slider let go, Reset). */
  commit(settings: VoiceSettings): void
  /** Convert a recording the player can't play, save the copy and point the line at it. */
  makePlayable(): Promise<void>
  /** Hand the recording to whatever the computer plays it with. */
  openElsewhere(): void
  /** A skip button was right-clicked: offer its five choices at that point. */
  skipMenu(side: keyof VoiceSkip, x: number, y: number): void
  /** Write this name onto the voice note's line ('' takes it off). */
  rename(name: string): void
  /** The block was right-clicked, or its grip clicked while selected: offer
   *  "Name voice note…" at that point. */
  menu(x: number, y: number): void
}

/** The block behind a widget's DOM — how `updateDOM` and `destroy` find it. */
const blocks = new WeakMap<HTMLElement, VoiceBlock>()
export const blockOf = (dom: HTMLElement): VoiceBlock | undefined => blocks.get(dom)

/** Which recordings have their mixer open, so a block drawn again (scrolled
 *  back into view, its own setting just written) opens the way it was left. */
const openMixers = new Set<string>()
/** …and how far each is zoomed in, for the same reason. */
const zooms = new Map<string, ZoomWindow>()

/** The height bars are drawn at before a waveform has been read, or when there
 *  will never be one (a recording too long to decode). */
const FLAT = 0.22

/** Cmd on a Mac, Ctrl elsewhere — Ctrl-click on a Mac is a right-click. */
const IS_MAC = typeof navigator !== 'undefined' && /Mac/.test(navigator.userAgent)
const zoomKey = (e: { metaKey: boolean; ctrlKey: boolean }): boolean => (IS_MAC ? e.metaKey : e.ctrlKey)

/** The mixer's slide: open on the sidebar's new-note bounce and speed
 *  (organise/arrivals.ts, tabs/tabStyles.ts), shut quicker — leaving is faster
 *  than arriving — and the fade on its own gentler curve, so the bounce moves
 *  the row and never the opacity. */
const MIXER_SHUT_MS = 220
const MIXER_SHUT_EASE = 'cubic-bezier(0.4, 0, 1, 1)'
const FADE_IN = { duration: 240, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' }
// Held at 0 once done: the height is still closing after it.
const FADE_OUT: KeyframeAnimationOptions = { duration: 150, easing: 'linear', fill: 'forwards' }

let ids = 0

const sameSettings = (a: VoiceSettings, b: VoiceSettings): boolean =>
  a.volume === b.volume && a.tone === b.tone && a.speed === b.speed

// On a Lined or Worn page each line sits on a rule, which only holds if the
// block is a whole number of rules tall. Same mechanism as a formula's
// (ruleSnap.ts): its height goes to CSS as --snap-h, and app.css rounds it up
// and pads the difference. Its own observer, because ruleSnap watches formulas.
// Not while the mixer slides: that sets the block's last height itself, at the
// start, and moves the padding with the slide (`slideMixer`).
const snap =
  typeof ResizeObserver === 'undefined'
    ? null
    : new ResizeObserver((entries) => {
        for (const e of entries) {
          const el = e.target as HTMLElement
          if (el.dataset.sliding) continue
          el.style.setProperty('--snap-h', `${e.contentRect.height}px`)
        }
      })

export class VoiceBlock {
  readonly dom: HTMLElement
  props: VoiceBlockProps

  private player: VoicePlayer | null = null
  private unsubscribe: (() => void) | null = null
  /** what the mixer says right now — ahead of the note while a slider is held */
  private live: VoiceSettings
  /** the mixer slider being dragged, which the note must not move under the pointer */
  private held: keyof VoiceSettings | null = null
  /** the waveform is being dragged: playback must not move it back */
  private seeking = false
  private destroyed = false
  private caption: HTMLElement | null = null
  /** the name above the player, and the box it is typed into */
  private readonly nameEl: HTMLElement
  private nameInput: HTMLInputElement | null = null
  /** the stretch of the recording across the waveform; null is all of it */
  private zoom: ZoomWindow | null = null
  /** where playback was at the last frame — a change while paused is a skip
   *  or a seek, which a zoomed-in window comes round to; a zoom alone never is */
  private lastPosition = -1
  /** pressed on since the last press anywhere else: a sideways scroll over it
   *  moves a zoomed-in waveform (Reuben, 2026-10-15). One only passing under the
   *  pointer never takes the scroll, so a swipe across it still changes space. */
  private engaged = false
  /** scrolled sideways while playing: it stays where it was put until the
   *  playhead comes through its middle, a pause, a skip or a seek */
  private panned = false
  private readonly panGesture = createPanGesture()
  /** the mixer as it was last shown, and the slide moving it, if one is */
  private mixerOpen = false
  private slide: { open: boolean; anims: Animation[] } | null = null
  private readonly press = createPress('squeeze')

  private readonly controls: HTMLElement
  private readonly playBtn: HTMLButtonElement
  private readonly waveBox: HTMLElement
  private readonly baseRow: HTMLElement
  private readonly litRow: HTMLElement
  private readonly baseBars: HTMLElement[] = []
  private readonly litBars: HTMLElement[] = []
  private readonly zoomWin: HTMLElement
  private readonly seek: HTMLInputElement
  private readonly time: HTMLElement
  private readonly backBtn: HTMLButtonElement
  private readonly fwdBtn: HTMLButtonElement
  private readonly backNum: SVGElement
  private readonly fwdNum: SVGElement
  private readonly mixBtn: HTMLButtonElement
  private readonly alert: HTMLElement
  private readonly alertMsg: HTMLElement
  private readonly alertActions: HTMLElement
  private readonly copyBtn: HTMLButtonElement
  private readonly openBtn: HTMLButtonElement
  private readonly mixer: HTMLElement
  private readonly sliders = {} as Record<keyof VoiceSettings, { input: HTMLInputElement; out: HTMLElement }>

  /** what is on screen, so a frame only touches what changed */
  private shown = {
    state: '',
    playing: false,
    pct: -1,
    time: '',
    valueText: '',
    min: -1,
    max: -1,
    shift: -1,
    first: -1,
    slot: -1,
    envelope: undefined as Float32Array | null | undefined,
    zoomLeft: -1,
    zoomWidth: -1,
    back: 0,
    forward: 0
  }

  constructor(
    private readonly view: EditorView,
    props: VoiceBlockProps,
    private readonly actions: VoiceBlockActions
  ) {
    this.props = props
    this.live = { ...props.settings }

    const root = el('span', 'cm-voice')
    root.setAttribute('role', 'group')
    root.setAttribute('aria-label', `Voice note: ${props.name || recordingName(props.src)}`)
    if (props.selected) root.classList.add('cm-attach-selected')
    this.dom = root
    blocks.set(root, this)
    root.addEventListener('pointerdown', this.engage, true)

    // Its name, when it has one (Reuben, 2026-10-16) — above the player, where
    // the box to type it into opens too (`startNaming`).
    this.nameEl = el('span', 'cm-voice-name')
    root.appendChild(this.nameEl)
    // Right-click anywhere on it: name it. The skip buttons keep their own menu.
    root.addEventListener('contextmenu', (e) => {
      if (e.target === this.nameInput) return
      e.preventDefault()
      this.actions.menu(e.clientX, e.clientY)
    })

    const row = el('span', 'cm-voice-row')
    // The grip: select (click), move (drag, into another pane too) and delete
    // (Backspace once selected) the voice note as one thing — attachMove's. A
    // click on it once it is ALREADY selected opens the name menu beside it.
    const grip: HTMLElement = attachDragHandle(view, {
      ...EMBED_SOURCE,
      onClick: (v, pos, range) => {
        if (!this.props.selected) return EMBED_SOURCE.onClick?.(v, pos, range)
        const r = grip.getBoundingClientRect()
        this.actions.menu(r.left, r.bottom + 4)
      }
    })
    row.appendChild(grip)

    // --- the player ---------------------------------------------------------
    this.controls = el('span', 'cm-voice-controls')

    // Play/pause: one icon whose two shapes morph into each other (app.css
    // moves the paths), on a button that presses in and bounces back.
    this.playBtn = button('cm-voice-play', 'Play')
    this.playBtn.appendChild(playPauseIcon())
    this.playBtn.addEventListener('pointerdown', (e) => {
      if (e.button === 0 && !this.playBtn.disabled) this.press.down(this.playBtn, e.clientX, e.clientY)
    })
    for (const type of ['pointerup', 'pointerleave', 'pointercancel'] as const) {
      this.playBtn.addEventListener(type, () => this.press.up(this.playBtn))
    }
    this.playBtn.addEventListener('click', (e) => {
      const p = this.player
      if (!p) return
      if (e.detail === 0) this.press.key(this.playBtn) // Enter or Space
      if (p.playing) p.pause()
      else void p.play(this.live)
    })

    // The waveform: two identical rows of bars, the second in the stronger
    // colour and clipped to how far it has played — one property per frame,
    // and the bar playing right now is partly filled for free. Each row holds
    // one bar more than shows, so a zoomed-in stretch can slide (`stripAt`). On
    // top, an invisible range input the size of the waveform: clicking or
    // dragging it seeks, Cmd/Ctrl-clicking it zooms, and it is the keyboard's
    // way in (arrows, Page Up/Down, Home/End).
    this.waveBox = el('span', 'cm-voice-wavebox')
    this.baseRow = el('span', 'cm-voice-wave')
    this.litRow = el('span', 'cm-voice-wave cm-voice-wave-played')
    this.baseRow.setAttribute('aria-hidden', 'true')
    this.litRow.setAttribute('aria-hidden', 'true')
    for (let i = 0; i <= BARS; i++) {
      this.baseBars.push(this.baseRow.appendChild(el('i')))
      this.litBars.push(this.litRow.appendChild(el('i')))
    }
    this.litRow.style.clipPath = 'inset(0 100% 0 0)'
    // Where a zoomed-in stretch sits in the whole recording: a hairline under
    // the bars, there only while zoomed.
    const zoomBar = el('span', 'cm-voice-zoombar')
    zoomBar.setAttribute('aria-hidden', 'true')
    this.zoomWin = zoomBar.appendChild(el('span', 'cm-voice-zoomwin'))
    this.seek = el('input', 'cm-voice-seek')
    this.seek.type = 'range'
    this.seek.min = '0'
    this.seek.max = '0'
    this.seek.step = 'any'
    this.seek.value = '0'
    this.seek.setAttribute('aria-label', 'Playback position')
    const doneSeeking = (): void => {
      this.seeking = false
      this.render()
    }
    this.seek.addEventListener('pointerdown', (e) => {
      if (zoomKey(e) && e.button === 0) {
        // A zoom, not a seek: the slider must not jump to where it was clicked.
        e.preventDefault()
        this.zoomBy(e.clientX, e.shiftKey ? -1 : 1)
        this.zoomCursor(e)
        return
      }
      this.seeking = true
      // A click on the spot already playing moves nothing and fires no
      // 'change' — the release must end the seek all the same (as the mixer's
      // sliders do), or the position under the keyboard stops following playback.
      window.addEventListener('pointerup', doneSeeking, { once: true })
    })
    this.seek.addEventListener('change', doneSeeking)
    this.seek.addEventListener('pointercancel', doneSeeking)
    this.seek.addEventListener('input', () => {
      this.panned = false
      this.player?.seek(Number(this.seek.value))
      this.render()
    })
    // The pointer turns into a magnifier while Cmd/Ctrl is held over it.
    this.waveBox.addEventListener('pointerenter', (e) => {
      this.zoomCursor(e)
      window.addEventListener('keydown', this.zoomCursor)
      window.addEventListener('keyup', this.zoomCursor)
    })
    this.waveBox.addEventListener('pointermove', this.zoomCursor)
    this.waveBox.addEventListener('pointerleave', this.endZoomCursor)
    // The rows are one bar wider than the box; the strip clips them to it.
    const strip = el('span', 'cm-voice-strip')
    strip.append(this.baseRow, this.litRow)
    this.waveBox.append(strip, zoomBar, this.seek)

    this.time = el('span', 'cm-voice-time')

    // Right-click either one to set how far it jumps (the app remembers it).
    const back = skipIcon(false)
    const fwd = skipIcon(true)
    this.backNum = back.num
    this.fwdNum = fwd.num
    this.backBtn = button('cm-voice-icon', '')
    this.backBtn.appendChild(back.svg)
    this.backBtn.addEventListener('click', () => {
      this.panned = false
      this.player?.skip(-this.props.skip.back)
    })
    this.fwdBtn = button('cm-voice-icon', '')
    this.fwdBtn.appendChild(fwd.svg)
    this.fwdBtn.addEventListener('click', () => {
      this.panned = false
      this.player?.skip(this.props.skip.forward)
    })
    for (const [btn, side] of [
      [this.backBtn, 'back'],
      [this.fwdBtn, 'forward']
    ] as const) {
      btn.addEventListener('contextmenu', (e) => {
        e.preventDefault()
        e.stopPropagation()
        this.actions.skipMenu(side, e.clientX, e.clientY)
      })
    }

    const mixerId = `cm-voice-mixer-${++ids}`
    this.mixBtn = button('cm-voice-icon cm-voice-mixbtn', 'Mixer')
    this.mixBtn.setAttribute('aria-controls', mixerId)
    this.mixBtn.setAttribute('aria-expanded', 'false')
    this.mixBtn.appendChild(slidersIcon())
    this.mixBtn.addEventListener('click', () => {
      if (openMixers.has(this.key)) openMixers.delete(this.key)
      else openMixers.add(this.key)
      this.renderMixer(true)
    })

    this.controls.append(this.playBtn, this.waveBox, this.time, this.backBtn, this.fwdBtn, this.mixBtn)

    // --- when it can't play -------------------------------------------------
    this.alert = el('span', 'cm-voice-alert')
    this.alert.hidden = true
    this.alert.appendChild(micIcon())
    this.alertMsg = el('span', 'cm-voice-alert-msg')
    this.alertActions = el('span', 'cm-voice-alert-actions')
    this.copyBtn = textButton('Make a playable copy')
    this.copyBtn.setAttribute('data-tip', 'Saves a copy this app can play beside the note, and plays that')
    this.copyBtn.addEventListener('click', () => {
      if (this.copyBtn.disabled) return
      this.setBusy(true)
      void this.actions.makePlayable().finally(() => this.setBusy(false))
    })
    this.openBtn = textButton('Open in its own app')
    this.openBtn.addEventListener('click', () => this.actions.openElsewhere())
    this.alertActions.append(this.copyBtn, this.openBtn)
    this.alert.append(this.alertMsg, this.alertActions)

    row.append(this.controls, this.alert)
    root.appendChild(row)

    // --- the mixer --------------------------------------------------------------
    this.mixer = el('span', 'cm-voice-mixer')
    this.mixer.id = mixerId
    this.mixer.hidden = true
    this.mixer.append(
      this.slider('volume', 'Volume'),
      this.slider('tone', 'Tone', ['Warmer', 'Brighter']),
      this.slider('speed', 'Speed')
    )
    const reset = textButton('Reset')
    reset.classList.add('cm-voice-reset')
    reset.addEventListener('click', () => {
      this.live = { ...VOICE_DEFAULTS }
      this.player?.apply(this.live)
      this.renderSliders()
      this.renderMixer()
      this.actions.commit(this.live)
    })
    this.mixer.appendChild(reset)
    root.appendChild(this.mixer)

    if (props.source) this.setCaption(props.source)
    this.renderName()

    this.zoom = zooms.get(this.key) ?? null
    snap?.observe(root)
    this.attach()
    this.drawBars(null)
    this.renderSkip()
    this.renderSliders()
    this.render()
  }

  /** The widget was redrawn for the same recording with something else changed
   *  — its settings (just written by its own slider, or by an undo, or by
   *  another app), its selection ring, the eye, the skip buttons' setting. The
   *  element and the playback carry on; only what changed is touched. */
  update(next: VoiceBlockProps): void {
    const prev = this.props
    this.props = next
    this.dom.classList.toggle('cm-attach-selected', next.selected)
    if (!sameSettings(prev.settings, next.settings) && this.held === null) {
      this.live = { ...next.settings }
      const p = this.player
      if (p && !sameSettings(p.settings, this.live)) p.apply(this.live)
    }
    if (next.source !== prev.source) this.setCaption(next.source)
    if (next.name !== prev.name) {
      if (this.player) this.player.label = next.name
      this.dom.setAttribute('aria-label', `Voice note: ${next.name || recordingName(next.src)}`)
      this.renderName()
    }
    this.renderSkip()
    this.renderSliders()
    this.render()
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.unsubscribe?.()
    this.unsubscribe = null
    this.player?.unmount()
    this.player = null
    this.endZoomCursor()
    this.dom.removeEventListener('wheel', this.onWheel)
    window.removeEventListener('pointerdown', this.letGo, true)
    snap?.unobserve(this.dom)
  }

  /** Open the box to type its name into, holding the name it has. Enter or
   *  clicking away keeps what was typed; Escape leaves it as it was. */
  startNaming(): void {
    if (this.destroyed || this.nameInput) return
    const input = el('input', 'cm-voice-name-input')
    input.type = 'text'
    input.value = this.props.name
    input.placeholder = 'Name this voice note'
    input.maxLength = VOICE_NAME_MAX
    input.setAttribute('aria-label', 'Voice note name')
    input.spellcheck = false
    this.nameInput = input
    let done = false
    const finish = (keep: boolean): void => {
      if (done) return
      done = true
      const value = input.value
      this.nameInput = null
      this.renderName()
      if (keep) this.actions.rename(value)
      this.view.focus()
    }
    input.addEventListener('keydown', (e) => {
      e.stopPropagation()
      if (e.key === 'Enter') {
        e.preventDefault()
        finish(true)
      } else if (e.key === 'Escape') {
        e.preventDefault()
        finish(false)
      }
    })
    input.addEventListener('blur', () => finish(true))
    this.nameEl.replaceChildren(input)
    this.nameEl.hidden = false
    this.view.requestMeasure()
    input.focus()
    input.select()
  }

  /** The name above the player, or nothing — unless its box is open. */
  private renderName(): void {
    if (this.nameInput) return
    this.nameEl.textContent = this.props.name
    this.nameEl.hidden = this.props.name === ''
    this.view.requestMeasure()
  }

  /** Disable the two buttons while a playable copy is being made. */
  setBusy(on: boolean): void {
    this.copyBtn.disabled = on
    this.openBtn.disabled = on
    this.copyBtn.textContent = on ? 'Making a copy…' : 'Make a playable copy'
  }

  // --- inside ------------------------------------------------------------------

  /** What the mixer's open/closed memory and the zoom are keyed by. */
  private get key(): string {
    return this.props.rel ?? this.props.src
  }

  private attach(): void {
    const rel = this.props.rel
    if (!rel) return
    const p = playerFor(rel)
    this.player = p
    p.mount(this.view)
    p.label = this.props.name
    // The note's settings, ready for the next play — unless it is already
    // playing (scrolled back into view mid-play), when nothing should change.
    if (!p.playing) p.apply(this.live)
    this.unsubscribe = p.subscribe(() => this.onPlayer())
  }

  private onPlayer(): void {
    if (this.player?.released) {
      // The vault switched under a block still on screen: start again with a
      // fresh player rather than hold on to a dead one.
      this.unsubscribe?.()
      this.unsubscribe = null
      this.player = null
      if (!this.destroyed && this.dom.isConnected) this.attach()
    }
    this.render()
  }

  private setCaption(source: string | null): void {
    this.caption?.remove()
    this.caption = null
    if (source) {
      this.caption = sourceCaption(source, this.view)
      this.dom.appendChild(this.caption)
    }
    this.view.requestMeasure()
  }

  // --- zoom ----------------------------------------------------------------------

  /** Zoom in (1) or out (-1) on the moment under `clientX`. */
  private zoomBy(clientX: number, dir: 1 | -1): void {
    const duration = this.player?.duration
    if (!duration || this.dom.dataset.state !== 'ready') return
    const box = this.waveBox.getBoundingClientRect()
    const cur = this.zoom
    const start = cur ? cur.start : 0
    const span = cur ? cur.span : duration
    const at = start + (box.width > 0 ? (clientX - box.left) / box.width : 0) * span
    this.setZoom(zoomAt(cur, at, dir, duration))
    this.render()
  }

  /** Listening for the wheel only while pressed on: a wheel listener that may
   *  stop the scroll makes every scroll over it wait for the page, so a voice
   *  note nobody has pressed on must not have one. */
  private engage = (): void => {
    if (this.engaged) return
    this.engaged = true
    this.dom.addEventListener('wheel', this.onWheel, { passive: false })
    window.addEventListener('pointerdown', this.letGo, true)
  }

  private letGo = (e: PointerEvent): void => {
    if (e.target instanceof Node && this.dom.contains(e.target)) return
    this.engaged = false
    this.dom.removeEventListener('wheel', this.onWheel)
    window.removeEventListener('pointerdown', this.letGo, true)
  }

  /** A sideways scroll — two fingers on a trackpad, a mouse's sideways wheel or
   *  Shift+wheel — over a zoomed-in waveform that was pressed on moves along the
   *  recording. Up and down is left to the note. Taking it calls preventDefault,
   *  which is also what tells App's two space-changing gestures to leave it be. */
  private onWheel = (e: WheelEvent): void => {
    const win = this.zoom
    const duration = this.player?.duration
    if (!this.engaged || !win || !duration || e.ctrlKey || e.metaKey || e.altKey) return
    const px = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1 // lines/pages → px
    let dx = e.deltaX * px
    let dy = e.deltaY * px
    if (e.shiftKey && dx === 0) {
      // Shift+wheel on a mouse arrives as up/down on Windows (the Mac turns it sideways itself).
      dx = dy
      dy = 0
    }
    const axis = this.panGesture(dx, dy, e.timeStamp)
    if (axis === 'y') return
    // Taken while it is still undecided too: Chromium lets the later events of a
    // gesture be stopped only if its first one was.
    e.preventDefault()
    if (axis !== 'x') return
    const next = panBy(win, dx, this.waveBox.getBoundingClientRect().width, duration)
    if (next === win) return
    if (this.player?.playing) this.panned = true
    this.setZoom(next)
    this.render()
  }

  private setZoom(z: ZoomWindow | null): void {
    this.zoom = z
    if (z) zooms.set(this.key, z)
    else zooms.delete(this.key)
  }

  /** The magnifier cursor, in or out, while Cmd/Ctrl is held over the waveform.
   *  On the closest view it is the out one: the next click goes back to the whole. */
  private zoomCursor = (e: { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean }): void => {
    const d = this.player?.duration ?? 0
    const ready = this.dom.dataset.state === 'ready'
    const on = ready && zoomKey(e)
    const canIn = d > ZOOM_MIN_SECONDS && (!this.zoom || this.zoom.span > ZOOM_MIN_SECONDS)
    this.waveBox.classList.toggle('zoom-in', on && !e.shiftKey && canIn)
    this.waveBox.classList.toggle('zoom-out', on && this.zoom !== null && (e.shiftKey || !canIn))
  }

  private endZoomCursor = (): void => {
    window.removeEventListener('keydown', this.zoomCursor)
    window.removeEventListener('keyup', this.zoomCursor)
    this.waveBox.classList.remove('zoom-in', 'zoom-out')
  }

  // --- the skip buttons ------------------------------------------------------------

  private renderSkip(): void {
    const { back, forward } = this.props.skip
    const s = this.shown
    if (back !== s.back) {
      s.back = back
      this.backNum.textContent = String(back)
      this.backBtn.setAttribute('aria-label', `Back ${skipWords(back)}`)
    }
    if (forward !== s.forward) {
      s.forward = forward
      this.fwdNum.textContent = String(forward)
      this.fwdBtn.setAttribute('aria-label', `Forward ${skipWords(forward)}`)
    }
  }

  // --- the mixer ---------------------------------------------------------------------

  private slider(key: keyof VoiceSettings, label: string, ends?: [string, string]): HTMLElement {
    const wrap = el('span', 'cm-voice-ctl')
    const head = el('span', 'cm-voice-ctl-head')
    const out = el('span', 'cm-voice-ctl-value')
    head.append(el('span', 'cm-voice-ctl-name', label), out)
    const input = el('input')
    input.type = 'range'
    input.min = String(SLIDER[key].min)
    input.max = String(SLIDER[key].max)
    input.step = String(SLIDER[key].step)
    input.setAttribute('aria-label', label)
    input.addEventListener('pointerdown', () => {
      this.held = key
      // A press that moves nothing fires no 'change', so let go on the release
      // itself (wherever the pointer is by then) — or the slider stays pinned
      // where it was through a Reset (measured 2026-10-14: 150% shown, 100% heard).
      window.addEventListener(
        'pointerup',
        () => {
          if (this.held === key) this.held = null
        },
        { once: true }
      )
    })
    // Heard at once, while dragging…
    input.addEventListener('input', () => {
      this.live = { ...this.live, [key]: valueFromSlider(key, Number(input.value)) }
      this.player?.apply(this.live)
      this.renderSliders()
      this.renderMixer()
    })
    // …and written into the note once, when it is let go.
    input.addEventListener('change', () => {
      this.held = null
      this.actions.commit(this.live)
    })
    input.addEventListener('pointercancel', () => {
      this.held = null
    })
    wrap.append(head, input)
    if (ends) {
      const row = el('span', 'cm-voice-ctl-ends')
      row.setAttribute('aria-hidden', 'true')
      row.append(el('span', '', ends[0]), el('span', '', ends[1]))
      wrap.appendChild(row)
    }
    this.sliders[key] = { input, out }
    return wrap
  }

  private renderSliders(): void {
    const labels: Record<keyof VoiceSettings, (n: number) => string> = {
      volume: volumeLabel,
      tone: toneLabel,
      speed: speedLabel
    }
    for (const key of ['volume', 'tone', 'speed'] as const) {
      const { input, out } = this.sliders[key]
      if (key !== this.held) input.value = String(sliderFromValue(key, this.live[key]))
      const text = labels[key](this.live[key])
      out.textContent = text
      input.setAttribute('aria-valuetext', text)
    }
  }

  /** The mixer row and its button. The button carries a dot while this voice
   *  note plays with anything other than the defaults, so a changed one is
   *  visible with the mixer shut. `animate`: the mixer button was pressed, so
   *  the row slides; every other change (a redraw, a recording that can't
   *  play) just shows it as it is. */
  private renderMixer(animate = false): void {
    const state = this.dom.dataset.state
    const open = openMixers.has(this.key) && (state === 'ready' || state === 'loading')
    if (open !== this.mixerOpen) {
      this.mixerOpen = open
      if (animate && motionOn() && this.dom.isConnected) this.slideMixer(open)
      else {
        this.endSlide()
        this.mixer.hidden = !open
        this.view.requestMeasure()
      }
    }
    this.mixBtn.setAttribute('aria-expanded', String(open))
    this.mixBtn.classList.toggle('on', open)
    this.mixBtn.classList.toggle('changed', !isDefaultVoice(normalizeVoice(this.live)))
  }

  /** The mixer slides open — its height opening on the sidebar's new-note
   *  bounce, its contents fading in — or slides shut, quicker. On a Lined or
   *  Worn page the block's own padding moves with it, from a whole number of
   *  rules to the next (the snap's padding), so nothing jumps at either end. A
   *  press mid-slide turns it round from wherever it has got to. */
  private slideMixer(open: boolean): void {
    if (this.slide) {
      if (this.slide.open !== open) {
        for (const a of this.slide.anims) a.reverse()
        this.slide.open = open
      }
      return
    }
    const m = this.mixer
    const root = this.dom
    const rootCs = getComputedStyle(root)
    const padFrom = [parseFloat(rootCs.paddingTop) || 0, parseFloat(rootCs.paddingBottom) || 0]
    m.hidden = false
    const cs = getComputedStyle(m)
    const full: Keyframe = {
      height: `${m.getBoundingClientRect().height}px`,
      paddingTop: cs.paddingTop,
      paddingBottom: cs.paddingBottom,
      marginTop: cs.marginTop,
      borderTopWidth: cs.borderTopWidth
    }
    const shut: Keyframe = { height: '0px', paddingTop: '0px', paddingBottom: '0px', marginTop: '0px', borderTopWidth: '0px' }
    const mixerOuter = m.getBoundingClientRect().height + (parseFloat(cs.marginTop) || 0)
    // The block's height once this is over, given to the snap now, so its
    // padding can travel with the slide instead of jumping at the end.
    const rootH = root.getBoundingClientRect().height
    const contentAfter = rootH - padFrom[0] - padFrom[1] - (open ? 0 : mixerOuter)
    root.dataset.sliding = '1'
    root.style.setProperty('--snap-h', `${contentAfter}px`)
    const padCs = getComputedStyle(root)
    const padTo = [parseFloat(padCs.paddingTop) || 0, parseFloat(padCs.paddingBottom) || 0]
    m.style.overflow = 'hidden'

    const timing = open
      ? { duration: BOUNCE_MS, easing: BOUNCE }
      : { duration: MIXER_SHUT_MS, easing: MIXER_SHUT_EASE }
    const anims = [
      m.animate(open ? [shut, full] : [full, shut], timing),
      m.animate(open ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 1 }, { opacity: 0 }], open ? FADE_IN : FADE_OUT)
    ]
    if (padFrom[0] !== padTo[0] || padFrom[1] !== padTo[1]) {
      anims.push(
        root.animate(
          [
            { paddingTop: `${padFrom[0]}px`, paddingBottom: `${padFrom[1]}px` },
            { paddingTop: `${padTo[0]}px`, paddingBottom: `${padTo[1]}px` }
          ],
          timing
        )
      )
    }
    const slide = { open, anims }
    this.slide = slide
    // Done when the height is: the fade may finish first, and a turned-round
    // slide ends at its start, so `slide.open` says which way it ended.
    void anims[0].finished.then(
      () => {
        if (this.slide !== slide) return
        this.endSlide()
        m.hidden = !slide.open
        if (slide.open !== open) {
          // turned round: the snap was given the other end's height
          root.style.setProperty('--snap-h', `${root.getBoundingClientRect().height - padTo[0] - padTo[1]}px`)
        }
        this.view.requestMeasure()
      },
      () => undefined
    )
  }

  /** Stop any slide, leaving the mixer as its own rules draw it. */
  private endSlide(): void {
    const slide = this.slide
    this.slide = null
    if (slide) for (const a of slide.anims) a.cancel()
    this.mixer.style.overflow = ''
    delete this.dom.dataset.sliding
  }

  // --- drawing -------------------------------------------------------------------------

  /** Each bar's height, 0–1 of the row; 0 is no bar at all (past the end of
   *  the recording), null is the flat row drawn before there is a waveform. */
  private drawBars(values: number[] | null): void {
    for (let i = 0; i <= BARS; i++) {
      const v = values ? (values[i] ?? 0) : FLAT
      const h = v > 0 ? `${Math.round(v * 100)}%` : '0px'
      const vis = v > 0 ? '' : 'hidden'
      this.baseBars[i].style.height = h
      this.litBars[i].style.height = h
      this.baseBars[i].style.visibility = vis
      this.litBars[i].style.visibility = vis
    }
  }

  /** Bring the block in line with its player. Runs every frame while playing,
   *  so everything here compares before it writes. */
  private render(): void {
    if (this.destroyed) return
    const p = this.player
    const state = this.props.rel === null ? 'missing' : (p?.state ?? 'loading')
    const s = this.shown

    if (state !== s.state) {
      s.state = state
      this.dom.dataset.state = state
      const failed = state === 'missing' || state === 'unplayable'
      this.controls.hidden = failed
      this.alert.hidden = !failed
      this.alertMsg.textContent =
        state === 'missing'
          ? `Recording not found: ${fileNameOf(this.props.src)}`
          : state === 'unplayable'
            ? 'This recording can’t be played here'
            : ''
      this.alertActions.hidden = state !== 'unplayable'
      const ready = state === 'ready'
      this.playBtn.disabled = !ready
      this.backBtn.disabled = !ready
      this.fwdBtn.disabled = !ready
      this.renderMixer()
      this.view.requestMeasure()
    }
    if (state !== 'ready' && state !== 'loading') return

    const playing = p?.playing ?? false
    if (playing !== s.playing) {
      s.playing = playing
      this.playBtn.classList.toggle('is-playing', playing)
      this.playBtn.setAttribute('aria-label', playing ? 'Pause' : 'Play')
    }

    const duration = p?.duration ?? null
    const position = p?.position ?? 0

    // The stretch on show: all of it, or a zoomed-in window that follows the
    // playhead (never while the waveform is being dragged — what is under the
    // pointer must stay there).
    let win = this.zoom
    if (win && !(duration && duration > win.span)) {
      win = null
      this.setZoom(null)
    }
    const moved = position !== this.lastPosition
    const was = this.lastPosition
    this.lastPosition = position
    // Scrolled sideways while playing, it waits for the playhead to come
    // through its middle before following again (or a pause, skip or seek).
    if (this.panned && win) {
      const mid = win.start + win.span / 2
      if (!playing || (was < mid && position >= mid)) this.panned = false
    }
    if (win && duration && !this.seeking && !this.panned && (playing || moved)) {
      const next = followPlayhead(win, position, duration, playing)
      if (next !== win) {
        win = next
        this.setZoom(win)
      }
    }
    const start = win ? win.start : 0
    const span = win ? win.span : (duration ?? 0)
    const slot = span > 0 ? span / BARS : 0
    const { first, offset } = stripAt(start, slot)

    const envelope = p?.envelope ?? null
    if (first !== s.first || slot !== s.slot || envelope !== s.envelope) {
      s.first = first
      s.slot = slot
      s.envelope = envelope
      this.drawBars(
        envelope && slot > 0 ? barsFor(envelope, ENVELOPE_PER_SECOND, first * slot, (first + BARS + 1) * slot, BARS + 1) : null
      )
    }
    // Slide the strip by the part-slot the window has moved past its first bar.
    const shift = Math.round(((offset * 100) / (BARS + 1)) * 1000) / 1000
    if (shift !== s.shift) {
      s.shift = shift
      const t = shift ? `translateX(-${shift}%)` : ''
      this.baseRow.style.transform = t
      this.litRow.style.transform = t
    }
    // The played part, in the row's own terms (it is one bar wider than the box).
    const along = span > 0 ? (((position - start) / span) * BARS + offset) / (BARS + 1) : 0
    const pct = Math.round(Math.min(1, Math.max(0, along)) * 1000) / 10
    if (pct !== s.pct) {
      s.pct = pct
      this.litRow.style.clipPath = `inset(0 ${(100 - pct).toFixed(1)}% 0 0)`
    }
    // Where the window sits in the whole: the hairline under the bars.
    const zl = win && duration ? Math.round((win.start / duration) * 1000) / 10 : -1
    const zw = win && duration ? Math.max(1, Math.round((win.span / duration) * 1000) / 10) : -1
    if (zl !== s.zoomLeft || zw !== s.zoomWidth) {
      s.zoomLeft = zl
      s.zoomWidth = zw
      this.waveBox.classList.toggle('is-zoomed', zl >= 0)
      if (zl >= 0) {
        this.zoomWin.style.left = `${zl}%`
        this.zoomWin.style.width = `${zw}%`
      }
    }

    const time = timeReadout({ playing, position, duration })
    if (time !== s.time) {
      s.time = time
      this.time.textContent = time
    }

    // The slider under the waveform covers the stretch on show, so a click
    // lands where it points — zoomed in, a finer step for the arrow keys too.
    const min = win ? start : 0
    const max = win ? start + span : (duration ?? 0)
    if (!this.seeking && (min !== s.min || max !== s.max)) {
      s.min = min
      s.max = max
      this.seek.min = String(min)
      this.seek.max = String(max)
    }
    this.seek.disabled = state !== 'ready' || !duration
    if (!this.seeking) this.seek.value = String(position)
    const valueText = `${clockTime(position)} of ${clockTime(duration ?? 0)}`
    if (valueText !== s.valueText) {
      s.valueText = valueText
      this.seek.setAttribute('aria-valuetext', valueText)
    }
  }
}

// --- small builders -------------------------------------------------------------

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text !== undefined) e.textContent = text
  return e
}

/** An icon button. Its name is an aria-label, and deliberately not a `data-tip`
 *  as well: play, pause, the two skip arrows and the sliders say what they are,
 *  and a tooltip floating over a note reads as stray text (CLAUDE.md, "Inside
 *  the note, think twice"). */
function button(cls: string, label: string): HTMLButtonElement {
  const b = el('button', cls)
  b.type = 'button'
  if (label) b.setAttribute('aria-label', label)
  return b
}

function textButton(label: string): HTMLButtonElement {
  const b = el('button', 'cm-voice-text-btn', label)
  b.type = 'button'
  return b
}

const NS = 'http://www.w3.org/2000/svg'

/** A 24-unit icon in the app's own drawing style (icons.tsx): 1.7 strokes,
 *  round ends, `currentColor`. */
function svg(size: number): SVGSVGElement {
  const s = document.createElementNS(NS, 'svg')
  for (const [k, v] of Object.entries({
    viewBox: '0 0 24 24',
    width: String(size),
    height: String(size),
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '1.7',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true'
  })) {
    s.setAttribute(k, v)
  }
  return s
}

function part(parent: SVGElement, tag: string, attrs: Record<string, string>): SVGElement {
  const e = document.createElementNS(NS, tag)
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v)
  parent.appendChild(e)
  return e
}

/** Play and pause as ONE icon: two four-cornered shapes that are the two
 *  halves of the play triangle, or the two pause bars. Their outlines live in
 *  app.css (`.cm-voice-pp-a/-b`, a CSS `d`), so the button's `is-playing`
 *  class morphs one into the other — the browser blends two outlines of the
 *  same shape point by point. Filled, with a thin round-cornered stroke of the
 *  same colour to soften the corners. */
function playPauseIcon(): SVGSVGElement {
  const s = svg(16)
  s.setAttribute('stroke-width', '1.2')
  part(s, 'path', { class: 'cm-voice-pp-a', fill: 'currentColor' })
  part(s, 'path', { class: 'cm-voice-pp-b', fill: 'currentColor' })
  return s
}

/** A circular arrow with how far it jumps written in it — clockwise for
 *  forward, anticlockwise for back. The arc runs most of the way round a
 *  radius-8 circle and ends at the top, where the arrowhead shows which way.
 *  The number is returned too, so a new setting can change it in place. */
function skipIcon(forward: boolean): { svg: SVGSVGElement; num: SVGElement } {
  const s = svg(22)
  part(s, 'path', {
    d: forward ? 'M18.13 6.86A8 8 0 1 1 13.39 4.12' : 'M5.87 6.86A8 8 0 1 0 10.61 4.12'
  })
  part(s, 'path', { d: forward ? 'M10.85 1.23L13.39 4.12L10.02 5.96' : 'M13.15 1.23L10.61 4.12L13.98 5.96' })
  const num = part(s, 'text', {
    x: '12',
    y: '15.1',
    'text-anchor': 'middle',
    'font-size': '7.4',
    'font-weight': '600',
    fill: 'currentColor',
    stroke: 'none'
  })
  num.textContent = '10'
  return { svg: s, num }
}

/** The mixer: the same sliders icon Settings uses (icons.tsx, `sliders`). */
function slidersIcon(): SVGSVGElement {
  const s = svg(18)
  part(s, 'path', { d: 'M4 8h9M18 8h2M4 16h2M11 16h9' })
  part(s, 'circle', { cx: '15.5', cy: '8', r: '2' })
  part(s, 'circle', { cx: '8.5', cy: '16', r: '2' })
  return s
}

/** A microphone (icons.tsx, `mic`) — what stands in for the player when there
 *  is nothing it can play. */
function micIcon(): SVGSVGElement {
  const s = svg(18)
  part(s, 'rect', { x: '9', y: '3', width: '6', height: '11', rx: '3' })
  part(s, 'path', { d: 'M5.5 11a6.5 6.5 0 0 0 13 0' })
  part(s, 'path', { d: 'M12 17.5V21' })
  return s
}
