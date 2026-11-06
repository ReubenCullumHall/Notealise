import { Fragment, useCallback, useEffect, useRef } from 'react'
import { wordAt, wordSelected, wordsSpan, type ClipWord } from './words'

// The transcript's words under the waveform, for editing by them (words.ts).
// Press a word to select it (the playhead goes there), drag across words to
// select a run, Shift-press to stretch the selection — the SAME selection the
// waveform has, so Delete / Keep only this / Backspace act on it as they would
// on a stretch dragged out on the sound. The word being said is marked as it
// plays; that is done to the DOM directly from the panel's drawing loop
// (`onHead`), never by re-drawing this list every frame.

interface Props {
  words: readonly ClipWord[]
  sel: readonly [number, number] | null
  /** select clip time [a, b] */
  onSelect(range: [number, number]): void
  /** move the playhead to clip time `t` */
  onSeek(t: number): void
  /** hand the panel a function that marks the word at clip time `t` */
  onHead(fn: ((t: number) => void) | null): void
}

export function ClipWords({ words, sel, onSelect, onSeek, onHead }: Props): React.JSX.Element {
  const box = useRef<HTMLDivElement>(null)
  const spans = useRef<(HTMLSpanElement | null)[]>([])
  const now = useRef(-1)
  const anchor = useRef<number | null>(null)
  const pressing = useRef(false)
  const list = useRef(words)
  list.current = words

  // The word being said: one class moved, and the list scrolled to keep it in
  // sight — the list's own scroll, never the panel's.
  const mark = useCallback((t: number): void => {
    const i = wordAt(list.current, t)
    if (i === now.current) return
    // An attribute React doesn't own, so a re-draw of the list (a selection,
    // an edit) neither wipes it nor leaves it behind.
    spans.current[now.current]?.removeAttribute('data-now')
    now.current = i
    const el = spans.current[i]
    const b = box.current
    if (!el || !b) return
    el.setAttribute('data-now', '')
    const top = el.offsetTop - b.offsetTop
    if (top < b.scrollTop) b.scrollTop = top
    else if (top + el.offsetHeight > b.scrollTop + b.clientHeight) b.scrollTop = top + el.offsetHeight - b.clientHeight
  }, [])
  useEffect(() => {
    // A new list (an edit, Undo): the old mark may sit on a word that is now
    // another one.
    for (const el of box.current?.querySelectorAll('[data-now]') ?? []) el.removeAttribute('data-now')
    now.current = -1
    onHead(mark)
    return () => onHead(null)
  }, [mark, onHead, words])

  const indexAt = (x: number, y: number): number | null => {
    const el = document.elementFromPoint(x, y)
    const i = el instanceof HTMLElement && el.dataset.word !== undefined ? Number(el.dataset.word) : NaN
    return Number.isFinite(i) ? i : null
  }

  const down = (e: React.PointerEvent): void => {
    if (e.button !== 0) return
    const i = indexAt(e.clientX, e.clientY)
    if (i === null) return
    e.preventDefault()
    if (e.shiftKey && anchor.current !== null) {
      onSelect(wordsSpan(list.current, anchor.current, i))
    } else {
      anchor.current = i
      onSelect(wordsSpan(list.current, i, i))
      onSeek(list.current[i].from)
    }
    pressing.current = true
    box.current?.setPointerCapture(e.pointerId)
  }
  const move = (e: React.PointerEvent): void => {
    if (!pressing.current || anchor.current === null) return
    const i = indexAt(e.clientX, e.clientY)
    if (i !== null) onSelect(wordsSpan(list.current, anchor.current, i))
  }
  const up = (): void => {
    pressing.current = false
  }

  spans.current.length = words.length
  return (
    <div
      ref={box}
      className="clip-ed-words"
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
    >
      {words.map((w, i) => (
        <Fragment key={i}>
          {i > 0 && w.section !== words[i - 1].section ? <span className="clip-ed-words-break" /> : i > 0 ? ' ' : null}
          <span
            ref={(el) => {
              spans.current[i] = el
            }}
            data-word={i}
            className={'clip-ed-word' + (wordSelected(w, sel) ? ' is-sel' : '')}
          >
            {w.text}
          </span>
        </Fragment>
      ))}
    </div>
  )
}
