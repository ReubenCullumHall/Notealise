import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { hexToHsv, hsvToHex, inkOn, normalizeHex, rgbChannels, type Hsv } from '../../../shared/color'
import { Icon } from '../icons'
import { useDragTrack } from './dragTrack'

// The colour picker: a saturation/value square, a hue slider and a hex field —
// the three controls that between them reach every colour, rather than a fixed
// list of twelve. Used in two places and identical in both:
//
//   • ColorPopover — anchored under a sidebar row's swatch or its context menu,
//     for colouring one note or folder.
//   • ColorField   — inline in Settings → Colour, for building a space's palette.
//
// The gradients live in app.css (`.color-sv`, `.color-hue`) and take the hue as
// a custom property. Rule 5 bans hex in component code and the exception would
// be tempting here — but these gradients are not theme values, they are the
// sRGB gamut itself, and putting them in the stylesheet keeps the rule with no
// argument about it.
//
// HSV, not HSL, because that is the shape of the control: hold the hue, and the
// square's two axes ARE saturation and value. The conversion is in
// shared/color.ts with its round-trip pinned by a test.

/** The small caps heading over each block. One constant so every picker's
 *  headings are literally the same string of utilities, not four that happen to
 *  agree today. */
const HEAD = 'pb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-400'

/**
 * The picker holds HSV; the outside world holds hex. Keeping the HSV is not an
 * optimisation, it is the only way the control behaves:
 *
 *   **Hex cannot represent where the handle is.** Drag to the bottom of the
 *   square and the colour is black — and `hexToHsv('#000000').h` is 0 whatever
 *   hue you were on. Deriving the handle from the emitted hex would therefore
 *   snap it to red the instant a drag touched the bottom edge, and again at the
 *   left edge, where saturation 0 loses the hue the same way.
 *
 * So the draft is state, and it is only reseeded when the value changes from
 * OUTSIDE (a palette swatch, a typed hex) — detected by comparing against the
 * hex this component last produced. React's documented "adjust state while
 * rendering" pattern: a plain setState during render, no effect and no ref, so
 * there is no extra pass and nothing to keep in step.
 */
function useHsvDraft(hex: string): [Hsv, (next: Hsv) => void] {
  const [draft, setDraft] = useState(() => hexToHsv(hex))
  const [seed, setSeed] = useState(hex)
  if (hex !== seed) {
    setSeed(hex)
    if (hsvToHex(draft.h, draft.s, draft.v) !== hex) setDraft(hexToHsv(hex))
  }
  return [draft, (next) => setDraft(next)]
}


/** The square + slider + hex field, with no chrome of its own so it drops into
 *  a popover or a settings row alike. */
export function ColorField({
  value,
  onChange
}: {
  value: string
  onChange: (hex: string) => void
}): React.JSX.Element {
  const [hsv, setHsv] = useHsvDraft(value)
  const [typed, setTyped] = useState<string | null>(null)

  const emit = (next: typeof hsv): void => {
    setHsv(next)
    setTyped(null)
    onChange(hsvToHex(next.h, next.s, next.v))
  }

  const sv = useDragTrack((x, y) => emit({ ...hsv, s: x * 100, v: (1 - y) * 100 }))
  const hue = useDragTrack((x) => emit({ ...hsv, h: x * 360 }))

  /** Arrow keys nudge; Shift takes bigger steps. A colour picker that can only
   *  be dragged is one a keyboard cannot reach at all. */
  const nudge = (e: React.KeyboardEvent, axis: 'sv' | 'h'): void => {
    const step = e.shiftKey ? 10 : 1
    const d: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, step],
      ArrowDown: [0, -step]
    }
    const hit = d[e.key]
    if (!hit) return
    e.preventDefault()
    if (axis === 'h') emit({ ...hsv, h: (hsv.h + hit[0] * 3.6 + 360) % 360 })
    else
      emit({
        ...hsv,
        s: Math.min(100, Math.max(0, hsv.s + hit[0])),
        v: Math.min(100, Math.max(0, hsv.v + hit[1]))
      })
  }

  return (
    <div className="flex flex-col gap-2.5">
      <div
        {...sv}
        role="slider"
        tabIndex={0}
        aria-label="Saturation and brightness"
        aria-valuetext={`${Math.round(hsv.s)}% saturation, ${Math.round(hsv.v)}% brightness`}
        onKeyDown={(e) => nudge(e, 'sv')}
        className="color-sv"
        style={{ '--picker-hue': hsv.h } as React.CSSProperties}
      >
        <span
          className="color-handle"
          style={{
            left: `${hsv.s}%`,
            top: `${100 - hsv.v}%`,
            '--handle-rgb': rgbChannels(hsvToHex(hsv.h, hsv.s, hsv.v))
          } as React.CSSProperties}
        />
      </div>

      <div
        {...hue}
        role="slider"
        tabIndex={0}
        aria-label="Hue"
        aria-valuemin={0}
        aria-valuemax={360}
        aria-valuenow={Math.round(hsv.h)}
        onKeyDown={(e) => nudge(e, 'h')}
        className="color-hue"
      >
        <span
          className="color-handle"
          style={{
            left: `${(hsv.h / 360) * 100}%`,
            top: '50%',
            '--handle-rgb': rgbChannels(hsvToHex(hsv.h, 100, 100))
          } as React.CSSProperties}
        />
      </div>

      <label className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className="h-6 w-6 shrink-0 rounded-md ring-1 ring-ink-300/40"
          style={{ background: `rgb(${rgbChannels(hsvToHex(hsv.h, hsv.s, hsv.v))})` }}
        />
        <span className="sr-only">Hex colour</span>
        {/* Free text while you type — committing per keystroke would reject
            "#e0" on the way to "#e06" and make the field impossible to use. */}
        <input
          value={typed ?? hsvToHex(hsv.h, hsv.s, hsv.v)}
          spellCheck={false}
          maxLength={7}
          onChange={(e) => {
            setTyped(e.target.value)
            const hex = normalizeHex(e.target.value)
            if (hex) {
              setHsv(hexToHsv(hex))
              onChange(hex)
            }
          }}
          onBlur={() => setTyped(null)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            else if (e.key === 'Escape') {
              e.stopPropagation() // don't close the popover behind it
              setTyped(null)
            }
          }}
          className="w-full rounded-lg bg-ink-300/8 px-2.5 py-1.5 font-mono text-[12px] lowercase text-ink-900 outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
        />
      </label>
    </div>
  )
}

/** One palette colour as a clickable swatch. `on` marks the current one.
 *
 *  `hex` is any CSS colour: a literal `#rrggbb` (a sidebar row, a tint, an
 *  accent), or a custom property like `var(--tc-sage)` (text colour and
 *  highlight, which have separate light and dark values and so cannot be a
 *  hex — see shared/palette.ts). The tick inside is drawn only for a literal
 *  hex, because `inkOn` needs actual channels to decide black or white on it;
 *  a token swatch is marked by the ring alone, which is the louder of the two
 *  signals anyway. */
export function Swatch({
  hex,
  on,
  label,
  onClick
}: {
  hex: string
  on?: boolean
  label: string
  onClick: () => void
}): React.JSX.Element {
  const literal = hex.startsWith('#')
  return (
    <button
      onClick={onClick}
      data-tip={label}
      aria-label={label}
      aria-pressed={on}
      className={
        'h-6 w-6 shrink-0 rounded-md border-none outline-none transition duration-150 focus-visible:ring-2 focus-visible:ring-brand-300 ' +
        // Hover is a ring change, not a scale: a swatch that grows under the
        // cursor nudges its neighbours' apparent position in a tight grid, and
        // the 10% jump was the loudest of the app's bounce-y hovers.
        (on
          ? 'ring-2 ring-brand-500 ring-offset-1 ring-offset-surface'
          : 'ring-1 ring-ink-300/30 hover:ring-ink-300/60')
      }
      style={{ background: literal ? `rgb(${rgbChannels(hex)})` : hex }}
    >
      {on && literal && (
        <span className={inkOn(hex) === 'dark' ? 'text-black' : 'text-white'}>
          <Icon name="check" className="mx-auto h-3.5 w-3.5" />
        </span>
      )}
    </button>
  )
}

/** One preset in `PalettePicker`. `css` is any CSS colour string, so a surface
 *  can hand over `var(--tc-sage)` (theme-aware, what a highlight paints) or a
 *  literal `#hex` (what a row or a tint paints) without this knowing which. */
export interface PickerSwatch {
  /** what `onPick` receives — a palette NAME, a hex, whatever the surface stores */
  key: string
  label: string
  css: string
  on: boolean
}

/**
 * THE colour control. Presets, then "Any colour" behind a disclosure.
 *
 * Reuben, 2026-09-05: "make sure the colour picker is universal — has the same
 * preset colours and a custom hex colour interface if you want, in onboarding,
 * on text select and in accent colours and tints". Before this there were four
 * different controls: a hex square here, eight token swatches in the selection
 * toolbar, eleven bare dots for the accent, and a hex square with no presets at
 * all in the tint maker.
 *
 * It takes rendered swatches rather than the palette itself, because the four
 * callers genuinely do store different things — a name (`sage`, written into a
 * note), an accent id, a raw hex — and a component that tried to own all three
 * would need a mode flag per caller, which is the same four controls again with
 * extra steps. What is shared is the PRESENTATION and the custom-colour path,
 * and those are the two things that were different everywhere.
 *
 * The disclosure starts open when the current value is not one of the presets:
 * that means a custom colour is already in force, and hiding the field that set
 * it would leave no way to see what it is.
 */
export function PalettePicker({
  swatches,
  onPick,
  custom,
  heading = 'Presets',
  footer
}: {
  swatches: PickerSwatch[]
  onPick: (key: string) => void
  /** omit to offer presets only */
  custom?: {
    hex: string
    onChange: (hex: string) => void
    /** one line under the field — e.g. what the app does with the colour */
    note?: string
  }
  heading?: string
  footer?: React.ReactNode
}): React.JSX.Element {
  const anyOn = swatches.some((s) => s.on)
  const [open, setOpen] = useState(!anyOn && !!custom)

  return (
    <div>
      <p className={HEAD}>{heading}</p>
      {/* Five columns, matching the format bar's colour menu — the canonical
          palette is ten, and a wrapping row broke 8 + 2 at every width these
          pickers are used at. A space's own palette can be any length up to
          PALETTE_MAX (12), and the grid handles that without a second rule. */}
      <div className="grid grid-cols-5 gap-1.5">
        {swatches.map((s) => (
          <Swatch key={s.key} hex={s.css} on={s.on} label={s.label} onClick={() => onPick(s.key)} />
        ))}
      </div>

      {custom && (
        <>
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
            className={
              'mt-2.5 flex w-full items-center gap-1.5 rounded-lg border-none bg-transparent px-1 py-1 text-left outline-none transition-colors hover:bg-transparent focus-visible:ring-2 focus-visible:ring-brand-300 ' +
              (open ? 'text-brand-600' : 'text-ink-400 hover:text-ink-900')
            }
          >
            <span className={'inline-flex transition-transform duration-150 ' + (open ? 'rotate-90' : '')}>
              <Icon name="chevron" className="h-3 w-3" />
            </span>
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em]">Any colour</span>
            {/* The current custom colour, shown on the closed row — otherwise a
                collapsed disclosure gives no clue that one is set. */}
            {!anyOn && (
              <span
                aria-hidden="true"
                className="ml-auto h-3.5 w-3.5 shrink-0 rounded-full ring-1 ring-ink-300/40"
                style={{ background: custom.hex }}
              />
            )}
          </button>
          {open && (
            <div className="pt-1">
              <ColorField value={custom.hex} onChange={custom.onChange} />
              {custom.note && (
                <p className="mt-2 text-[11px] leading-relaxed text-ink-400">{custom.note}</p>
              )}
            </div>
          )}
        </>
      )}

      {footer}
    </div>
  )
}

const GAP = 6
const EDGE = 8
const WIDTH = 236

/** Where the trigger is, in viewport coordinates. */
export interface Anchor {
  left: number
  top: number
  bottom: number
}

/**
 * The picker as an anchored popover — what a sidebar row opens.
 *
 * Portalled to `document.body`, and that is NOT optional: the sidebar `<aside>`
 * carries `backdrop-blur`, and a backdrop-filter makes an element the containing
 * block for `position: fixed` descendants, so rendering this in place would pin
 * it to the 288px sidebar. Same trap as the settings modal and the hover card
 * (CLAUDE.md) — and the bottom strip is `pointer-events-none`, which a child
 * would inherit and quietly become unclickable.
 */
export function ColorPopover({
  at,
  value,
  palette,
  inherited,
  onPick,
  onClear,
  onSaveToPalette,
  onClose
}: {
  at: Anchor
  /** the row's own colour, or '' if it has none */
  value: string
  palette: string[]
  /** set when the row shows an ancestor's colour rather than one of its own */
  inherited?: { hex: string; from: string } | null
  onPick: (hex: string) => void
  onClear: () => void
  /** absent once the current colour is already on the palette */
  onSaveToPalette?: (hex: string) => void
  onClose: () => void
}): React.JSX.Element {
  const box = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState(0)
  // What the square and slider show before you have picked anything: the colour
  // being inherited, so dragging starts from what is on screen rather than from
  // black. Falls back to the first palette colour for an uncoloured row in a
  // vault that has no inheritance either.
  const [draft, setDraft] = useState(value || inherited?.hex || palette[0] || '#7cb356')

  useLayoutEffect(() => setHeight(box.current?.offsetHeight ?? 0), [palette.length, inherited])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    const onDown = (e: MouseEvent): void => {
      if (box.current && !box.current.contains(e.target as Node)) onClose()
    }
    window.addEventListener('keydown', onKey, true)
    // `mousedown` in the CAPTURE phase, so a click on a tree row closes this
    // rather than the row's own handler running first and opening a note.
    window.addEventListener('mousedown', onDown, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('mousedown', onDown, true)
    }
  }, [onClose])

  const below = at.bottom + GAP
  const flip = height > 0 && below + height > window.innerHeight - EDGE
  const saveable = onSaveToPalette && !palette.includes(draft)

  return createPortal(
    <div
      ref={box}
      role="dialog"
      aria-label="Choose a colour"
      style={{
        position: 'fixed',
        left: Math.max(EDGE, Math.min(at.left, window.innerWidth - WIDTH - EDGE)),
        top: flip ? Math.max(EDGE, at.top - GAP - height) : below,
        width: WIDTH
      }}
      className="fade-in z-[80] rounded-xl border border-ink-300/30 bg-surface p-2.5 shadow-float"
    >
      {/* The same control as the text picker, the accent picker and the tint
          maker (2026-09-05) — the only difference is that the presets here are
          the SPACE's palette, which is itself seeded from the canonical one and
          which you can add to. */}
      <PalettePicker
        heading="Your palette"
        swatches={palette.map((hex) => ({ key: hex, label: hex, css: hex, on: value === hex }))}
        onPick={(hex) => {
          setDraft(hex)
          onPick(hex)
        }}
        custom={{
          hex: draft,
          onChange: (hex) => {
            setDraft(hex)
            onPick(hex)
          }
        }}
      />

      <div className="mt-2.5 flex items-center gap-1.5 border-t border-ink-300/15 pt-2">
        {saveable && (
          <button
            className="mini flex-1"
            data-tip="Add this colour to the palette, so it's one click next time — and so auto-colour can use it"
            onClick={() => onSaveToPalette(draft)}
          >
            Save to palette
          </button>
        )}
        <button
          className="mini"
          disabled={!value}
          data-tip={
            inherited && !value
              ? `Already taking its colour from ${inherited.from}`
              : 'Remove this row’s own colour'
          }
          onClick={onClear}
        >
          No colour
        </button>
      </div>

      {inherited && !value && (
        <p className="mt-2 text-[11px] leading-relaxed text-ink-400">
          Currently inheriting from <span className="font-medium text-ink-500">{inherited.from}</span>.
          Picking one here overrides that.
        </p>
      )}
    </div>,
    document.body
  )
}
