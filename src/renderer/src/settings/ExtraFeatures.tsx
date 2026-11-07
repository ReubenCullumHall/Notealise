import { useEffect, useState } from 'react'
import { ToggleRow } from './primitives'
import { RAW_MARK_STYLES, type AppSettings, type RawMarkStyleId } from '../../../shared/settings'
import { COLOR_NAMES, colorToken, LAYERS, splitToken, type Layer } from '../../../shared/palette'
import type { AccurateDownload, AccurateStatus } from '../../../shared/types'

// Settings → Extra features (Reuben, 2026-11-06: "a new sidebar area in the settings area for
// 'extra features' as this will house some of the extra, downloadable add on packs and paid
// features we incorperate later, markdown pro should be in here too … an on/off toggle").
//
// Everything here is APP-WIDE — one switch, not one per space (his pick, 2026-11-07). That is a
// deliberate exception to the settings rule (CLAUDE.md "EVERY customisation setting belongs to a
// space"): these are things you add to the app, not how a set of notes looks.

interface Props {
  settings: AppSettings
  onChange: (partial: Partial<AppSettings>) => void
}

/** Built FROM `RAW_MARK_STYLES` rather than listing the ids again: a `Record` keyed by the
 *  union means a new style is a type error here until it has a label. */
const RAW_MARK_LABELS: Record<RawMarkStyleId, { label: string; hint: string }> = {
  faded: { label: 'Faded', hint: 'Greyed, so you read past them' },
  colour: { label: 'Coloured', hint: 'Monospaced, in a colour you pick' }
}
const LAYER_LABELS: Record<Layer, string> = { hl: 'Highlight', tc: 'Text colour' }
const RAW_MARK_STYLE_OPTIONS = RAW_MARK_STYLES.map((id) => ({ id, ...RAW_MARK_LABELS[id] }))

const BUTTON =
  'btn-edge flex items-center justify-center gap-2 rounded-lg border border-ink-300/35 bg-surface/70 px-3 py-2 text-[13px] font-medium text-ink-700 outline-none transition duration-200 hover:border-ink-300/60 hover:text-ink-900 focus-visible:ring-2 focus-visible:ring-brand-300 disabled:opacity-50'

export function ExtraFeatures({ settings, onChange }: Props): React.JSX.Element {
  return (
    <>
      <div>
        <h3 className="accent-heading font-display text-[15px] font-semibold">Extra features</h3>
        <p className="mt-0.5 text-[12px] text-ink-500">Things you can add to the app. Some are a one-time download.</p>
      </div>
      <MarkdownPro settings={settings} onChange={onChange} />
      <AccurateTranscription />
    </>
  )
}

function MarkdownPro({ settings, onChange }: Props): React.JSX.Element {
  return (
    <div>
      <ToggleRow
        on={settings.markdownPro}
        onClick={() => onChange({ markdownPro: !settings.markdownPro })}
        label="Markdown pro"
        hint="Puts a button in the bottom-right corner of every note that switches between the formatted view and the raw Markdown — every asterisk, hash and table pipe visible, exactly as the file has them. Bold still looks bold and headings stay large; only the marks stop being hidden. Each note remembers which way you last looked at it."
      />
      {/* Directly under the switch, and inert without it: this decides how the marks READ
          once Markdown pro has revealed them, so on its own it has nothing to colour. */}
      <div className={'mt-3 ' + (!settings.markdownPro ? 'pointer-events-none opacity-40' : '')}>
        <p className="px-3 text-[12.5px] font-medium text-ink-700">How the marks look in Markdown pro</p>
        <p className="mb-1.5 px-3 text-[11.5px] leading-relaxed text-ink-500">
          Faded lets your eye run past them to the words. Highlighted makes the markup stand out, for when
          you want to read the code itself.
        </p>
        <div className="mode-row">
          {RAW_MARK_STYLE_OPTIONS.map((o) => {
            const on = settings.rawMarkStyle === o.id
            return (
              <button
                key={o.id}
                className={'mode-btn' + (on ? ' on' : '')}
                aria-pressed={on}
                onClick={() => onChange({ rawMarkStyle: o.id })}
              >
                <span className="t">{o.label}</span>
                <span className="s">{o.hint}</span>
              </button>
            )
          })}
        </div>
        {/* The same eight colours, in the same two layers, as colouring a phrase in a note —
            one palette in the app, not a second one only the marks use. */}
        {settings.rawMarkStyle === 'colour' && (
          <div className="fade-in mt-3 px-3">
            <div className="flex items-center gap-1.5">
              {LAYERS.map((l) => {
                const on = splitToken(settings.rawMarkTint).layer === l
                return (
                  <button
                    key={l}
                    className={'mini' + (on ? ' on' : '')}
                    aria-pressed={on}
                    onClick={() => onChange({ rawMarkTint: colorToken(l, splitToken(settings.rawMarkTint).name) })}
                  >
                    {LAYER_LABELS[l]}
                  </button>
                )
              })}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {COLOR_NAMES.map((name) => {
                const { layer } = splitToken(settings.rawMarkTint)
                const token = colorToken(layer, name)
                const on = settings.rawMarkTint === token
                return (
                  <button
                    key={name}
                    data-tip={name[0].toUpperCase() + name.slice(1)}
                    aria-label={name}
                    aria-pressed={on}
                    onClick={() => onChange({ rawMarkTint: token })}
                    className={
                      'h-6 w-6 rounded-md border-none outline-none transition duration-150 ' +
                      (on ? 'ring-2 ring-brand-400' : 'ring-1 ring-ink-300/25 hover:ring-ink-300/60')
                    }
                    style={{ background: `var(--${token})` }}
                  />
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

const MB = 1024 * 1024
const mb = (n: number): string => `${Math.round(n / MB)}`

/** The words for a download that didn't finish (docs/voice.md: plain, what happened, what to do). */
const FAILED: Record<Exclude<AccurateDownload, { ok: true }>['reason'], string> = {
  offline: 'The download stopped — check you’re online and try again.',
  damaged: 'The download didn’t arrive whole, so it wasn’t kept. Try again.',
  'no-space': 'There isn’t enough room on this computer. It needs about 750 MB free.',
  failed: 'The download couldn’t start. Try again in a moment.',
  cancelled: '',
  busy: ''
}

/** "More accurate transcription — 550 MB": Whisper Turbo, a one-time download
 *  (main/transcribeAccurate.ts; docs/plans/transcribe.md). */
export function AccurateTranscription(): React.JSX.Element {
  const [status, setStatus] = useState<AccurateStatus | null>(null)
  const [note, setNote] = useState('')

  useEffect(() => {
    let live = true
    void window.api.accurateStatus().then((s) => live && setStatus(s))
    const off = window.api.onAccurateProgress((p) =>
      setStatus((s) => (s ? { ...s, state: p.received >= p.total ? s.state : 'downloading', received: p.received, total: p.total } : s))
    )
    return () => {
      live = false
      off()
    }
  }, [])

  const download = async (): Promise<void> => {
    setNote('')
    setStatus((s) => (s ? { ...s, state: 'downloading', received: 0 } : s))
    const r = await window.api.accurateDownload()
    if (!r.ok) setNote(FAILED[r.reason])
    setStatus(await window.api.accurateStatus())
  }
  const remove = async (): Promise<void> => {
    setNote('')
    const r = await window.api.accurateRemove()
    if (!r.ok) setNote('It can’t be removed while a voice note is being transcribed. Try again once it’s done.')
    setStatus(await window.api.accurateStatus())
  }

  const total = status?.total || 550 * MB
  return (
    <div>
      <h3 className="accent-heading font-display text-[15px] font-semibold">More accurate transcription</h3>
      <p className="mt-0.5 text-[12px] leading-relaxed text-ink-500">
        Transcribes voice notes with fewer wrong words, especially outside English. It runs on this computer —
        recordings are never sent anywhere.
      </p>
      {status?.state === 'downloading' ? (
        <div className="mt-3 flex items-center gap-3 text-[12.5px] text-ink-600">
          <span className="relative h-[3px] flex-1 overflow-hidden rounded-pill bg-ink-300/35">
            <span
              className="absolute inset-y-0 left-0 bg-accent-500"
              style={{ width: `${Math.min(100, (100 * status.received) / total)}%` }}
            />
          </span>
          <span className="tabular-nums">
            {mb(status.received)} of {mb(total)} MB
          </span>
          <button className={BUTTON} onClick={() => void window.api.accurateCancel()}>
            Cancel
          </button>
        </div>
      ) : status?.state === 'ready' ? (
        <div className="mt-3 flex items-center gap-3 text-[12.5px] text-ink-600">
          <span>On — Transcribe uses it for every voice note.</span>
          <button className={BUTTON} onClick={() => void remove()}>
            Remove
          </button>
        </div>
      ) : (
        <div className="mt-3 flex items-center gap-3">
          <button className={BUTTON} disabled={!status} onClick={() => void download()}>
            Download · 550 MB
          </button>
          <span className="text-[12px] text-ink-400">About a minute on a fast connection.</span>
        </div>
      )}
      {note && <p className="mt-2 text-[12px] text-ink-600">{note}</p>}
    </div>
  )
}
