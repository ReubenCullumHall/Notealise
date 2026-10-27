import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { EditorView } from '@codemirror/view'
import { Icon } from '../icons'
import { lineOfEmbed, voiceEmbeds } from '../../../shared/attachments'
import { titleOf } from '../../../shared/links'
import {
  VOICE_DEFAULTS,
  VOICE_SKIP_DEFAULT,
  cleanVoiceName,
  parseAudioOpenTag,
  skipWords,
  type VoiceSettings,
  type VoiceSkip
} from '../../../shared/voiceNote'
import { deckPlayer, ejectDeck, onDeck, playerFor, type VoicePlayer } from '../editor/voicePlayer'
import { recordingName } from '../editor/voiceMixer'
import { flashLines } from '../editor/blockFlash'

// The tape: a small player for a note's voice notes (Reuben, 2026-10-16, after
// the media player in Arc's sidebar).
//
// Two places, one card:
// - `NoteTape` — a cassette button in the note's bottom-right corner, above the
//   eye, on any note holding a voice note. It opens the card over the corner:
//   listen from there, or ↗ to scroll to the voice note itself.
// - `SidebarDeck` — once the recording last played (voicePlayer.ts's tape) is in
//   a note that is NOT on screen, the same card sits in the sidebar's footer, so
//   it can be heard and steered from any tab. Its name row opens on hover, as in
//   Arc; ↗ goes back to the note and the voice note, × stops it.
//
// The card only steers the player the block itself uses (one player per
// recording, outside the editor), so the block, the card and the sidebar always
// agree about what is playing and where.

/** One voice note in the note: the recording it plays, its own mixer and the
 *  name it was given ('' for none). */
interface Recording {
  rel: string
  settings: VoiceSettings
  name: string
}

/** Every voice note in `text`, in order, once each. */
function recordingsIn(text: string, note: string): Recording[] {
  return voiceEmbeds(text, note).map(({ file, embed }) => {
    const tag = embed.startsWith('<') ? parseAudioOpenTag(embed) : null
    return {
      rel: file,
      settings: tag?.settings ?? { ...VOICE_DEFAULTS },
      // the markdown form keeps its name as the alt text (editor/audioPass.ts)
      name: tag ? tag.name : cleanVoiceName(/^!\[([^\]\n]*)\]/.exec(embed)?.[1] ?? '')
    }
  })
}

/** What a voice note is called on the card: its name, or its file's. */
const recLabel = (r: Recording): string => r.name || recordingName(r.rel)

/** The recording on the tape, as React state. */
function useDeck(): VoicePlayer | null {
  return useSyncExternalStore(onDeck, deckPlayer)
}

/** What the card shows of a player: re-renders on a change of state, play/pause
 *  or mute — NOT on every frame of playback, which is all the player announces
 *  while it plays. */
function usePlayback(p: VoicePlayer | null): { ready: boolean; playing: boolean; muted: boolean } {
  const subscribe = useCallback((fn: () => void) => (p ? p.subscribe(fn) : () => {}), [p])
  const key = useSyncExternalStore(subscribe, () =>
    p ? `${!p.released && p.state === 'ready' ? 1 : 0}${p.playing ? 1 : 0}${p.muted ? 1 : 0}` : '000'
  )
  return { ready: key[0] === '1', playing: key[1] === '1', muted: key[2] === '1' }
}

// --- the card ------------------------------------------------------------------

/** A button on the dark card. The base `button` rule's border and fill are
 *  cleared, as every icon button here does. */
const DECK_BTN =
  'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border-none bg-transparent p-0 text-paper/75 outline-none transition duration-150 hover:bg-paper/15 hover:text-paper focus-visible:ring-2 focus-visible:ring-paper/40 disabled:pointer-events-none disabled:opacity-40'

/** The block's skip icon (voicePlayerUi.ts `skipIcon`): a circular arrow with
 *  how far it jumps written in it. */
function SkipIcon({ forward, seconds }: { forward: boolean; seconds: number }): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      width={22}
      height={22}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={forward ? 'M18.13 6.86A8 8 0 1 1 13.39 4.12' : 'M5.87 6.86A8 8 0 1 0 10.61 4.12'} />
      <path d={forward ? 'M10.85 1.23L13.39 4.12L10.02 5.96' : 'M13.15 1.23L10.61 4.12L13.98 5.96'} />
      <text x="12" y="15.1" textAnchor="middle" fontSize="7.4" fontWeight="600" fill="currentColor" stroke="none">
        {seconds}
      </text>
    </svg>
  )
}

/** Play and pause as one icon whose two shapes morph into each other — the
 *  block's own (app.css `.cm-voice-pp-a/-b`, shared with `.deck-play`). */
function PlayPauseIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width={20} height={20} stroke="currentColor" strokeWidth={1.2} strokeLinejoin="round" aria-hidden="true">
      <path className="cm-voice-pp-a" fill="currentColor" />
      <path className="cm-voice-pp-b" fill="currentColor" />
    </svg>
  )
}

interface CardProps {
  player: VoicePlayer
  /** the voice note's own mixer, from its line — what play starts with. Asked
   *  at the press: the block's sliders may have changed it since the card opened. */
  settings: () => VoiceSettings
  skip: VoiceSkip
  /** the name row's words */
  title: string
  titleTip: string
  /** 'note': the name row always shows. 'sidebar': it opens on hover. */
  place: 'note' | 'sidebar'
  goToTip: string
  onGoTo: () => void
  closeTip: string
  onClose: () => void
  /** several voice notes in the note: the name opens a list of them */
  choices?: { rel: string; label: string }[]
  onChoose?: (rel: string) => void
}

function DeckCard(props: CardProps): React.JSX.Element {
  const { player, settings, skip, place } = props
  const { ready, playing, muted } = usePlayback(player)
  const [listOpen, setListOpen] = useState(false)
  const several = (props.choices?.length ?? 0) > 1

  const nameRow = (
    <div className="flex items-center gap-1 pl-3 pr-1.5 pt-1.5">
      {several ? (
        <button
          type="button"
          onClick={() => setListOpen((o) => !o)}
          aria-expanded={listOpen}
          data-tip={props.titleTip}
          className="flex min-w-0 flex-1 items-center gap-1 rounded-lg border-none bg-transparent p-0 text-left text-[13px] font-medium text-paper outline-none hover:text-paper focus-visible:ring-2 focus-visible:ring-paper/40"
        >
          <span className="truncate">{props.title}</span>
          <Icon name="chevron" className={'h-3.5 w-3.5 shrink-0 text-paper/60 transition-transform ' + (listOpen ? '-rotate-90' : 'rotate-90')} />
        </button>
      ) : (
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-paper" data-tip={props.titleTip}>
          {props.title}
        </span>
      )}
      <button type="button" className={DECK_BTN} onClick={props.onGoTo} data-tip={props.goToTip} aria-label={props.goToTip}>
        <Icon name="arrowUpRight" className="h-[18px] w-[18px]" />
      </button>
      <button type="button" className={DECK_BTN} onClick={props.onClose} data-tip={props.closeTip} aria-label={props.closeTip}>
        <Icon name="x" className="h-[18px] w-[18px]" />
      </button>
    </div>
  )

  return (
    <div
      className={
        'deck group/deck rounded-xl bg-ink-900 text-paper shadow-float ' + (place === 'sidebar' ? 'w-full' : 'w-[264px]')
      }
      role="group"
      aria-label={`Voice note player: ${props.titleTip}`}
    >
      {several && listOpen && (
        <ul className="m-0 list-none border-b border-paper/15 p-1.5">
          {props.choices!.map((c) => (
            <li key={c.rel}>
              <button
                type="button"
                onClick={() => {
                  props.onChoose?.(c.rel)
                  setListOpen(false)
                }}
                className="flex w-full items-center gap-2 rounded-lg border-none bg-transparent px-2 py-1.5 text-left text-[12px] text-paper/80 outline-none hover:bg-paper/15 hover:text-paper focus-visible:ring-2 focus-visible:ring-paper/40"
              >
                <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center">
                  {c.rel === player.rel && <Icon name="check" className="h-3.5 w-3.5" />}
                </span>
                <span className="truncate">{c.label}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {place === 'sidebar' ? (
        // Opens on hover or keyboard focus, as Arc's does: the card grows
        // upwards, so the controls under the pointer never move.
        <div className="grid grid-rows-[0fr] opacity-0 transition-[grid-template-rows,opacity] duration-200 group-focus-within/deck:grid-rows-[1fr] group-focus-within/deck:opacity-100 group-hover/deck:grid-rows-[1fr] group-hover/deck:opacity-100">
          <div className="min-h-0 overflow-hidden">{nameRow}</div>
        </div>
      ) : (
        nameRow
      )}
      <div className="flex h-12 items-center justify-between px-2.5">
        <span className="flex h-8 w-8 items-center justify-center text-accent-400" aria-hidden="true">
          <Icon name="cassette" className="h-[22px] w-[22px]" />
        </span>
        <button
          type="button"
          className={DECK_BTN}
          disabled={!ready}
          onClick={() => player.skip(-skip.back)}
          data-tip={`Back ${skipWords(skip.back)}`}
          aria-label={`Back ${skipWords(skip.back)}`}
        >
          <SkipIcon forward={false} seconds={skip.back} />
        </button>
        <button
          type="button"
          className={DECK_BTN + ' deck-play' + (playing ? ' is-playing' : '')}
          disabled={!ready}
          onClick={() => (player.playing ? player.pause() : void player.play(settings()))}
          aria-label={playing ? 'Pause' : 'Play'}
        >
          <PlayPauseIcon />
        </button>
        <button
          type="button"
          className={DECK_BTN}
          disabled={!ready}
          onClick={() => player.skip(skip.forward)}
          data-tip={`Forward ${skipWords(skip.forward)}`}
          aria-label={`Forward ${skipWords(skip.forward)}`}
        >
          <SkipIcon forward seconds={skip.forward} />
        </button>
        <button
          type="button"
          className={DECK_BTN}
          disabled={!ready}
          onClick={() => player.setMuted(!player.muted)}
          aria-pressed={muted}
          data-tip={muted ? 'Sound off — click to hear it' : 'Turn the sound off'}
          aria-label={muted ? 'Turn the sound on' : 'Turn the sound off'}
        >
          <Icon name={muted ? 'volumeOff' : 'volume'} className="h-5 w-5" />
        </button>
      </div>
    </div>
  )
}

// --- in the note ---------------------------------------------------------------

interface NoteTapeProps {
  /** the note (vault path) */
  path: string
  /** its text as App last passed it — enough to know whether it holds a voice
   *  note, since adding or removing one always reaches App */
  doc: string
  viewRef: React.MutableRefObject<EditorView | null>
  skip?: VoiceSkip
  /** px from the bottom of the note: above the eye and Markdown pro's switch */
  bottom: number
}

/** The cassette button in the note's corner, and the card it opens. Nothing at
 *  all on a note with no voice note in it. */
export function NoteTape({ path, doc, viewRef, skip, bottom }: NoteTapeProps): React.JSX.Element | null {
  const has = useMemo(() => voiceEmbeds(doc, path).length > 0, [doc, path])
  const [open, setOpen] = useState(false)
  /** the voice notes as the EDITOR has them now — a slider just moved writes
   *  its setting there long before App hears of it */
  const [recs, setRecs] = useState<Recording[]>([])
  const [chosen, setChosen] = useState<string | null>(null)
  const [player, setPlayer] = useState<VoicePlayer | null>(null)
  const deck = useDeck()
  const box = useRef<HTMLDivElement>(null)

  const liveRecordings = useCallback(
    (): Recording[] => recordingsIn(viewRef.current?.state.doc.toString() ?? doc, path),
    [viewRef, doc, path]
  )

  // Opening: read the voice notes afresh and pick one — the one playing (or
  // last played) if it is in this note, else the first.
  const toggle = (): void => {
    if (open) {
      setOpen(false)
      return
    }
    const now = liveRecordings()
    setRecs(now)
    setChosen(now.find((r) => r.rel === deck?.rel)?.rel ?? now[0]?.rel ?? null)
    setOpen(true)
  }

  // The player for the chosen recording, held for as long as the card shows it.
  useEffect(() => {
    if (!open || !chosen) return
    const p = playerFor(chosen)
    p.note = path
    p.label = recs.find((r) => r.rel === chosen)?.name ?? p.label
    p.mount()
    setPlayer(p)
    return () => {
      p.unmount()
      setPlayer(null)
    }
  }, [open, chosen, path, recs])

  // A click anywhere else, or Escape, puts it away.
  useEffect(() => {
    if (!open) return
    const down = (e: PointerEvent): void => {
      if (!box.current?.contains(e.target as Node)) setOpen(false)
    }
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('pointerdown', down, true)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('pointerdown', down, true)
      window.removeEventListener('keydown', key)
    }
  }, [open])

  // The last voice note deleted while it is open.
  useEffect(() => {
    if (!has) setOpen(false)
  }, [has])

  if (!has) return null

  const rec = recs.find((r) => r.rel === chosen)
  const goTo = (): void => {
    const view = viewRef.current
    if (!view || !chosen) return
    const n = lineOfEmbed(view.state.doc.toString(), path, chosen)
    if (!n) return
    const line = view.state.doc.line(n)
    view.dispatch({ effects: EditorView.scrollIntoView(line.from, { y: 'center' }) })
    flashLines(view, line.from, line.to)
    setOpen(false)
  }

  return (
    <div ref={box} className="absolute right-3 z-30 flex flex-col items-end gap-2" style={{ bottom }}>
      {open && player && rec && (
        <div className="fade-in">
          <DeckCard
            player={player}
            settings={() => liveRecordings().find((r) => r.rel === rec.rel)?.settings ?? rec.settings}
            skip={skip ?? VOICE_SKIP_DEFAULT}
            title={recLabel(rec)}
            titleTip={recLabel(rec)}
            place="note"
            goToTip="Go to this voice note"
            onGoTo={goTo}
            closeTip="Close"
            onClose={() => setOpen(false)}
            choices={recs.map((r) => ({ rel: r.rel, label: recLabel(r) }))}
            onChoose={setChosen}
          />
        </div>
      )}
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        data-tip={open ? 'Close the voice note player' : "Play this note's voice notes"}
        aria-label={open ? 'Close the voice note player' : "Play this note's voice notes"}
        className={
          'btn-edge flex h-8 w-8 items-center justify-center rounded-lg border border-ink-300/30 p-0 shadow-card outline-none backdrop-blur transition duration-200 focus-visible:ring-2 focus-visible:ring-brand-300 ' +
          (open ? 'bg-brand-500/15 text-brand-600' : 'bg-surface/90 text-ink-500 hover:text-ink-900')
        }
      >
        <Icon name="cassette" className="h-4 w-4" />
      </button>
    </div>
  )
}

// --- in the sidebar ------------------------------------------------------------

interface SidebarDeckProps {
  /** is this note showing in a column right now */
  onScreen: (note: string) => boolean
  skip: VoiceSkip
  /** ↗: back to the note, scrolled to the voice note */
  onGoTo: (note: string, rel: string) => void
}

/** The tape's recording, playable from the sidebar while its note is off
 *  screen. Nothing when nothing has been played, or its note is showing. */
export function SidebarDeck({ onScreen, skip, onGoTo }: SidebarDeckProps): React.JSX.Element | null {
  const player = useDeck()
  if (!player || !player.note || onScreen(player.note)) return null
  const name = titleOf(player.note)
  const voice = player.label || recordingName(player.rel)
  return (
    <div className="fade-in mb-2">
      <DeckCard
        player={player}
        settings={() => player.settings}
        skip={skip}
        title={player.label || name}
        titleTip={`${voice} — in ${name}`}
        place="sidebar"
        goToTip={`Go back to ${name}`}
        onGoTo={() => onGoTo(player.note, player.rel)}
        closeTip="Stop and close"
        onClose={ejectDeck}
      />
    </div>
  )
}
