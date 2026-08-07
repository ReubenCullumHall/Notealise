import { useState } from 'react'
import { DEFAULT_PALETTE, PALETTE_MAX, inkOn, rgbChannels } from '../../../shared/color'
import type { ColorStyle, Space } from '../../../shared/settings'
import { Icon } from '../icons'
import { ToggleRow } from './primitives'
import { ColorField, Swatch } from '../color/Picker'
import type { SpaceProps } from './Spaces'

interface ColourProps extends SpaceProps {
  /** Colour the folders that already exist, in whichever spaces this form is
   *  scoped to. Fired when auto-colour is switched ON — a setting that only
   *  reached folders made from that moment on looks like it did nothing, since
   *  the sidebar in front of you doesn't change. */
  onColorExisting: () => void
}

// Settings → Colour. Rendered inside SpaceForm, which means it appears in BOTH
// scopes with no second copy: in **Spaces → this space** it sets that space's
// colours, and in **Customisation** the same controls write to every space at
// once. That is how "a colour theme per space, or one over the whole app" is
// answered here — not as a global layer spaces override, which would be a
// precedence chain, and this app already has one of those to be careful about
// (see Customisation.tsx and CLAUDE.md's theme-layer section).
//
// What this page does NOT do is assign a colour to a particular note or folder.
// That is a property of the entry, not of the space, so it lives on the row
// itself — right-click it, or use the swatch in its hover actions. The banner at
// the bottom says so, because "where do I actually set one" is the first
// question this page raises.

// Quietest to loudest, which is also the order they read in the preview below.
const STYLES: { id: ColorStyle; label: string; hint: string }[] = [
  {
    id: 'tag',
    label: 'A coloured tag',
    hint: 'The six-dot handle at the head of the row becomes the colour. Marks the row without recolouring it.'
  },
  {
    id: 'row',
    label: 'A tinted row',
    hint: 'The row washes in the colour, with a solid edge down its leading side. Reads from further away, and still reads as a sidebar row.'
  },
  {
    id: 'solid',
    label: 'A solid row',
    hint: 'The row IS the colour, edge to edge. The name switches to black or white — whichever reads on that colour. Loudest, and hardest to miss.'
  }
]

/** A miniature of two sidebar rows, painted the way the current settings would
 *  paint them. Every control on this page changes something you cannot see from
 *  inside the settings window — the sidebar is behind it — so the page shows
 *  the result itself rather than describing it. */
function Preview({ space }: { space: Space }): React.JSX.Element {
  const hex = space.colorPalette[0] ?? DEFAULT_PALETTE[0]
  const vars = {
    '--row-rgb': rgbChannels(hex),
    '--row-ink': inkOn(hex) === 'dark' ? '0 0 0' : '255 255 255'
  } as React.CSSProperties
  const tint = 'tint-' + space.colorStyle

  const row = (name: string, sub: string, child: boolean): React.JSX.Element => (
    <div
      className={`tree-row flex items-center pr-1.5 ${child && !space.colorInherit ? '' : tint}`}
      style={{ ...vars, paddingLeft: child ? 22 : 8 }}
    >
      <span className="grip shrink-0 text-ink-300" style={{ opacity: 1 }}>
        <Icon name="grip" />
      </span>
      <span className="shrink-0 text-ink-300">
        <Icon name={child ? 'doc' : 'folder'} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="tree-title truncate font-medium text-ink-900">{name}</span>
        <span className="tree-sub truncate text-ink-500">{sub}</span>
      </span>
    </div>
  )

  return (
    <div className="rounded-xl border border-ink-300/20 bg-paper/40 p-2">
      {row('Physics', 'A coloured folder', false)}
      <div className="mt-0.5">{row('Waves.md', 'A note inside it', true)}</div>
    </div>
  )
}

export function SpaceColour({ space, onChange, onColorExisting }: ColourProps): React.JSX.Element {
  const [draft, setDraft] = useState(space.colorPalette[0] ?? DEFAULT_PALETTE[0])
  const [adding, setAdding] = useState(false)
  const full = space.colorPalette.length >= PALETTE_MAX

  const add = (hex: string): void => {
    if (space.colorPalette.includes(hex) || full) return
    onChange({ colorPalette: [...space.colorPalette, hex] })
  }
  const remove = (hex: string): void =>
    onChange({ colorPalette: space.colorPalette.filter((c) => c !== hex) })

  return (
    <>
      <section className="settings-group">
        <h3>How a colour shows</h3>
        <p className="hint">
          Where a note&apos;s or folder&apos;s colour is painted in the sidebar. The colours
          themselves are set on the rows, not here.
        </p>
        <div className="mode-row">
          {STYLES.map((s) => {
            const on = space.colorStyle === s.id
            return (
              <button
                key={s.id}
                className={'mode-btn' + (on ? ' on' : '')}
                aria-pressed={on}
                onClick={() => onChange({ colorStyle: s.id })}
              >
                <span className="t">{s.label}</span>
                <span className="s">{s.hint}</span>
              </button>
            )
          })}
        </div>

        <div className="mt-3">
          <Preview space={space} />
        </div>

        <div className="mt-3">
          <ToggleRow
            on={space.colorInherit}
            onClick={() => onChange({ colorInherit: !space.colorInherit })}
            label="Notes take their folder’s colour"
            hint="A note or subfolder with no colour of its own shows the nearest coloured folder above it, so a coloured folder reads as one group. Off, only what you colour directly is coloured."
          />
        </div>
      </section>

      <section className="settings-group">
        <h3>Your palette</h3>
        <p className="hint">
          The colours offered as one-click picks when you colour a row — and the ones auto-colour
          draws from. Up to {PALETTE_MAX}. Any colour at all is still reachable from the picker on
          the row itself.
        </p>

        <div className="flex flex-wrap items-center gap-1.5 py-1">
          {space.colorPalette.map((hex) => (
            <span key={hex} className="group relative inline-flex">
              <Swatch hex={hex} label={hex} onClick={() => setDraft(hex)} />
              <button
                onClick={() => remove(hex)}
                data-tip={`Remove ${hex} from the palette`}
                aria-label={`Remove ${hex}`}
                className="absolute -right-1 -top-1 hidden h-3.5 w-3.5 items-center justify-center rounded-full border-none bg-surface p-0 text-ink-500 shadow-card outline-none group-hover:flex hover:text-brand-600"
              >
                <Icon name="x" className="h-2.5 w-2.5" />
              </button>
            </span>
          ))}
          <button
            className="mini"
            disabled={full}
            data-tip={full ? `The palette holds ${PALETTE_MAX} colours` : 'Add a colour'}
            onClick={() => setAdding((a) => !a)}
          >
            {adding ? 'Done' : '+ Add'}
          </button>
          {space.colorPalette.length === 0 && (
            <button className="mini" onClick={() => onChange({ colorPalette: [...DEFAULT_PALETTE] })}>
              Restore the starter set
            </button>
          )}
        </div>

        {adding && (
          <div className="fade-in mt-2 w-[236px] rounded-xl border border-ink-300/25 bg-paper/40 p-2.5">
            <ColorField value={draft} onChange={setDraft} />
            <button
              className="mini mt-2.5 w-full"
              disabled={full || space.colorPalette.includes(draft)}
              onClick={() => add(draft)}
            >
              {space.colorPalette.includes(draft) ? 'Already on the palette' : `Add ${draft}`}
            </button>
          </div>
        )}
      </section>

      <section className="settings-group">
        <h3>Colour new folders automatically</h3>
        <p className="hint">
          For when you want folders to look different from each other without deciding on a colour
          every time you make one.
        </p>
        <ToggleRow
          on={space.colorAuto}
          onClick={() => {
            const next = !space.colorAuto
            onChange({ colorAuto: next })
            // Switching it ON also colours the folders you already have. The
            // switch is off by default, so by the time anyone reaches it they
            // have a sidebar full of folders — and a setting whose whole promise
            // is "folders look different from each other" that changed nothing
            // visible would read as broken. Only uncoloured folders are touched,
            // so a colour you chose by hand survives.
            if (next) onColorExisting()
          }}
          label="Give a new folder a colour"
          hint="A folder you create gets one of your palette colours straight away — picked from the ones its neighbours aren’t using, so two folders side by side don’t come out the same. Notes aren’t coloured individually; they take their folder’s. Change any of them afterwards, or clear it."
        />
        {space.colorAuto ? (
          space.colorPalette.length === 0 ? (
            <p className="mt-2 px-1 text-[11.5px] leading-relaxed text-ink-400">
              Your palette is empty, so there is nothing to assign — add a colour above and new
              folders will start taking one.
            </p>
          ) : (
            <div className="mt-3 flex items-center gap-2">
              <p className="flex-1 text-[11.5px] leading-relaxed text-ink-400">
                Your existing folders were coloured when you switched this on. Made more since, or
                changed your palette? Run it again — folders you coloured yourself are left alone.
              </p>
              <button className="mini shrink-0" onClick={onColorExisting}>
                Colour existing folders
              </button>
            </div>
          )
        ) : null}
      </section>

      <p className="rounded-xl bg-brand-500/8 px-3 py-2.5 text-[11.5px] leading-relaxed text-ink-500 ring-1 ring-brand-300/40">
        <span className="font-medium text-brand-600">To colour one note or folder:</span> hover its
        row in the sidebar and click the circle in the buttons that appear, or right-click the row
        and choose <span className="font-medium text-ink-600">Colour…</span>. Select several rows
        with their six-dot handles first and the picker colours all of them at once.
      </p>
    </>
  )
}
