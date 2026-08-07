import { useEffect, useRef, useState } from 'react'
import {
  activeSpace,
  SPACE_CAP,
  withNewSpace,
  withoutSpace,
  withSpacePatch,
  withSpaceRenamed,
  type AppSettings,
  type Space
} from '../../../shared/settings'
import { ACCENT_MODES, ACCENTS, DENSITIES, TEXT_TONES, THEMES } from './model'
import { Icon } from '../icons'
import { SettingRow, ToggleRow } from './primitives'
import { ActionGrid, SlotFace } from '../editor/SlotPicker'
import { SpaceForm } from './SpaceForm'
import { findAction, SLOT_LABELS } from '../editor/commands'
import { PRESET_DRAG, PresetLibrary, type PresetActions } from './Presets'
import { ALL_PARTS, vaultName, type SpacePreset } from '../../../shared/presets'

// Settings -> Spaces. Up to five presets; each carries its own look, its own
// sidebar arranging and its own format-bar buttons, so a maths-revision space
// can hold the formula shortcut while a journal space doesn't.
//
// A Space is a LOOK PRESET. It does not filter or scope the sidebar tree — see
// the header comment in shared/settings.ts before adding anything that would.

/** The folder operations a space needs. They live in App (which owns the vault
 *  IPC and the tree refresh) and are threaded down, so this file never touches
 *  `window.api` itself. Each returns what main actually did, or null on failure
 *  — a rename can be refused by the filesystem, and settings must not record a
 *  move that didn't happen. */
export interface SpaceActions {
  /** create a new top-level folder; returns its name */
  onCreateSpace: () => Promise<string | null>
  /** rename a top-level folder; returns the name it actually landed on */
  onRenameSpace: (from: string, to: string) => Promise<string | null>
  /** send a top-level folder to the OS trash (never the app's own bin — see
   *  CLAUDE.md); returns whether it went */
  onDeleteSpace: (folder: string) => Promise<boolean>
  /** Reload the tree, register any new top-level folder as a space, then switch
   *  to `folder`. What an import needs when it finishes: everything it wrote
   *  went through the vault's own echo-guard (`markWrite`), so the watcher
   *  deliberately stays silent about the app's own writes and NOTHING would
   *  otherwise tell the sidebar that a whole new space had appeared — the notes
   *  were on disk but invisible until a restart. Lives here for the same reason
   *  `onColorExistingFolders` does: it needs the tree and the active space,
   *  which App owns. */
  onOpenSpace: (folder: string) => Promise<void>
  /** Colour every folder in these spaces that hasn't got a colour of its own.
   *  What turning "colour new folders automatically" ON applies to the folders
   *  you already have — the setting would otherwise only ever reach folders you
   *  make from now on, which reads as it not working. Takes a list because the
   *  same control exists in the whole-app scope, where it means every space.
   *  Lives here rather than in the settings component because it needs the file
   *  tree and the workspace, both of which App owns. */
  onColorExistingFolders: (spaceFolders: string[]) => void
}

interface Props {
  settings: AppSettings
  onChange: (partial: Partial<AppSettings>) => void
  actions: SpaceActions
  /** the saved-preset library — see Presets.tsx and shared/presets.ts */
  presets: SpacePreset[]
  presetActions: PresetActions
  /** absolute path of the open vault; only its folder name is used, to tell a
   *  preset that IS one of these spaces from one carried in from elsewhere */
  vault: string | null
}

/** The per-space sections take the space directly; the binding to a settings
 *  write happens once, in `Spaces` below. */
export interface SpaceProps {
  space: Space
  onChange: (patch: Partial<Space>) => void
}

// Fixed swatch colours for the theme preview cards, so each card always shows
// its own theme regardless of the theme currently in effect. `line` is the two
// faux text lines drawn on the page half: without them Dark and Extra dark are
// two near-black rectangles you cannot tell apart at 46px.
const THEME_PREVIEW: Record<Space['theme'], { side: string; main: string; line: string }> = {
  dark: { side: '#161616', main: '#000000', line: '#8f8f8f' },
  black: { side: '#0a0a0a', main: '#000000', line: '#8f8f8f' },
  light: { side: '#ffffff', main: '#f7f7f6', line: '#a3a3a3' }
}

// Deliberately single-code-point emoji with no U+FE0F variation selector: the
// app bundles no emoji font (that would be a ~10MB dependency), so these render
// from the OS — Segoe UI Emoji on Windows, Apple Color Emoji on macOS — and a
// VS16 sequence can come out monochrome on Windows.
const EMOJI: { group: string; items: string[] }[] = [
  {
    group: 'Objects',
    items: ['📝', '📎', '📌', '📁', '📓', '📚', '🔖', '🔑', '💼', '📦', '🧰', '🔨', '🧪', '🎒', '💻', '📱']
  },
  {
    group: 'Symbols',
    items: ['⭐', '✨', '🔥', '⚡', '💡', '🎯', '🧩', '✅', '❌', '🚩', '💎', '🏆', '🔔', '🎉', '💜', '💙']
  },
  {
    group: 'Nature',
    items: ['🌿', '🌸', '🌊', '🌙', '🌵', '🍃', '🌻', '🌲', '🐝', '🦋', '🐬', '🌍', '🍂', '🌴', '🗻', '🌞']
  },
  {
    group: 'Activity',
    items: ['🧠', '👋', '🎧', '🏃', '🧘', '☕', '🍜', '🎸', '🎨', '🎬', '📷', '🎤', '🏀', '⚽', '🎮', '🥁']
  },
  {
    group: 'Places',
    items: ['🏠', '🏢', '🏡', '🏫', '🏥', '🏰', '🚀', '🚗', '🚲', '🛫', '🧭', '🌆', '🌉', '🗽', '🎡', '⛺']
  }
]

/** What a space is called. Its folder name IS its name; the fallback only shows
 *  for the whole-vault space a folder-less vault falls back to. */
const spaceLabel = (s: Space): string => s.folder || 'Whole vault'

// --- the page --------------------------------------------------------------

export function Spaces({
  settings,
  onChange,
  actions,
  presets,
  presetActions,
  vault
}: Props): React.JSX.Element {
  const spaces = settings.spaces
  const space = activeSpace(settings)
  const [busy, setBusy] = useState(false)
  /** the folder a dragged preset is currently hovering, so the tab it would
   *  land on says so */
  const [over, setOver] = useState<string | null>(null)
  // ONE place binds a space patch to a settings write; everything below just
  // patches the space and never has to know spaces exist.
  const patch = (p: Partial<Space>): void => onChange(withSpacePatch(settings, space.folder, p))

  // Creating, renaming and deleting a space are all real folder operations, so
  // they go through main and only touch settings with the path main actually
  // used — it sanitises names and de-duplicates, so what you asked for is not
  // always what you got.
  const addSpace = async (): Promise<void> => {
    setBusy(true)
    try {
      const folder = await actions.onCreateSpace()
      if (folder) onChange(withNewSpace(settings, folder))
    } finally {
      setBusy(false)
    }
  }
  const renameSpace = async (to: string): Promise<void> => {
    if (!space.folder || !to || to === space.folder) return
    setBusy(true)
    try {
      const actual = await actions.onRenameSpace(space.folder, to)
      if (actual) onChange(withSpaceRenamed(settings, space.folder, actual))
    } finally {
      setBusy(false)
    }
  }
  /** This space's own auto-saved preset, if it has one — what the delete
   *  confirmation offers to remove alongside the folder. */
  const ownPreset = presets.find(
    (p) => p.name === space.folder && !!vault && p.origin === vaultName(vault)
  )

  const deleteSpace = async (alsoPreset: boolean): Promise<void> => {
    if (!space.folder) return
    setBusy(true)
    try {
      // Straight to the OS trash, not the app's own bin — a space sitting in
      // the same bin as an individually-trashed note is confusing. The
      // two-step button below is the confirmation.
      const ok = await actions.onDeleteSpace(space.folder)
      if (ok) {
        onChange(withoutSpace(settings, space.folder))
        // Only after the folder actually went: a refused delete must not take
        // the saved look with it.
        if (alsoPreset && ownPreset) presetActions.onDelete(ownPreset.id)
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <section className="settings-group">
        <h3>Spaces</h3>
        <p className="hint">
          A space is a top-level folder in your vault, with its own look — theme, sidebar arranging
          and format-bar buttons. Everything you make in the sidebar lives inside the space you&apos;re
          in. Pick one here and the app switches to it.
        </p>

        <div className="space-tabs" role="tablist" aria-label="Spaces">
          {spaces.map((s, i) => {
            const on = s.folder === space.folder
            // Each tab is also where a saved look lands. Only a preset drag is
            // accepted (`PRESET_DRAG`), so a tab dragged from the editor's own
            // strip passes straight over it.
            const canDrop = (e: React.DragEvent): boolean =>
              !!s.folder && e.dataTransfer.types.includes(PRESET_DRAG)
            return (
              <button
                key={s.folder}
                role="tab"
                aria-selected={on}
                data-tip={spaceLabel(s)}
                className={
                  'space-tab' + (on ? ' on' : '') + (over === s.folder ? ' drop' : '')
                }
                onClick={() => onChange({ activeSpaceFolder: s.folder })}
                onDragOver={(e) => {
                  if (!canDrop(e)) return
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'copy'
                  setOver(s.folder)
                }}
                onDragLeave={() => setOver((f) => (f === s.folder ? null : f))}
                onDrop={(e) => {
                  setOver(null)
                  if (!canDrop(e)) return
                  e.preventDefault()
                  const id = e.dataTransfer.getData(PRESET_DRAG)
                  const preset = presets.find((p) => p.id === id)
                  // A drop copies the WHOLE look. There are no tick boxes on a
                  // drag, so it must mean one predictable thing rather than
                  // quietly inheriting whatever was last ticked in a menu the
                  // user may never have opened.
                  if (preset) presetActions.onApply(preset, s.folder, ALL_PARTS)
                }}
              >
                <span className="em">{s.emoji || i + 1}</span>
                <span className="nm">{spaceLabel(s)}</span>
              </button>
            )
          })}
          <button
            className="space-add"
            disabled={busy || spaces.length >= SPACE_CAP}
            data-tip={
              spaces.length >= SPACE_CAP
                ? `You can have up to ${SPACE_CAP} spaces`
                : 'Add a space — creates a new folder in your vault'
            }
            aria-label="Add a space"
            onClick={() => void addSpace()}
          >
            <Icon name="plus" className="h-4 w-4" />
          </button>
        </div>
        {spaces.length === 0 && (
          <p className="mt-3 rounded-xl border border-dashed border-ink-300/30 px-4 py-5 text-center text-[12px] leading-relaxed text-ink-400">
            Your vault has no folders yet, so the sidebar is showing everything in it. Add a space to
            start dividing it up — Revision, Work, Journal.
          </p>
        )}
      </section>


      <section className="settings-group">
        <h3>{spaceLabel(space)}</h3>
        {/* The scope is stated rather than assumed: the settings here belong to
            one space, but Saved presets below is a shared library, and a
            heading claiming otherwise directly above it reads as a bug. */}
        <p className="hint">
          The settings below belong to this space alone. Your saved presets, at the bottom, are
          shared — any space can use any of them.
        </p>

        <SettingRow
          title="Name"
          desc={
            space.folder
              ? 'This is the folder name in your vault — renaming it here renames the folder on disk.'
              : 'The whole vault. Add a space above to give it a name.'
          }
        >
          {/* keyed on the folder so switching tabs reseeds the draft */}
          <NameField
            key={space.folder}
            value={space.folder}
            disabled={!space.folder || busy}
            onCommit={(to) => void renameSpace(to)}
          />
        </SettingRow>
        <div className="border-t border-ink-300/15" />

        <SettingRow title="Representational emoji" desc="Shown on the switcher and the tab above, so you can tell them apart at a glance.">
          <EmojiPicker value={space.emoji} onPick={(emoji) => patch({ emoji })} />
        </SettingRow>
        <div className="border-t border-ink-300/15" />

        {/* Folded, and directly under the identity rows: a library of looks is
            not what you open this page for, so it stays one click away rather
            than sitting above the settings you came to change. */}
        <div className="pt-3">
          <Disclosure
            label="Saved presets"
            hint={
              (presets.length === 1 ? '1 saved look' : `${presets.length} saved looks`) +
              ', kept in the app and shared across all your spaces — apply, delete, import or share them'
            }
          >
            <PresetLibrary
              presets={presets}
              openVault={vault ? vaultName(vault) : ''}
              spaces={spaces}
              actions={presetActions}
            />
          </Disclosure>
        </div>
      </section>

      <ThemeCards space={space} onChange={patch} />

      {/* The SAME form Customisation shows — one component, so "this space
          only" and "every space" can never offer different options or lay them
          out differently. Only where the change lands differs. */}
      <div className="flex flex-col gap-2">
        <p className="px-1 text-[11.5px] leading-relaxed text-ink-400">
          These belong to this space alone. The same list is in{' '}
          <span className="font-medium text-ink-500">Customisation</span>, where changing one
          answers it for every space at once.
        </p>
        <SpaceForm
          space={space}
          onChange={patch}
          onColorExisting={() => actions.onColorExistingFolders([space.folder])}
        />
      </div>

      <ComingSoon />

      {space.folder && (
        <div className="mt-2 flex items-center gap-2 border-t border-ink-300/15 pt-4">
          <p className="flex-1 text-[11.5px] leading-relaxed text-ink-400">
            Deleting a space sends its folder — and every note in it — to your computer&apos;s
            Recycle Bin, not this app&apos;s own bin. Recover it from there if you need to.
            {ownPreset && ' Its saved look is kept unless you say otherwise.'}
          </p>
          <DeleteSpace
            disabled={busy}
            hasPreset={!!ownPreset}
            onDelete={(alsoPreset) => void deleteSpace(alsoPreset)}
          />
        </div>
      )}
    </>
  )
}

// --- identity --------------------------------------------------------------

/** Commits on blur and Enter, reverts on Escape — the same idiom the note title
 *  uses (App.tsx). Writing per keystroke would be a full settings.json rewrite
 *  per letter, on a vault that may be inside OneDrive. */
function NameField({
  value,
  disabled,
  onCommit
}: {
  value: string
  disabled?: boolean
  onCommit: (v: string) => void
}): React.JSX.Element {
  const [draft, setDraft] = useState(value)
  return (
    <input
      value={draft}
      disabled={disabled}
      placeholder="Unnamed"
      maxLength={40}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft.trim() !== value && onCommit(draft.trim())}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        else if (e.key === 'Escape') {
          e.stopPropagation() // don't let it close the settings window
          setDraft(value)
          ;(e.target as HTMLInputElement).blur()
        }
      }}
      className="w-44 rounded-lg bg-brand-500/8 px-2.5 py-1.5 text-[12.5px] text-ink-900 outline-none placeholder:text-ink-400 focus-visible:ring-2 focus-visible:ring-brand-300 disabled:opacity-40"
    />
  )
}

/** A curated grid rather than a full emoji keyboard — a searchable set of
 *  several thousand would mean shipping an emoji data table, and picking a tab
 *  marker is not a task that needs one. */
function EmojiPicker({ value, onPick }: { value: string; onPick: (e: string) => void }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLSpanElement>(null)

  // Same close rules as the Select primitive: click-outside, and Escape
  // captured so it closes this rather than the settings window behind it.
  useEffect(() => {
    if (!open) return
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
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  return (
    <span ref={box} className="relative inline-flex">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={
          'flex items-center gap-1.5 rounded-lg border border-ink-300/30 px-2.5 py-1.5 text-[12.5px] font-medium outline-none transition duration-200 focus-visible:ring-2 focus-visible:ring-brand-300 ' +
          (open ? 'bg-brand-500/12 text-brand-600' : 'btn-edge bg-surface/70 text-ink-700 hover:text-brand-600')
        }
      >
        <span className="text-[15px] leading-none">{value || '🙂'}</span>
        <span>{value ? 'Change' : 'Select'}</span>
      </button>

      {open && (
        <div className="fade-in absolute right-0 top-9 z-40 max-h-[min(360px,55vh)] w-[268px] overflow-y-auto rounded-xl border border-ink-300/25 bg-surface p-2.5 shadow-float">
          {EMOJI.map(({ group, items }) => (
            <div key={group}>
              <p className="pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-400">
                {group}
              </p>
              <div className="grid grid-cols-8 gap-1">
                {items.map((e) => (
                  <button
                    key={e}
                    data-tip={e}
                    onClick={() => {
                      onPick(e)
                      setOpen(false)
                    }}
                    className={
                      'flex h-7 w-7 items-center justify-center rounded-md border-none text-[15px] leading-none outline-none transition duration-150 ' +
                      (e === value ? 'bg-brand-500/15 ring-1 ring-brand-400' : 'bg-transparent hover:bg-brand-500/10')
                    }
                  >
                    {e}
                  </button>
                ))}
              </div>
            </div>
          ))}
          <button
            onClick={() => {
              onPick('')
              setOpen(false)
            }}
            className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-lg border-none bg-transparent py-1.5 text-[12px] text-ink-500 outline-none transition duration-150 hover:bg-brand-500/10 hover:text-brand-600"
          >
            <Icon name="x" className="h-3.5 w-3.5" />
            <span>No emoji</span>
          </button>
        </div>
      )}
    </span>
  )
}

/** Two-step rather than a confirm dialog: there's no confirm primitive in the
 *  app, and window.confirm blocks the Electron renderer and looks foreign.
 *
 *  The "and its saved look" tick appears only once armed, and only when there IS
 *  one — a permanently visible checkbox would put a second decision in front of
 *  a button most people press without wanting either. Unticked by default: the
 *  library outliving a folder is the whole point of it, so throwing a look away
 *  has to be the thing you asked for. */
function DeleteSpace({
  disabled,
  hasPreset,
  onDelete
}: {
  disabled?: boolean
  hasPreset: boolean
  onDelete: (alsoPreset: boolean) => void
}): React.JSX.Element {
  const [armed, setArmed] = useState(false)
  const [alsoPreset, setAlsoPreset] = useState(false)
  useEffect(() => {
    if (!armed) return
    const t = setTimeout(() => {
      setArmed(false)
      setAlsoPreset(false)
    }, 5000)
    return () => clearTimeout(t)
  }, [armed])
  return (
    <span className="flex shrink-0 items-center gap-2">
      {armed && hasPreset && (
        <button
          role="checkbox"
          aria-checked={alsoPreset}
          onClick={() => setAlsoPreset((v) => !v)}
          className="flex items-center gap-1.5 rounded-lg px-1.5 py-1 text-[11.5px] text-ink-500 outline-none transition duration-150 hover:bg-brand-500/8 focus-visible:ring-2 focus-visible:ring-brand-300"
        >
          <span
            aria-hidden="true"
            className={
              'flex h-3.5 w-3.5 items-center justify-center rounded-[4px] border ' +
              (alsoPreset ? 'border-brand-400 bg-brand-500/25 text-brand-600' : 'border-ink-300/50')
            }
          >
            {alsoPreset && <Icon name="check" className="h-3 w-3" />}
          </span>
          and its saved look
        </button>
      )}
      <button
        disabled={disabled}
        className={'mini shrink-0' + (armed ? ' danger' : '')}
        onClick={() => (armed ? onDelete(alsoPreset) : setArmed(true))}
      >
        {armed ? 'Click again to delete' : 'Delete space'}
      </button>
    </span>
  )
}

// --- the collapsible sections ---------------------------------------------

/** Mount/unmount rather than an animated height: animating to `auto` needs a
 *  measured max-height, and the Shortcuts body is tall and variable — a wrong
 *  one clips the action grid. Container classes copied from ToggleRow so an
 *  open section lines up with the rows inside it (rule 8). */
export function Disclosure({
  label,
  hint,
  children
}: {
  label: string
  hint: string
  children: React.ReactNode
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const id = `disclosure-${label.toLowerCase()}`
  return (
    <div>
      <button
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className="btn-edge flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left outline-none ring-1 ring-ink-300/20 transition duration-200 hover:bg-brand-500/8 focus-visible:ring-2 focus-visible:ring-brand-300"
      >
        <span className="min-w-0 flex-1">
          <span className={'block text-[13px] font-medium ' + (open ? 'text-brand-600' : 'text-ink-700')}>
            {label}
          </span>
          <span className="mt-0.5 block text-[11.5px] leading-relaxed text-ink-400">{hint}</span>
        </span>
        <span
          className={
            'inline-flex shrink-0 text-ink-400 transition-transform duration-200 ' + (open ? 'rotate-90' : '')
          }
        >
          <Icon name="chevron" className="h-4 w-4" />
        </span>
      </button>
      {open && (
        <div id={id} className="fade-in flex flex-col gap-6 px-3 pb-2 pt-4">
          {children}
        </div>
      )}
    </div>
  )
}

/** Theme sits outside the Appearance disclosure — it's the setting people come
 *  to a space for, so it stays one click away. Text colour rides along with it:
 *  it only means anything on a dark theme, so it belongs beside the choice that
 *  makes it relevant rather than three sections away. */
function ThemeCards({ space, onChange }: SpaceProps): React.JSX.Element {
  return (
    <section className="settings-group">
      <h3>Theme</h3>
      <p className="hint">Applies to the whole app while you're in this space, editor included.</p>
      <div className="theme-cards">
        {THEMES.map((t) => {
          const p = THEME_PREVIEW[t.id]
          const on = space.theme === t.id
          return (
            <button
              key={t.id}
              className={'theme-card' + (on ? ' on' : '')}
              aria-pressed={on}
              data-tip={t.hint}
              onClick={() => onChange({ theme: t.id })}
            >
              <span className="preview" aria-hidden="true">
                <span className="side" style={{ background: p.side }} />
                <span className="main" style={{ background: p.main }}>
                  <span className="line" style={{ background: p.line, width: '62%' }} />
                  <span className="line" style={{ background: p.line, width: '44%' }} />
                </span>
              </span>
              <span className="label-row">
                {on ? '✓ ' : ''}
                {t.label}
              </span>
              <span className="sub-row">{t.hint}</span>
            </button>
          )
        })}
      </div>

      <div className="mt-5 border-t border-ink-300/15 pt-4">
        <h3>Text colour</h3>
        <p className="hint">
          How bright the writing sits on a dark background.{' '}
          {space.theme === 'light'
            ? 'The light theme always uses dark ink, so this applies to the two dark themes.'
            : 'Grey is easier over a long session; white is sharpest against Extra dark.'}
        </p>
        <div className="mode-row">
          {TEXT_TONES.map((t) => {
            const on = space.textTone === t.id
            return (
              <button
                key={t.id}
                className={'mode-btn disabled:opacity-40 disabled:cursor-default' + (on ? ' on' : '')}
                aria-pressed={on}
                disabled={space.theme === 'light'}
                onClick={() => onChange({ textTone: t.id })}
              >
                <span className="t">
                  <span
                    aria-hidden="true"
                    className="mr-2 inline-block h-2.5 w-2.5 rounded-full ring-1 ring-ink-300/40 align-[-1px]"
                    style={{ background: t.swatch }}
                  />
                  {t.label}
                </span>
                <span className="s">{t.hint}</span>
              </button>
            )
          })}
        </div>
      </div>
    </section>
  )
}

export function SpaceAppearance({ space, onChange }: SpaceProps): React.JSX.Element {
  return (
    <>
      <section className="settings-group">
        <h3>Accent</h3>
        <p className="hint">Pick a colour, then choose how far it reaches. Works with either theme.</p>
        <div className="accent-dots">
          {ACCENTS.map((a) => {
            const on = space.accent === a.id
            const bg =
              a.hue == null ? (space.theme === 'light' ? '#1a1a1a' : '#e8e8e8') : `hsl(${a.hue} 50% 55%)`
            return (
              <button
                key={a.id}
                className={'accent-dot' + (on ? ' on' : '')}
                data-tip={a.label}
                aria-label={a.label}
                aria-pressed={on}
                style={{ background: bg }}
                onClick={() => onChange({ accent: a.id })}
              />
            )
          })}
        </div>
        <div className="mode-row">
          {ACCENT_MODES.map((m) => {
            const on = space.accentMode === m.id
            return (
              <button
                key={m.id}
                className={'mode-btn' + (on ? ' on' : '')}
                aria-pressed={on}
                onClick={() => onChange({ accentMode: m.id })}
              >
                <span className="t">{m.label}</span>
                <span className="s">{m.hint}</span>
              </button>
            )
          })}
        </div>
      </section>

      <section className="settings-group">
        <h3>Button definition</h3>
        <p className="hint">How hard the edges of buttons and controls read against the page.</p>
        <ToggleRow
          on={space.buttonDefinition}
          onClick={() => onChange({ buttonDefinition: !space.buttonDefinition })}
          label="Stronger button edges"
          hint="Outlines every button, toggle and picker a step further off the background — lighter on Dark, light grey on Extra dark, a darker grey on Light. Buttons drawn without an edge in the first place (Note, Folder) stay as they are."
        />
      </section>

      <section className="settings-group">
        <h3>Density</h3>
        <p className="hint">How tightly notes and folders pack in the sidebar.</p>
        <div className="density-list">
          {DENSITIES.map((d) => {
            const on = space.density === d.id
            return (
              <button
                key={d.id}
                className={'density-row' + (on ? ' on' : '')}
                aria-pressed={on}
                onClick={() => onChange({ density: d.id })}
              >
                <span className="density-bars" style={{ gap: d.bar.gap }} aria-hidden="true">
                  {[0, 1, 2].map((i) => (
                    <span key={i} style={{ height: d.bar.h }} />
                  ))}
                </span>
                <span className="meta">
                  <span className="t">{d.label}</span>
                  <span className="s">{d.hint}</span>
                </span>
                {on ? <span aria-hidden="true">✓</span> : null}
              </button>
            )
          })}
        </div>
      </section>
    </>
  )
}

export function SpaceArranging({ space, onChange }: SpaceProps): React.JSX.Element {
  return (
    <>
      <section className="settings-group">
        <h3>Order</h3>
        <p className="hint">How the sidebar lays out each level.</p>
        <ToggleRow
          on={space.freeArrange}
          onClick={() => onChange({ freeArrange: !space.freeArrange })}
          label="Mix notes and folders freely"
          hint="Off, folders sit at the top of each level with notes underneath. On, they share one order — drag a note above a folder, or a folder between two notes, and it stays there."
        />
        <p className="mt-3 px-1 text-[11.5px] leading-relaxed text-ink-400">
          Your arrangement is stored the same way either way, so switching this on and back off never
          scrambles anything.
        </p>
      </section>

      <section className="settings-group">
        <h3>Nav buttons</h3>
        <p className="hint">Note / Folder, above the sidebar&apos;s note list.</p>
        <ToggleRow
          on={space.compactNav}
          onClick={() => onChange({ compactNav: !space.compactNav })}
          label="Icons only"
          hint="Drop the text labels once you know what each icon does — they centre as a small group instead. Hover still shows what each one does. The sidebar already does this on its own once you drag it narrower than ~220px; this makes it permanent at any width."
        />
      </section>
    </>
  )
}

/** The four programmable format-bar buttons. Laid out as the bar itself so it's
 *  obvious *where* each slot lands: pick a slot in the preview, then pick what
 *  it does from the same catalogue the bar's own "?" popover offers. */
export function SpaceShortcuts({ space, onChange }: SpaceProps): React.JSX.Element {
  const slots = space.toolbarSlots
  const [active, setActive] = useState(0)
  const assign = (id: string): void => {
    const next = [...slots]
    next[active] = id
    onChange({ toolbarSlots: next })
  }

  const slotBtn = (i: number): React.JSX.Element => {
    const on = active === i
    return (
      <button
        key={i}
        onClick={() => setActive(i)}
        aria-pressed={on}
        data-tip={`${SLOT_LABELS[i]} button`}
        className={
          'flex h-7 w-7 items-center justify-center rounded-md border-none p-0 outline-none transition duration-150 ' +
          (on
            ? 'bg-brand-500/15 text-brand-600 ring-2 ring-brand-400'
            : slots[i]
              ? 'bg-transparent text-ink-500 hover:bg-brand-500/10'
              : 'bg-transparent text-ink-300 hover:bg-brand-500/10')
        }
      >
        <SlotFace id={slots[i] ?? ''} />
      </button>
    )
  }
  // The built-ins, shown greyed so the preview reads as the real bar. Not
  // buttons — there is nothing to click here.
  const fixed = (label: string, cls = ''): React.JSX.Element => (
    <span
      key={label}
      className={'flex h-7 w-7 items-center justify-center text-[14px] leading-none text-ink-400/70 ' + cls}
    >
      {label}
    </span>
  )
  const divider = (k: string): React.JSX.Element => <span key={k} className="mx-1.5 h-4 w-px bg-ink-300/25" />

  return (
    <section className="settings-group">
      <h3>Custom buttons</h3>
      <p className="hint">
        Two buttons on each side of the format bar above a note, for the commands you reach for most.
        Empty ones show a <span className="font-semibold">?</span> — click one there or here to programme
        it. These belong to this space, so each one can have its own set.
      </p>

      <div className="flex items-center justify-center gap-0.5 rounded-xl border border-ink-300/20 bg-paper/40 px-4 py-2">
        {slotBtn(0)}
        {slotBtn(1)}
        {divider('a')}
        {fixed('B', 'font-bold')}
        {fixed('I', 'font-display italic')}
        {fixed('U', 'underline underline-offset-2')}
        {fixed('S', 'line-through')}
        {divider('b')}
        {fixed('A')}
        {divider('c')}
        {slotBtn(2)}
        {slotBtn(3)}
      </div>

      <div className="mt-4 flex items-baseline gap-2">
        <p className="flex-1 text-[12.5px] text-ink-700">
          <span className="font-semibold text-brand-600">{SLOT_LABELS[active]}</span> button —{' '}
          {findAction(slots[active] ?? '')?.label ?? 'empty'}
        </p>
        {slots.some(Boolean) && (
          <button className="mini" onClick={() => onChange({ toolbarSlots: ['', '', '', ''] })}>
            Clear all
          </button>
        )}
      </div>

      <div className="mt-1">
        <ActionGrid value={slots[active] ?? ''} onPick={assign} cols={3} />
      </div>
    </section>
  )
}

// --- the three not built yet ----------------------------------------------

/** Page look / Fonts / Tints. The fields are already persisted on a Space, so
 *  these controls light up later without a second migration — but nothing reads
 *  them yet, so both buttons are disabled rather than half-wired. */
function ComingSoon(): React.JSX.Element {
  const rows = [
    {
      title: 'Page look',
      desc: 'Write on plain, lined or paper-textured pages. Per space, so revision notes can look different from a journal.'
    },
    { title: 'Fonts', desc: 'Choose the typeface and size the editor uses in this space.' },
    {
      title: 'Tints',
      desc: 'Colour overlays that make text easier to read — useful for visual stress and dyslexia.'
    }
  ]
  return (
    <section className="settings-group">
      <h3>Page, fonts and tints</h3>
      <p className="hint">
        Coming soon. Each will be set per space, and picked from Your collection.
      </p>
      {rows.map((r, i) => (
        <div key={r.title}>
          {i > 0 && <div className="border-t border-ink-300/15" />}
          <SettingRow
            title={r.title}
            desc={r.desc}
          >
            <span className="flex items-center gap-1.5">
              <span className="rounded-full bg-brand-500/12 px-1.5 py-0.5 text-[10px] font-medium text-brand-600">
                Soon
              </span>
              <button className="mini" disabled data-tip="Coming soon">
                Choose
              </button>
              <button className="mini" disabled data-tip="Coming soon">
                Explore library
              </button>
            </span>
          </SettingRow>
        </div>
      ))}
    </section>
  )
}
