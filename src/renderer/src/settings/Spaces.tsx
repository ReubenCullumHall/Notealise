import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ContextMenu } from '../ContextMenu'
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
import { ACCENT_MODES, DENSITIES, EDITOR_WIDTHS, resolveTheme, TEXT_TONES, THEMES } from './model'
import { AccentPicker } from './AccentPicker'
import { Icon } from '../icons'
import { SettingRow, ToggleRow } from './primitives'
import { useArmed } from './useArmed'
import { ActionGrid, SlotFace } from '../editor/SlotPicker'
import { SpaceForm } from './SpaceForm'
import type { FontLibrary } from './useInstalledFonts'
import { findAction, SLOT_LABELS } from '../editor/commands'
import { PRESET_DRAG, PresetLibrary, type PresetActions } from './Presets'
import { ALL_PARTS, vaultName, type SpacePreset } from '../../../shared/presets'
import { HelpTip } from '../Tooltip'
import { claimEscape } from './escapeClaims'

/** Shown next to the option to keep a space's auto-saved preset when the space
 *  itself is deleted — wherever that option appears (this page's own Delete
 *  space, and the sidebar's right-click Delete space…, which offers the same
 *  choice for the same reason). */
export const PRESET_SAVE_HINT =
  "Keep this space's look — theme, colours, arranging — saved as a preset you can apply to another space later."

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
  fontLibrary: FontLibrary
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
// two near-black rectangles you cannot tell apart at 46px. System's card
// deliberately pairs a dark `side` with a light `main` — the same two-rect
// shape every other card uses, just split between the two looks it can
// resolve to, rather than a new visual just for this one card.
const THEME_PREVIEW: Record<Space['theme'], { side: string; main: string; line: string }> = {
  system: { side: '#161616', main: '#f7f7f6', line: '#a3a3a3' },
  dark: { side: '#161616', main: '#000000', line: '#8f8f8f' },
  black: { side: '#0a0a0a', main: '#000000', line: '#8f8f8f' },
  light: { side: '#ffffff', main: '#f7f7f6', line: '#a3a3a3' }
}

// Deliberately single-code-point emoji with no U+FE0F variation selector: the
// app bundles no emoji font (that would be a ~10MB dependency), so these render
// from the OS — Segoe UI Emoji on Windows, Apple Color Emoji on macOS — and a
// VS16 sequence can come out monochrome on Windows.
//
// `kw` is a handful of plain-English search terms per emoji — not a general
// emoji-name table (that's the "few thousand" the picker below still isn't),
// just enough to find something in this one curated set of 80 by typing what
// it's called instead of scanning a grid for it.
const EMOJI: { group: string; items: { e: string; kw: string }[] }[] = [
  {
    group: 'Objects',
    items: [
      { e: '📝', kw: 'notes memo write pencil' },
      { e: '📎', kw: 'clip attach paperclip' },
      { e: '📌', kw: 'pin pushpin mark' },
      { e: '📁', kw: 'folder file' },
      { e: '📓', kw: 'notebook journal' },
      { e: '📚', kw: 'books library study' },
      { e: '🔖', kw: 'bookmark tag label' },
      { e: '🔑', kw: 'key unlock password' },
      { e: '💼', kw: 'briefcase work business' },
      { e: '📦', kw: 'box package archive' },
      { e: '🧰', kw: 'toolbox tools kit' },
      { e: '🔨', kw: 'hammer tool build fix' },
      { e: '🧪', kw: 'test tube science lab experiment' },
      { e: '🎒', kw: 'backpack bag school' },
      { e: '💻', kw: 'laptop computer code' },
      { e: '📱', kw: 'phone mobile device' }
    ]
  },
  {
    group: 'Symbols',
    items: [
      { e: '⭐', kw: 'star favorite favourite' },
      { e: '✨', kw: 'sparkle shiny new' },
      { e: '🔥', kw: 'fire hot trending' },
      { e: '⚡', kw: 'bolt lightning fast energy' },
      { e: '💡', kw: 'idea lightbulb bright' },
      { e: '🎯', kw: 'target goal focus dart' },
      { e: '🧩', kw: 'puzzle piece project' },
      { e: '✅', kw: 'check done complete tick' },
      { e: '❌', kw: 'cross no cancel wrong' },
      { e: '🚩', kw: 'flag alert warning' },
      { e: '💎', kw: 'gem diamond premium' },
      { e: '🏆', kw: 'trophy award win' },
      { e: '🔔', kw: 'bell notification alert' },
      { e: '🎉', kw: 'party celebrate confetti' },
      { e: '💜', kw: 'purple heart love' },
      { e: '💙', kw: 'blue heart love' }
    ]
  },
  {
    group: 'Nature',
    items: [
      { e: '🌿', kw: 'leaf plant herb' },
      { e: '🌸', kw: 'blossom flower cherry' },
      { e: '🌊', kw: 'wave ocean sea water' },
      { e: '🌙', kw: 'moon night crescent' },
      { e: '🌵', kw: 'cactus desert plant' },
      { e: '🍃', kw: 'leaves wind nature' },
      { e: '🌻', kw: 'sunflower flower' },
      { e: '🌲', kw: 'tree pine forest' },
      { e: '🐝', kw: 'bee insect honey' },
      { e: '🦋', kw: 'butterfly insect' },
      { e: '🐬', kw: 'dolphin ocean animal' },
      { e: '🌍', kw: 'earth globe world planet' },
      { e: '🍂', kw: 'leaf autumn fall' },
      { e: '🌴', kw: 'palm tree tropical' },
      { e: '🗻', kw: 'mountain fuji peak' },
      { e: '🌞', kw: 'sun face bright day' }
    ]
  },
  {
    group: 'Activity',
    items: [
      { e: '🧠', kw: 'brain mind think idea' },
      { e: '👋', kw: 'wave hand hello greet' },
      { e: '🎧', kw: 'headphones music audio' },
      { e: '🏃', kw: 'run running exercise' },
      { e: '🧘', kw: 'meditate yoga calm' },
      { e: '☕', kw: 'coffee drink cafe' },
      { e: '🍜', kw: 'noodles food ramen' },
      { e: '🎸', kw: 'guitar music instrument' },
      { e: '🎨', kw: 'art paint palette creative' },
      { e: '🎬', kw: 'movie film clapper' },
      { e: '📷', kw: 'camera photo picture' },
      { e: '🎤', kw: 'mic microphone sing' },
      { e: '🏀', kw: 'basketball sport ball' },
      { e: '⚽', kw: 'soccer football sport ball' },
      { e: '🎮', kw: 'game controller gaming' },
      { e: '🥁', kw: 'drum music instrument' }
    ]
  },
  {
    group: 'Places',
    items: [
      { e: '🏠', kw: 'house home' },
      { e: '🏢', kw: 'office building work' },
      { e: '🏡', kw: 'home house garden' },
      { e: '🏫', kw: 'school building education' },
      { e: '🏥', kw: 'hospital medical health' },
      { e: '🏰', kw: 'castle building' },
      { e: '🚀', kw: 'rocket launch space' },
      { e: '🚗', kw: 'car drive travel' },
      { e: '🚲', kw: 'bike bicycle travel' },
      { e: '🛫', kw: 'plane travel flight airport' },
      { e: '🧭', kw: 'compass navigate direction' },
      { e: '🌆', kw: 'city cityscape skyline' },
      { e: '🌉', kw: 'bridge city' },
      { e: '🗽', kw: 'statue liberty landmark' },
      { e: '🎡', kw: 'ferris wheel fair carnival' },
      { e: '⛺', kw: 'tent camp outdoors' }
    ]
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
  vault,
  fontLibrary
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
  const presetFor = (folder: string): SpacePreset | undefined =>
    presets.find((p) => p.name === folder && !!vault && p.origin === vaultName(vault))

  // Takes a folder rather than always the active space: the tab strip's
  // right-click menu (below) deletes whichever tab it was opened on, which
  // is very often NOT the one currently open in the form underneath it.
  // Returns whether it actually went, so a modal caller (the right-click
  // confirm dialog below) knows whether it's safe to close itself — a
  // refused delete (main.trashEntries can fail) must leave the dialog open
  // rather than close over an error the user never saw.
  const deleteSpaceByFolder = async (folder: string, keepPreset: boolean): Promise<boolean> => {
    if (!folder) return false
    setBusy(true)
    try {
      // Straight to the OS trash, not the app's own bin — a space sitting in
      // the same bin as an individually-trashed note is confusing. The
      // two-step button below (and the right-click confirm dialog) is the
      // confirmation.
      const ok = await actions.onDeleteSpace(folder)
      if (ok) {
        onChange(withoutSpace(settings, folder))
        // Only after the folder actually went: a refused delete must not take
        // the saved look with it. Deleted by default — see DeleteSpace below
        // for why keepPreset exists to opt OUT of that.
        if (!keepPreset) {
          const preset = presetFor(folder)
          if (preset) presetActions.onDelete(preset.id)
        }
      }
      return ok
    } finally {
      setBusy(false)
    }
  }
  const deleteSpace = (keepPreset: boolean): Promise<boolean> => deleteSpaceByFolder(space.folder, keepPreset)

  // The tab strip's own right-click "Delete space…" — testers found the
  // sidebar's equivalent but not this one, so it gets the same menu (see
  // Sidebar.tsx's identical pattern; SpaceDeleteConfirm above is shared with
  // it for exactly that reason).
  const [spaceMenu, setSpaceMenu] = useState<{ x: number; y: number; space: Space } | null>(null)
  const [spaceDeleteTarget, setSpaceDeleteTarget] = useState<Space | null>(null)
  const [keepSpacePreset, setKeepSpacePreset] = useState(false)

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
                onContextMenu={(e) => {
                  // The vault-fallback space (folder === '') has nothing to
                  // delete — same guard the sidebar's own switcher uses.
                  if (!s.folder) return
                  e.preventDefault()
                  e.stopPropagation()
                  setSpaceMenu({ x: e.clientX, y: e.clientY, space: s })
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

        {spaceMenu &&
          createPortal(
            <ContextMenu
              x={spaceMenu.x}
              y={spaceMenu.y}
              items={[
                {
                  label: 'Delete space…',
                  danger: true,
                  onClick: () => {
                    setKeepSpacePreset(false)
                    setSpaceDeleteTarget(spaceMenu.space)
                  }
                }
              ]}
              onClose={() => setSpaceMenu(null)}
            />,
            document.body
          )}

        {spaceDeleteTarget &&
          createPortal(
            <SpaceDeleteConfirm
              space={spaceDeleteTarget}
              hasPreset={!!presetFor(spaceDeleteTarget.folder)}
              keepPreset={keepSpacePreset}
              onToggleKeepPreset={() => setKeepSpacePreset((v) => !v)}
              busy={busy}
              onCancel={() => setSpaceDeleteTarget(null)}
              onConfirm={async () => {
                const ok = await deleteSpaceByFolder(spaceDeleteTarget.folder, keepSpacePreset)
                if (ok) setSpaceDeleteTarget(null)
              }}
            />,
            document.body
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
          <DisclosureGroup>
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
          </DisclosureGroup>
        </div>
      </section>

      {/* The SAME form Customisation shows — one component, so "this space
          only" and "every space" can never offer different options or lay them
          out differently. Only where the change lands differs.
          Theme is INSIDE it now (Appearance → Theme) rather than rendered
          separately just above, which is what made Customisation the one page
          with no theme control — see ThemeCards. */}
      <div>
        <p className="mb-2 px-1 text-[11.5px] leading-relaxed text-ink-400">
          These belong to this space alone. The same list is in{' '}
          <span className="font-medium text-ink-500">Customisation</span>, where changing one
          answers it for every space at once.
        </p>
        <SpaceForm
          space={space}
          onChange={patch}
          onColorExisting={() => actions.onColorExistingFolders([space.folder])}
          fontLibrary={fontLibrary}
          collection={{ pageLooks: settings.pageLookLibrary, tints: settings.tintLibrary }}
        />
      </div>

      {space.folder && (
        <div className="mt-2 flex items-center gap-2 border-t border-ink-300/15 pt-4">
          <p className="flex-1 text-[11.5px] leading-relaxed text-ink-400">
            Deleting a space sends its folder — and every note in it — to your computer&apos;s
            Recycle Bin, not this app&apos;s own bin. Recover it from there if you need to.
            {ownPreset && ' Its saved look goes with it, unless you save it first.'}
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
      className="w-44 rounded-lg bg-ink-300/10 px-2.5 py-1.5 text-[12.5px] text-ink-900 outline-none placeholder:text-ink-400 focus-visible:ring-2 focus-visible:ring-brand-300 disabled:opacity-40"
    />
  )
}

/** A curated grid rather than a full emoji keyboard — a searchable set of
 *  several thousand would mean shipping an emoji data table, and picking a tab
 *  marker is not a task that needs one. The search box below filters only
 *  THIS curated 80, against the short `kw` tags on each one — not a general
 *  emoji-name lookup. */
function EmojiPicker({ value, onPick }: { value: string; onPick: (e: string) => void }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const box = useRef<HTMLSpanElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  // Same close rules as the Select primitive: click-outside, and Escape
  // captured so it closes this rather than the settings window behind it.
  useEffect(() => {
    if (!open) return
    // Claimed for exactly as long as this popover would itself act on
    // Escape — see escapeClaims.ts for why Settings' own close-on-Escape
    // needs to know this popover gets first say.
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

  // Reopening starts from a clean search rather than wherever the last visit
  // left it, and lands the cursor straight in the box — the whole point is
  // typing faster than scanning the grid.
  useEffect(() => {
    if (!open) return
    setQuery('')
    searchRef.current?.focus()
  }, [open])

  const q = query.trim().toLowerCase()
  const groups = q
    ? EMOJI.map(({ group, items }) => ({
        group,
        items: items.filter((it) => it.kw.includes(q) || group.toLowerCase().includes(q))
      })).filter(({ items }) => items.length > 0)
    : EMOJI

  return (
    <span ref={box} className="relative inline-flex">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={
          'flex items-center gap-1.5 rounded-lg border border-ink-300/30 px-2.5 py-1.5 text-[12.5px] font-medium outline-none transition duration-200 focus-visible:ring-2 focus-visible:ring-brand-300 ' +
          (open ? 'bg-brand-500/15 text-brand-600' : 'btn-edge bg-surface/70 text-ink-700 hover:text-ink-900')
        }
      >
        <span className="text-[15px] leading-none">{value || '🙂'}</span>
        <span>{value ? 'Change' : 'Select'}</span>
      </button>

      {open && (
        <div className="fade-in absolute right-0 top-9 z-40 max-h-[min(360px,55vh)] w-[268px] overflow-y-auto rounded-xl border border-ink-300/25 bg-surface p-2.5 shadow-float">
          {/* Sticky, so scrolling a long search result doesn't scroll the box
              you're about to type more into out of view. The negative margin
              cancels the container's own padding so the search row spans it
              full-width instead of floating inset. */}
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search emoji…"
            aria-label="Search emoji"
            className="sticky top-0 z-10 -mx-2.5 -mt-2.5 mb-2 w-[calc(100%+20px)] border-0 border-b border-ink-300/20 bg-surface px-4 py-2 text-[12.5px] text-ink-900 outline-none placeholder:text-ink-400"
          />
          {groups.length === 0 && (
            <p className="px-1 py-3 text-center text-[11.5px] text-ink-400">No matching emoji</p>
          )}
          {groups.map(({ group, items }) => (
            <div key={group}>
              <p className="pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-400">
                {group}
              </p>
              <div className="grid grid-cols-8 gap-1">
                {items.map(({ e }) => (
                  <button
                    key={e}
                    data-tip={e}
                    onClick={() => {
                      onPick(e)
                      setOpen(false)
                    }}
                    className={
                      'flex h-7 w-7 items-center justify-center rounded-md border-none text-[15px] leading-none outline-none transition duration-150 ' +
                      (e === value ? 'bg-brand-500/15 ring-1 ring-brand-400' : 'bg-transparent hover:bg-ink-300/15')
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
            className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-lg border-none bg-transparent py-1.5 text-[12px] text-ink-500 outline-none transition duration-150 hover:bg-ink-300/15 hover:text-ink-900"
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
 *  app, and window.confirm blocks the Electron renderer and looks foreign. The
 *  arm/disarm timer itself is `useArmed` in primitives.tsx, shared with
 *  Recovery.tsx's own destructive button — it used to be the same 5000ms
 *  written out in both files.
 *
 *  A space's saved look goes with it by default — leaving it behind is what
 *  produced ten stranded presets in the library after ten test spaces were
 *  created and deleted for onboarding testing (2026-08-21). "Save the preset
 *  before deleting?" is the one chance to opt OUT of that, and it only shows
 *  once armed and only when there IS a look to lose — a permanently visible
 *  prompt would put a second decision in front of a button most people press
 *  without wanting either. It is the caller-owned extra state `useArmed`'s
 *  `reset` exists for, so a disarm clears it too. */
function DeleteSpace({
  disabled,
  hasPreset,
  onDelete
}: {
  disabled?: boolean
  hasPreset: boolean
  onDelete: (keepPreset: boolean) => void
}): React.JSX.Element {
  const [keepPreset, setKeepPreset] = useState(false)
  const { armed, press } = useArmed(() => setKeepPreset(false))
  return (
    <span className="flex shrink-0 items-center gap-2">
      {armed && hasPreset && (
        <span className="flex items-center gap-1">
          <button
            type="button"
            disabled={keepPreset}
            onClick={() => setKeepPreset(true)}
            className={
              'flex items-center gap-1.5 whitespace-nowrap rounded-lg px-2 py-1 text-[11.5px] outline-none transition duration-150 focus-visible:ring-2 focus-visible:ring-brand-300 ' +
              (keepPreset
                ? 'text-brand-600'
                : 'text-ink-500 hover:bg-ink-300/15 hover:text-ink-700')
            }
          >
            {keepPreset ? (
              <>
                <Icon name="check" className="h-3.5 w-3.5" />
                Will be kept
              </>
            ) : (
              'Save the preset before deleting?'
            )}
          </button>
          <HelpTip text={PRESET_SAVE_HINT} />
        </span>
      )}
      <button
        disabled={disabled}
        className={'mini shrink-0' + (armed ? ' danger' : '')}
        onClick={() => {
          // Read the flag BEFORE press(), which disarms and so clears it.
          const keep = keepPreset
          if (press()) onDelete(keep)
        }}
      >
        {armed ? 'Click again to delete' : 'Delete space'}
      </button>
    </span>
  )
}

/** The confirm dialog behind a right-click "Delete space…" — the sidebar
 *  switcher's context menu, and this page's own tab strip. Exported so both
 *  can share one implementation and one wording rather than two copies
 *  drifting apart; a modal rather than `DeleteSpace`'s two-step arm/disarm
 *  because there's no button here to arm, only a right-click, so the
 *  confirmation has to be a surface of its own — the same call App.tsx's own
 *  delete-media prompt makes. MUST be portalled to `document.body` by the
 *  caller: `.genie`'s scale-open transform and the sidebar's backdrop-blur
 *  both make their container a containing block for `position: fixed`
 *  descendants (CLAUDE.md), which is exactly what `.confirm-backdrop` is. */
export function SpaceDeleteConfirm({
  space,
  hasPreset,
  keepPreset,
  onToggleKeepPreset,
  busy,
  onCancel,
  onConfirm
}: {
  space: Space
  hasPreset: boolean
  keepPreset: boolean
  onToggleKeepPreset: () => void
  busy: boolean
  onCancel: () => void
  onConfirm: () => void
}): React.JSX.Element {
  const label = spaceLabel(space)
  // Escape is Cancel, not dismiss — same reasoning as App.tsx's own
  // delete-media prompt: leaving the space deleted because someone pressed
  // Escape would be the dialog answering for them. Guarded on `busy` for the
  // same reason the backdrop click below is: once Delete has been pressed,
  // closing the dialog must not read as having called it off.
  useEffect(() => {
    if (busy) return
    // Claimed for exactly as long as this dialog would itself act on Escape
    // — see escapeClaims.ts for why Settings' own close-on-Escape needs to
    // know this dialog gets first say.
    const release = claimEscape()
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onCancel()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      release()
      window.removeEventListener('keydown', onKey)
    }
  }, [busy, onCancel])
  return (
    <div className="confirm-backdrop" onClick={busy ? undefined : onCancel}>
      <div
        className="prompt confirm"
        role="dialog"
        aria-modal="true"
        aria-label={`Delete ${label}?`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="prompt-title">Delete &ldquo;{label}&rdquo;?</div>
        <p className="mt-1 text-[12.5px] leading-relaxed text-ink-500">
          Sends its folder — and every note in it — to your computer&apos;s Recycle Bin, not this
          app&apos;s own bin. Recover it from there if you need to.
          {hasPreset && ' Its saved look goes with it, unless you keep it below.'}
        </p>
        {hasPreset && (
          <button
            type="button"
            role="checkbox"
            aria-checked={keepPreset}
            onClick={onToggleKeepPreset}
            className="mt-3 flex items-center gap-2 rounded-lg border-none bg-transparent px-1.5 py-1.5 text-left text-[12.5px] outline-none transition duration-150 hover:bg-ink-300/15 focus-visible:ring-2 focus-visible:ring-brand-300"
          >
            <span
              aria-hidden="true"
              className={
                'flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[4px] border ' +
                // accent-*, matching App.tsx's TickRow — see ACCENT_KEYS in
                // settings/model.ts for why brand-* does not follow the accent.
                (keepPreset ? 'border-accent-400 bg-accent-500/25 text-accent-600' : 'border-ink-300/50')
              }
            >
              {keepPreset && <Icon name="check" className="h-3 w-3" />}
            </span>
            <span className={keepPreset ? 'text-ink-700' : 'text-ink-500'}>
              Save the preset before deleting
            </span>
            <HelpTip text={PRESET_SAVE_HINT} />
          </button>
        )}
        <div className="prompt-actions">
          {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
          <button autoFocus onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button className="danger" onClick={onConfirm} disabled={busy}>
            Delete
          </button>
        </div>
      </div>
    </div>
  )
}

// --- the collapsible sections ---------------------------------------------

/** Mount/unmount rather than an animated height: animating to `auto` needs a
 *  measured max-height, and the Shortcuts body is tall and variable — a wrong
 *  one clips the action grid. Container classes copied from ToggleRow so an
 *  open section lines up with the rows inside it (rule 8). */
/** One bordered container around a run of `Disclosure`s — see `.disclosure-group`
 *  in app.css for why the grouping (rather than a card each) and why it is not
 *  `overflow: hidden`. Every place that renders more than one Disclosure should
 *  use this; a single one still does, so a lone row matches the lists. */
export function DisclosureGroup({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <div className="disclosure-group">{children}</div>
}

export function Disclosure({
  label,
  hint,
  openSignal,
  children
}: {
  label: string
  hint: string
  /** Search sends someone to a PAGE, and every setting on Customisation lives
   *  behind one of these folds — so "density" landed you on nine closed rows
   *  with the answer still hidden. Set this for the fold a search result is in
   *  and it opens itself. A CHANGING number rather than `true`, so a second
   *  search for the same fold re-opens one the reader closed by hand; and not
   *  a controlled `open`, so their own click still wins afterwards. */
  openSignal?: number
  children: React.ReactNode
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (openSignal === undefined) return
    setOpen(true)
    // The window has just switched page; the fold can be well down the list.
    ref.current?.scrollIntoView({ block: 'nearest' })
  }, [openSignal])
  const id = `disclosure-${label.toLowerCase()}`
  return (
    <div ref={ref}>
      <button
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 px-3 py-2 text-left outline-none transition duration-200 hover:bg-ink-300/15 focus-visible:ring-2 focus-visible:ring-brand-300"
      >
        <span className="min-w-0 flex-1">
          <span className={'block text-[13px] font-medium ' + (open ? 'text-brand-600' : 'text-ink-700')}>
            {label}
          </span>
          {/* One line, clipped — the hints run to wildly different lengths, and
              letting the long ones wrap made every second row taller than its
              neighbours. The full text is still the row's own subject; opening
              it is what you do when the summary isn't enough. */}
          <span className="mt-0.5 block truncate text-[11.5px] leading-relaxed text-ink-400">{hint}</span>
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

/** Theme, and Text colour riding along with it — it only means anything on a
 *  dark theme, so it belongs beside the choice that makes it relevant rather
 *  than three sections away.
 *
 *  Rendered as the first thing inside `SpaceAppearance`, which means inside the
 *  **Appearance** disclosure, which means BOTH scopes get it. Until 2026-08-29
 *  this sat outside that disclosure and was used only by the space editor
 *  below — so Settings → Customisation, which renders the shared `SpaceForm`
 *  and nothing else, had no way to set the theme at all, while the disclosure
 *  it should have been in advertised "Theme, accent colour…" in its own hint
 *  and its "spaces differ" check already listed `theme`/`textTone` for controls
 *  that were not there. Reuben's call on where it goes: every customisation
 *  setting must exist in both scopes, and one shared component is the only
 *  thing that keeps them from drifting. It costs a click in the space editor,
 *  where theme used to be visible without one; that was the trade accepted. */
function ThemeCards({ space, onChange }: SpaceProps): React.JSX.Element {
  // Text tone only means anything on the two dark ramps (see TEXT_TONES'
  // hint), so when the theme is 'system' this has to ask what it currently
  // RESOLVES to, not the stored id — otherwise picking System on a light OS
  // leaves the tone row enabled for a theme that isn't actually showing.
  const resolvedLight = resolveTheme(space.theme) === 'light'
  return (
    <section className="settings-group">
      <h3>Theme</h3>
      {/* Reads correctly in BOTH scopes now that this renders in both — the old
          "while you're in this space" was a sentence the Customisation page,
          which is answering for every space at once, could not say. */}
      <p className="hint">
        Applies to the whole app, editor included. Each space can have its own.
      </p>
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
          {resolvedLight
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
                disabled={resolvedLight}
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
      {/* First, because it is the setting people open this fold for — and a
          fragment child here is a flex item of the Disclosure's own
          `flex flex-col gap-6`, so it spaces itself exactly like the sections
          below it with no margin of its own. */}
      <ThemeCards space={space} onChange={onChange} />

      <section className="settings-group">
        <h3>Accent</h3>
        <p className="hint">Pick a colour, then choose how far it reaches. Works with either theme.</p>
        {/* The canonical ten, plus "Default", plus any colour at all — the
            same component onboarding's Fonts step uses, so the two cannot drift
            apart again (they had). `accent` stores a palette name, 'default',
            or a literal `#rrggbb`; `accentHue` in model.ts resolves all three,
            and the five legacy ids from before the palettes were unified. */}
        <AccentPicker
          accent={space.accent}
          theme={resolveTheme(space.theme)}
          onPick={(value) => onChange({ accent: value })}
        />
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
        {/* Nested under Text, and only shown there: `tint` tints the ink ramp
            lightly by design, so there is nothing here for it to add.
            OFF by default. Note that neither state touches a note's own body —
            see Space.accentUiText for why that is a rule and not an oversight. */}
        {space.accentMode === 'text' && (
          <div className="mt-3">
            <ToggleRow
              on={space.accentUiText}
              onClick={() => onChange({ accentUiText: !space.accentUiText })}
              label="Colour all UI text"
              hint={
                space.accentUiText
                  ? 'On \u2014 every label in the app takes the colour: settings hints, sidebar previews, tabs, the path bar. What you write in a note is still yours to colour.'
                  : 'Headings, note and folder titles, the settings list, the sidebar\u2019s buttons and a note\u2019s word count take the colour. Every other label stays your theme\u2019s own ink.'
              }
            />
          </div>
        )}
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

      <section className="settings-group">
        <h3>Editor width</h3>
        <p className="hint">
          How wide the writing area grows. Only the text column — the sidebar keeps its own width.
        </p>
        <div className="mode-row">
          {EDITOR_WIDTHS.map((w) => {
            const on = space.editorWidth === w.id
            return (
              <button
                key={w.id}
                className={'mode-btn' + (on ? ' on' : '')}
                aria-pressed={on}
                onClick={() => onChange({ editorWidth: w.id })}
              >
                <span className="t">{w.label}</span>
                <span className="s">{w.hint}</span>
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
              ? 'bg-transparent text-ink-500 hover:bg-ink-300/15'
              : 'bg-transparent text-ink-300 hover:bg-ink-300/15')
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
