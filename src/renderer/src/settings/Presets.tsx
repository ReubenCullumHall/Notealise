import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { landMissedDrop } from '../dragLeaveGuard'
import { presetDrag } from './presetDrag'
import { createPortal } from 'react-dom'
import { Icon } from '../icons'
import {
  ALL_PARTS,
  IMPORTED_ORIGIN,
  LOOK_PARTS,
  PART_LABELS,
  type LookPart,
  type SpacePreset
} from '../../../shared/presets'
import type { Space } from '../../../shared/settings'

// Settings → Spaces → Saved presets. The saved look of every space you have ever
// had, in this vault or any other, plus anything you have been sent. See
// shared/presets.ts for the model and main/presets.ts for why it is stored in
// the app rather than in a folder.
//
// WHERE THIS SITS, AND WHY IT MOVED. It began as a section at the top of the
// Spaces page and is now a disclosure directly under that space's name and
// emoji, by the user's call after seeing it: a library of looks is not what you
// come to this page for, and putting it above the space's own settings made you
// scroll past a list to reach the thing you opened the page to change.
//
// It is SHARED, while everything else in that section belongs to one space —
// which is why the section's own intro says so out loud. A heading reading
// "everything below belongs to this space alone" directly above a shared library
// is the kind of small lie that gets read as a bug later.
//
// There is deliberately NO "save preset" button. A space writes its own preset
// when it is created and rewrites it whenever you change anything about it, so
// the library is never out of date and there is nothing to remember to press.
// What you do here is the other half: pour a saved look ONTO something, delete
// looks you are done with, and share them.

/** The drag payload for a preset ROW. Its own MIME type, so a preset dropped on
 *  the tab strip above the editor — which listens for
 *  `application/x-notes-tab` — is ignored rather than half-understood. */
export const PRESET_DRAG = 'application/x-notes-preset'

/** "Apply to every space", the entry above the individual ones in `Use on…`.
 *  Not a folder name: `''` is already the unbound whole-vault space, so this
 *  needs a value no real space can have. */
export const ALL_SPACES = '\u0000all-spaces'

export interface PresetActions {
  /** Pour `parts` of this look onto that space (or every space, for
   *  `ALL_SPACES`). The folder and its notes are never touched. */
  onApply: (preset: SpacePreset, folder: string, parts: readonly LookPart[]) => void
  /** create a folder named after the preset and apply the whole look to it */
  onNewSpace: (preset: SpacePreset) => void
  onDelete: (id: string) => void
  /** write to a `.mdpreset` file — one id, or null for the whole library */
  onExport: (ids: string[] | null) => void
  /** read one in; `text` comes from a drop, and its absence opens a picker */
  onImport: (text?: string) => void
}

interface Props {
  presets: SpacePreset[]
  /** folder name of the OPEN vault, matched against a preset's `origin` to
   *  split "this folder's spaces" from everything else */
  openVault: string
  spaces: Space[]
  actions: PresetActions
}

/**
 * Which parts the next apply will copy.
 *
 * Module scope, so the ticks survive the disclosure being collapsed and
 * reopened — which is what "remembered between uses" has to mean when the
 * container unmounts its children. Deliberately NOT persisted to disk: the
 * settings rule says a setting about how the app LOOKS belongs to a `Space`, and
 * the only app-general settings are the one-launch-one-locale ones. This is
 * neither — it is the shape of the action you are about to take, like a
 * selection, and it should not outlive the session any more than a selection
 * does.
 */
let lastParts: readonly LookPart[] = ALL_PARTS

export function PresetLibrary({ presets, openVault, spaces, actions }: Props): React.JSX.Element {
  // Grouped rather than one flat list: the library gains a row per space per
  // folder you ever open, so without this the looks from the folder you are in
  // are quickly buried under ones from folders you are not.
  const mine = presets.filter((p) => p.origin === openVault && !!openVault)
  const others = presets.filter((p) => !(p.origin === openVault && !!openVault))

  const row = (p: SpacePreset): React.JSX.Element => (
    <PresetRow
      key={p.id}
      preset={p}
      here={p.origin === openVault && !!openVault}
      spaces={spaces}
      actions={actions}
    />
  )

  return (
    <div
      className="flex flex-col gap-3"
      // Dropping a .mdpreset file anywhere on the library imports it. The file
      // is read HERE and its text passed to main — Electron removed `File.path`,
      // and `webUtils` is a whole extra bridge surface for something the drop
      // event already hands over.
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) e.preventDefault()
      }}
      onDrop={(e) => {
        const file = e.dataTransfer.files[0]
        if (!file) return
        e.preventDefault()
        void file.text().then((text) => actions.onImport(text))
      }}
    >
      <p className="px-1 text-[11.5px] leading-relaxed text-ink-400">
        Every space saves its own look here as you change it — there is nothing to press. They are
        kept in the app itself, not in your notes folder, so changing source folder never loses
        them. Drag one onto a space tab at the top of this page to give that space its look, or use
        the menu on it. This list is shared: any space can use any of them.
      </p>

      {presets.length === 0 ? (
        <p className="rounded-xl border border-dashed border-ink-300/30 px-4 py-5 text-center text-[12px] leading-relaxed text-ink-400">
          Nothing saved yet. Add a space and change how it looks — its preset appears here on its
          own. You can also import one someone sent you.
        </p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {mine.map(row)}
          {others.length > 0 && mine.length > 0 && (
            <p className="px-1 pb-0.5 pt-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-400">
              From other folders
            </p>
          )}
          {others.map(row)}
        </div>
      )}

      <div className="flex items-center gap-2 border-t border-ink-300/15 pt-3">
        <p className="min-w-0 flex-1 text-[11px] leading-relaxed text-ink-400">
          Presets are shareable files. Export one to send it to someone, or export the lot to carry
          your looks to another machine — then drop the file here, or use Import.
        </p>
        <button className="mini shrink-0" onClick={() => actions.onImport()}>
          Import…
        </button>
        <button
          className="mini shrink-0"
          disabled={presets.length === 0}
          onClick={() => actions.onExport(null)}
        >
          Export all…
        </button>
      </div>
    </div>
  )
}

function PresetRow({
  preset,
  here,
  spaces,
  actions
}: {
  preset: SpacePreset
  /** a space of the folder that's open, keeping itself up to date */
  here: boolean
  spaces: Space[]
  actions: PresetActions
}): React.JSX.Element {
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(PRESET_DRAG, preset.id)
        e.dataTransfer.effectAllowed = 'copy'
        presetDrag.id = preset.id
      }}
      onDragEnd={(e) => {
        // Let go on a lit space tab but the drop never came: give it the look anyway.
        landMissedDrop(e)
        presetDrag.id = null
      }}
      className="preset-row"
    >
      <span className="grip" aria-hidden="true">
        <Icon name="grip" className="h-3.5 w-3.5" />
      </span>
      <span className="em">{preset.look.emoji || '🎨'}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12.5px] font-medium text-ink-700">{preset.name}</span>
        <span className="block truncate text-[11px] text-ink-400">
          {here
            ? 'This space, saving automatically'
            : preset.origin === IMPORTED_ORIGIN
              ? 'Imported'
              : preset.origin}
        </span>
      </span>
      <button
        className="mini shrink-0"
        data-tip="Export this preset as a file you can share"
        aria-label="Export this preset"
        onClick={() => actions.onExport([preset.id])}
      >
        <Icon name="export" className="h-3.5 w-3.5" />
      </button>
      <UseMenu preset={preset} spaces={spaces} actions={actions} />
      <DeletePreset onDelete={() => actions.onDelete(preset.id)} />
    </div>
  )
}

/** Pick what to copy, then where to put it — in one popover, so choosing the
 *  parts costs a glance rather than a confirm step. Also the keyboard route to
 *  everything the drag does, plus the one thing it can't: making a space that
 *  doesn't exist yet.
 *
 *  Same close rules as the `Select` primitive — click-outside, and Escape
 *  captured so it closes this rather than the settings window behind it.
 *
 *  **Portalled to document.body, and that is not optional** (same trap as
 *  HoverCard.tsx). This popover lives inside the "Saved presets" `Disclosure`,
 *  whose content wrapper carries `.fade-in` — an `animation-fill-mode: both`
 *  class that leaves a permanent `transform` sitting on that wrapper even
 *  after the animation ends. Any transform makes its element a new stacking
 *  context, and that context has no z-index of its own, so it — and
 *  everything inside it, including this menu's old `z-40` — loses to any
 *  later sibling section (ThemeCards, here) regardless of how high a z-index
 *  it's given from the inside. Positioning in viewport coordinates and
 *  portalling past that ancestor sidesteps the trap entirely rather than
 *  fighting it with a bigger z-index that can't win. */
function UseMenu({
  preset,
  spaces,
  actions
}: {
  preset: SpacePreset
  spaces: Space[]
  actions: PresetActions
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [parts, setParts] = useState<readonly LookPart[]>(lastParts)
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null)
  const box = useRef<HTMLSpanElement>(null)
  const menu = useRef<HTMLDivElement>(null)

  // Anchored to the whole ROW, not just this button — its right edge is
  // where Export/Delete already sit, so the popover can't leave a sliver of
  // the row (or the next one down) exposed past its own corner.
  useLayoutEffect(() => {
    if (!open) return
    const row = box.current?.closest('.preset-row') as HTMLElement | null
    const rect = (row ?? box.current)?.getBoundingClientRect()
    if (rect) setPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right })
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      const t = e.target as Node
      if (box.current?.contains(t) || menu.current?.contains(t)) return
      setOpen(false)
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
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  const toggle = (part: LookPart): void => {
    const next = parts.includes(part) ? parts.filter((p) => p !== part) : [...parts, part]
    lastParts = next
    setParts(next)
  }
  const apply = (folder: string): void => {
    actions.onApply(preset, folder, parts)
    setOpen(false)
  }

  const named = spaces.filter((s) => s.folder)

  return (
    <span ref={box} className="inline-flex shrink-0">
      <button className="mini use-on" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        Use on…
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={menu}
            style={{ position: 'fixed', top: pos.top, right: pos.right }}
            className="fade-in z-[70] w-max min-w-[230px] rounded-xl border border-ink-300/25 bg-surface p-1 shadow-float"
          >
            <p className="px-2.5 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-400">
              What to copy
            </p>
            {LOOK_PARTS.map((part) => {
              const on = parts.includes(part)
              return (
                <button
                  key={part}
                  role="menuitemcheckbox"
                  aria-checked={on}
                  onClick={() => toggle(part)}
                  className="flex w-full items-start gap-2 rounded-lg px-2.5 py-1.5 text-left transition duration-150 hover:bg-ink-300/15"
                >
                  <span
                    aria-hidden="true"
                    className={
                      'mt-px flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[4px] border ' +
                      (on ? 'border-brand-400 bg-brand-500/20 text-brand-600' : 'border-ink-300/50')
                    }
                  >
                    {on && <Icon name="check" className="h-3 w-3" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={'block text-[12px] ' + (on ? 'text-ink-700' : 'text-ink-400')}>
                      {PART_LABELS[part].label}
                    </span>
                    <span className="block text-[10.5px] leading-snug text-ink-400">
                      {PART_LABELS[part].hint}
                    </span>
                  </span>
                </button>
              )
            })}

            <div className="my-1 border-t border-ink-300/15" />
            <p className="px-2.5 pb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-400">
              Apply to
            </p>
            {named.length > 1 && (
              <button
                disabled={parts.length === 0}
                onClick={() => apply(ALL_SPACES)}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12.5px] text-ink-700 transition duration-150 hover:bg-ink-300/15 disabled:opacity-40"
              >
                <Icon name="spaces" className="h-3.5 w-3.5 shrink-0 text-ink-400" />
                <span>All {named.length} spaces</span>
              </button>
            )}
            {named.map((s) => (
              <button
                key={s.folder}
                disabled={parts.length === 0}
                onClick={() => apply(s.folder)}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12.5px] text-ink-700 transition duration-150 hover:bg-ink-300/15 disabled:opacity-40"
              >
                <span className="w-4 shrink-0 text-center text-[13px] leading-none">{s.emoji || '·'}</span>
                <span className="min-w-0 flex-1 truncate">{s.folder}</span>
              </button>
            ))}
            <div className="my-1 border-t border-ink-300/15" />
            <button
              onClick={() => {
                actions.onNewSpace(preset)
                setOpen(false)
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12.5px] text-brand-600 transition duration-150 hover:bg-ink-300/15"
            >
              <Icon name="plus" className="h-3.5 w-3.5 shrink-0" />
              <span>New space called &ldquo;{preset.name}&rdquo;</span>
            </button>
          </div>,
          document.body
        )}
    </span>
  )
}

/** Two-step, like Delete space — there is no confirm primitive in the app, and
 *  window.confirm blocks the Electron renderer and looks foreign. */
function DeletePreset({ onDelete }: { onDelete: () => void }): React.JSX.Element {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return
    const t = setTimeout(() => setArmed(false), 3000)
    return () => clearTimeout(t)
  }, [armed])
  return (
    <button
      className={'mini shrink-0' + (armed ? ' danger' : '')}
      data-tip={armed ? undefined : 'Delete this saved preset'}
      aria-label="Delete this preset"
      onClick={() => (armed ? onDelete() : setArmed(true))}
    >
      {armed ? 'Delete?' : <Icon name="trash" className="h-3.5 w-3.5" />}
    </button>
  )
}
