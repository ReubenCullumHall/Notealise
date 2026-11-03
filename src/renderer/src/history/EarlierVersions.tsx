import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '../icons'
import { formatDate, formatTime, formatTimeSeconds, type DateFormatId } from '../intl'
import type { NoteVersion } from '../../../shared/noteVersions'
import { compare, hasWords, putBack, type Piece } from './model'
import { VersionView } from './VersionView'
import type { LinkEnv } from '../editor/linkEnv'

// Earlier versions of a note (right-click a tab or a note → "Earlier versions…").
// Times down the left, newest first; the chosen copy on the right, with what has
// been removed from the note since it was kept lit up. Each removed piece has Put
// back; the foot has Restore whole note. Both keep the note as it is now as a
// version first (App's `replaceNoteText`), so either can itself be taken back.
// In the confirm window's frame, like Go to a note (`.history` in app.css).
// Plan and decisions: docs/plans/note-versions.md.

interface Props {
  path: string
  /** what the note view needs to draw links and pictures, with this note's path */
  env: LinkEnv
  title: string
  dateFormat: DateFormatId
  timezone: string
  /** the note's text as it is now — the open tab's, unsaved typing included */
  readNow: () => Promise<string>
  /** replace the note's text; resolves false when it could not be done */
  replace: (next: string) => Promise<boolean>
  /** after Restore whole note: close and say what happened */
  onRestored: (at: number) => void
  onClose: () => void
}

type Removed = Extract<Piece, { kind: 'removed' }>

export function EarlierVersions({
  path,
  env,
  title,
  dateFormat,
  timezone,
  readNow,
  replace,
  onRestored,
  onClose
}: Props): React.JSX.Element {
  const [list, setList] = useState<NoteVersion[] | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [cursor, setCursor] = useState(0)
  const [texts, setTexts] = useState<Record<string, string>>({})
  const [now, setNow] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  // The box takes focus, so the arrow keys reach it at once.
  useEffect(() => {
    boxRef.current?.focus()
  }, [])

  const refresh = useCallback(async (): Promise<void> => {
    const [versions, current] = await Promise.all([window.api.listVersions(path), readNow()])
    setList(versions)
    setNow(current)
  }, [path, readNow])

  useEffect(() => {
    refresh().catch((e: Error) => setFailed(e.message))
  }, [refresh])

  const chosen = list?.[cursor] ?? null
  const oldText = chosen ? texts[chosen.token] : undefined
  useEffect(() => {
    if (!chosen || texts[chosen.token] !== undefined) return
    let live = true
    window.api
      .readVersion(path, chosen.token)
      .then((t) => live && setTexts((m) => ({ ...m, [chosen.token]: t })))
      .catch((e: Error) => live && setFailed(e.message))
    return () => {
      live = false
    }
  }, [chosen, path, texts])

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-ver-i="${cursor}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [cursor])

  // Word for word the note now — the only case with nothing to restore. (The
  // comparison treats a lightly edited line as the same line, so it can't say.)
  const identical = oldText !== undefined && now !== null && oldText.replace(/\r\n?/g, '\n') === now
  const comparison = useMemo(
    () => (oldText !== undefined && now !== null ? compare(oldText, now) : null),
    [oldText, now]
  )

  // Focus goes back where it was when the box closes.
  const before = useRef<Element | null>(document.activeElement)
  const close = (): void => {
    const el = before.current
    onClose()
    if (el instanceof HTMLElement && el.isConnected) requestAnimationFrame(() => el.focus())
  }
  // Escape closes it wherever focus has got to (a pressed button, the window),
  // like the tab strip's right-click menu.
  const closeRef = useRef(close)
  closeRef.current = close
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      closeRef.current()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  const doPutBack = async (piece: Removed): Promise<void> => {
    if (busy || now === null) return
    setBusy(true)
    try {
      const next = putBack(now, piece)
      if (await replace(next)) await refresh()
    } finally {
      setBusy(false)
      // The note behind takes its new text through the editor, which can pull
      // focus into it — and typing would then land in a note you can't see.
      requestAnimationFrame(() => boxRef.current?.focus())
    }
  }
  const doRestore = async (): Promise<void> => {
    if (busy || !chosen || oldText === undefined) return
    setBusy(true)
    try {
      if (await replace(oldText.replace(/\r\n?/g, '\n'))) onRestored(chosen.at)
    } finally {
      setBusy(false)
    }
  }

  // Two copies from the same minute (a big deletion straight after a save) are
  // told apart by their seconds.
  const clock = (all: NoteVersion[], i: number): string => {
    const v = all[i]
    const t = formatTime(v.at, timezone)
    const twin = [all[i - 1], all[i + 1]].some((o) => o && formatTime(o.at, timezone) === t && dayOf(o.at) === dayOf(v.at))
    return twin ? formatTimeSeconds(v.at, timezone) : t
  }

  // Day headings: Today, Yesterday, then the date.
  const dayOf = (ms: number): string => formatDate(ms, 'ymd', timezone) ?? ''
  const today = dayOf(Date.now())
  const yesterday = dayOf(Date.now() - 24 * 60 * 60 * 1000)
  const dayLabel = (ms: number): string => {
    const d = dayOf(ms)
    if (d === today) return 'Today'
    if (d === yesterday) return 'Yesterday'
    return formatDate(ms, dateFormat === 'relative' ? 'full' : dateFormat, timezone) ?? d
  }

  const summary = ((): string => {
    if (!comparison) return ''
    if (identical) return 'The same as the note now.'
    const gone = comparison.pieces.filter((p) => p.kind === 'removed' && hasWords(p)).length
    const parts: string[] = []
    if (gone) parts.push(`${gone} ${gone === 1 ? 'piece' : 'pieces'} removed since`)
    if (comparison.addedLines) {
      parts.push(`${comparison.addedLines} ${comparison.addedLines === 1 ? 'line' : 'lines'} added since`)
    }
    return parts.length ? parts.join(' · ') + '.' : 'Only small edits since — nothing was removed.'
  })()

  return (
    <div className="confirm-backdrop" onClick={close}>
      <div
        className="history"
        role="dialog"
        aria-modal="true"
        aria-label={`Earlier versions of ${title}`}
        ref={boxRef}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && list?.length) {
            e.preventDefault()
            setCursor((c) => Math.min(list.length - 1, Math.max(0, c + (e.key === 'ArrowDown' ? 1 : -1))))
          }
        }}
      >
        <header className="history-head">
          <div className="min-w-0">
            <div className="prompt-title mb-0 truncate">Earlier versions</div>
            <div className="truncate text-[12.5px] text-ink-500">{title}</div>
          </div>
          <button className="history-x" aria-label="Close" data-tip="Close" onClick={close}>
            <Icon name="x" className="h-4 w-4" />
          </button>
        </header>

        {failed ? (
          <p className="px-4 py-6 text-sm text-ink-500">Earlier versions could not be read: {failed}</p>
        ) : list === null ? (
          <p className="px-4 py-6 text-sm text-ink-400">Loading…</p>
        ) : list.length === 0 ? (
          <p className="history-empty">
            No earlier versions yet. A copy is kept as you work — Settings → Data → Earlier versions
            says when.
          </p>
        ) : (
          <div className="history-body">
            <div ref={listRef} className="history-list" role="listbox" aria-label="Times">
              {list.map((v, i) => {
                const head = i === 0 || dayOf(list[i - 1].at) !== dayOf(v.at)
                return (
                  <div key={v.token}>
                    {head && <p className="history-day">{dayLabel(v.at)}</p>}
                    <div
                      data-ver-i={i}
                      role="option"
                      aria-selected={i === cursor}
                      className={
                        'tree-row arch-row flex cursor-pointer items-center pr-2 ' +
                        (i === cursor ? 'arch-row-on' : 'hover:bg-surface/70')
                      }
                      style={{ paddingLeft: 'var(--row-pad0)' }}
                      onClick={() => setCursor(i)}
                    >
                      <span className="tree-title font-medium tabular-nums text-ink-900">{clock(list, i)}</span>
                    </div>
                  </div>
                )
              })}
            </div>

            <div className="history-main">
              <p className="history-summary">{comparison ? summary : ' '}</p>
              {/* The copy as the note looks — formatted, never raw Markdown (Reuben,
                  2026-11-03) — drawn by the editor itself, read-only. */}
              <div className="history-text" aria-busy={!comparison}>
                {comparison && (
                  <VersionView pieces={comparison.pieces} env={env} busy={busy} onPutBack={(p) => void doPutBack(p)} />
                )}
              </div>
              <footer className="history-foot">
                <button onClick={close}>Close</button>
                <button
                  className="primary"
                  disabled={busy || !comparison || identical}
                  onClick={() => void doRestore()}
                >
                  <Icon name="restore" className="mr-1.5 inline h-3.5 w-3.5 align-[-2px]" />
                  Restore whole note
                </button>
              </footer>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
