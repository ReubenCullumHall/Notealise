import { useEffect, useRef, useState } from 'react'
import type { FormatColors, FormatKind, Space } from '../../../shared/settings'
import { paletteEntry } from '../../../shared/palette'
import { ColorField } from '../color/Picker'
import { Icon } from '../icons'
import { HelpTip } from '../Tooltip'
import { claimEscape } from './escapeClaims'
import { Tick } from './primitives'

// Settings → Colour → Text in your notes (Reuben, 2026-10-03): a colour of its
// own for each kind of formatting — "heading 1 is a bright yellow so it stands
// out". Each row picks text or highlight, then a colour in the same picker as
// everywhere else (recent + starred colours, then the hex).
//
// Headings are ONE row with a tick-box dropdown rather than four rows, because
// most people colour one or all of them. Ticking 1 and 4 and picking a colour
// sets both; untick them, tick 2 and 3, and those two get their own. So the
// ticks are only which levels the row is editing — every level still stores its
// own colour (shared/settings.ts, `formatColors`).
//
// Lives inside SpaceColour, so like the rest of that fold it sets one space in
// Spaces and every space in Look.

type Layer = 'tc' | 'hl'
const LEVELS = ['h1', 'h2', 'h3', 'h4'] as const
/** Where the square starts for a row with no colour yet — nothing is written
 *  until you actually pick. */
const START = paletteEntry('amber')?.hex ?? ''

interface Row {
  id: string
  label: string
  /** how the label is drawn, so the row previews what it colours */
  sample: string
}

const ROWS: Row[] = [
  { id: 'headings', label: 'Headings', sample: 'font-bold' },
  { id: 'bold', label: 'Bold', sample: 'font-bold' },
  { id: 'italic', label: 'Italic', sample: 'italic' },
  { id: 'underline', label: 'Underline', sample: 'underline underline-offset-2' },
  { id: 'strike', label: 'Strikethrough', sample: 'line-through' },
  { id: 'noteLink', label: 'Note links', sample: '' },
  { id: 'webLink', label: 'Web links', sample: 'underline underline-offset-2' }
]

/** "All headings", "Heading 1", "Headings 1 & 4", "Headings 1, 2 & 4". */
function headingLabel(levels: readonly string[]): string {
  if (levels.length === 4) return 'All headings'
  if (levels.length === 0) return 'No headings'
  const n = levels.map((l) => l.slice(1))
  if (n.length === 1) return `Heading ${n[0]}`
  return `Headings ${n.slice(0, -1).join(', ')} & ${n[n.length - 1]}`
}

/** The heading levels the row is editing — a tick box per level in a small
 *  dropdown. Same shell as `Select` (primitives.tsx), anchored to the row. */
function HeadingPicker({
  levels,
  onChange
}: {
  levels: string[]
  onChange: (next: string[]) => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!open) return
    const release = claimEscape()
    const onDown = (e: MouseEvent): void => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setOpen(false)
      }
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey, true)
    return () => {
      release()
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  return (
    <span ref={box} className="inline-flex">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={
          'flex items-center gap-1 rounded-lg border border-ink-300/30 px-2 py-1 text-[12.5px] font-bold outline-none transition duration-200 focus-visible:ring-2 focus-visible:ring-brand-300 ' +
          (open ? 'bg-brand-500/15 text-brand-600' : 'btn-edge bg-surface/70 text-ink-700 hover:text-ink-900')
        }
      >
        <span className="truncate">{headingLabel(levels)}</span>
        <span className={'inline-flex text-ink-400 transition-transform duration-200 ' + (open ? 'rotate-90' : '')}>
          <Icon name="chevron" className="h-3.5 w-3.5" />
        </span>
      </button>
      {open && (
        <div className="fade-in absolute left-0 top-full z-40 mt-1 flex w-[180px] flex-col rounded-xl border border-ink-300/25 bg-surface p-1 shadow-float">
          {LEVELS.map((l) => (
            <Tick
              key={l}
              on={levels.includes(l)}
              label={`Heading ${l.slice(1)}`}
              onClick={() =>
                onChange(
                  levels.includes(l) ? levels.filter((x) => x !== l) : LEVELS.filter((x) => x === l || levels.includes(x))
                )
              }
            />
          ))}
        </div>
      )}
    </span>
  )
}

export function FormatColours({
  space,
  onChange
}: {
  space: Space
  onChange: (patch: Partial<Space>) => void
}): React.JSX.Element {
  const fc = space.formatColors
  const [levels, setLevels] = useState<string[]>([...LEVELS])
  // Which layer each row is on. Text first: it's what "colour a heading" means.
  const [layers, setLayers] = useState<Record<string, Layer>>({})
  const [editing, setEditing] = useState<string | null>(null)

  const kindsOf = (row: string): FormatKind[] =>
    row === 'headings' ? (levels as FormatKind[]) : [row as FormatKind]
  const layerOf = (row: string): Layer => layers[row] ?? 'tc'

  const write = (kinds: FormatKind[], layer: Layer, hex: string): void => {
    const next: FormatColors = { ...fc }
    for (const k of kinds) next[k] = { ...fc[k], [layer]: hex }
    onChange({ formatColors: next })
  }

  return (
    <section className="settings-group">
      <h3>Text in your notes</h3>
      <p className="hint">
        Give headings, bold, links and the rest a colour of their own — the words themselves, or a
        highlight behind them. Left alone, they stay your normal text colour.{' '}
        <HelpTip text="A row can have both: pick a text colour, switch to Highlight, and pick a second colour for behind it. Each one stays until you clear it." />
      </p>

      <div className="flex flex-col rounded-xl ring-1 ring-ink-300/20">
        {ROWS.map((row, i) => {
          const kinds = kindsOf(row.id)
          const layer = layerOf(row.id)
          const first = kinds[0] ? fc[kinds[0]] : { tc: '', hl: '' }
          const hex = first[layer]
          const mixed = kinds.some((k) => fc[k][layer] !== hex)
          const open = editing === row.id
          const none = kinds.length === 0
          return (
            <div key={row.id} className={i > 0 ? 'border-t border-ink-300/15' : ''}>
              <div className="relative flex items-center gap-3 px-3 py-2">
                <span className="min-w-0 flex-1">
                  {row.id === 'headings' ? (
                    <HeadingPicker levels={levels} onChange={setLevels} />
                  ) : (
                    // The label wears the row's own colours, so the list is
                    // its own preview.
                    <span
                      className={'rounded-[3px] px-0.5 text-[13px] text-ink-900 ' + row.sample}
                      style={{ color: first.tc || undefined, background: first.hl || undefined }}
                    >
                      {row.label}
                    </span>
                  )}
                </span>

                <span className="inline-flex shrink-0 rounded-lg bg-ink-300/10 p-0.5" role="group" aria-label="Colour the text or behind it">
                  {(['tc', 'hl'] as const).map((l) => (
                    <button
                      key={l}
                      type="button"
                      aria-pressed={layer === l}
                      onClick={() => setLayers((m) => ({ ...m, [row.id]: l }))}
                      className={
                        'rounded-md border-none px-2 py-0.5 text-[11.5px] outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-brand-300 ' +
                        (layer === l
                          ? 'bg-surface text-ink-900 shadow-card'
                          : 'bg-transparent text-ink-500 hover:bg-transparent hover:text-ink-900')
                      }
                    >
                      {l === 'tc' ? 'Text' : 'Highlight'}
                    </button>
                  ))}
                </span>

                <button
                  type="button"
                  aria-expanded={open}
                  aria-disabled={none || undefined}
                  aria-label={`${row.label} ${layer === 'tc' ? 'text' : 'highlight'} colour`}
                  data-tip={
                    none
                      ? 'Tick a heading first'
                      : mixed
                        ? 'These headings have different colours — picking one sets them all'
                        : hex || 'Normal text colour — click to choose one'
                  }
                  onClick={() => !none && setEditing(open ? null : row.id)}
                  className={
                    'h-6 w-6 shrink-0 rounded-md p-0 outline-none transition duration-150 focus-visible:ring-2 focus-visible:ring-brand-300 ' +
                    (hex && !mixed
                      ? 'border-none ' + (open ? 'ring-2 ring-brand-500 ring-offset-1 ring-offset-surface' : 'ring-1 ring-ink-300/30 hover:ring-ink-300/60')
                      : 'border border-dashed border-ink-300/50 bg-transparent hover:border-ink-400') +
                    (none ? ' opacity-40' : '')
                  }
                  style={hex && !mixed ? { background: hex } : undefined}
                />

                <button
                  type="button"
                  aria-label={`Clear the ${row.label.toLowerCase()} colours`}
                  data-tip="Back to normal — clears the text and highlight colour"
                  disabled={kinds.every((k) => !fc[k].tc && !fc[k].hl)}
                  onClick={() => {
                    const next: FormatColors = { ...fc }
                    for (const k of kinds) next[k] = { tc: '', hl: '' }
                    onChange({ formatColors: next })
                  }}
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-none bg-transparent p-0 text-ink-400 outline-none transition-colors duration-150 hover:bg-ink-300/15 hover:text-ink-900 focus-visible:ring-2 focus-visible:ring-brand-300 disabled:opacity-0"
                >
                  <Icon name="x" className="h-3.5 w-3.5" />
                </button>
              </div>

              {open && !none && (
                <div className="fade-in px-3 pb-3">
                  <div className="w-[236px] rounded-xl border border-ink-300/25 bg-paper/40 p-2.5">
                    {/* Which colour this is, and the way back to none — just
                        this one; the × on the row clears both (Reuben,
                        2026-10-03). */}
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-400">
                        {layer === 'tc' ? 'Text colour' : 'Highlight'}
                      </span>
                      <button
                        type="button"
                        aria-label={layer === 'tc' ? 'Back to the normal text colour' : 'Remove the highlight'}
                        data-tip={layer === 'tc' ? 'Back to the normal text colour' : 'Remove the highlight'}
                        disabled={kinds.every((k) => !fc[k][layer])}
                        onClick={() => write(kinds, layer, '')}
                        className="flex h-5 w-5 items-center justify-center rounded-md border-none bg-transparent p-0 text-ink-400 outline-none transition-colors duration-150 hover:bg-ink-300/15 hover:text-ink-900 focus-visible:ring-2 focus-visible:ring-brand-300 disabled:opacity-30"
                      >
                        <Icon name="x" className="h-3 w-3" />
                      </button>
                    </div>
                    <ColorField
                      value={hex || START}
                      onChange={(next) => write(kinds, layer, next)}
                    />
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
