import { useCallback, useEffect, useMemo, useState } from 'react'
import logoLight from './assets/logo/notealise-mark-circle-light.svg'
import logoDark from './assets/logo/notealise-mark-circle-dark.svg'
import type { TreeNode } from '../../shared/types'
import type { Workspace } from '../../shared/workspace'
import { activeSpace, type AppSettings, type Space } from '../../shared/settings'
import type { UpdateStatus } from '../../shared/update'
import { UpdateBanner } from './update/UpdateBanner'
import { ArchiveIcon, BinIcon, Icon } from './icons'
import { SettingsButton, type SectionId } from './settings/Settings'
import type { SpaceActions } from './settings/Spaces'
import type { PresetActions } from './settings/Presets'
import type { SpacePreset } from '../../shared/presets'
import { ancestorsOf } from './links/model'
import { SearchBar, SearchResults, type SearchHit } from './Search'
import { TreeView, type Selection, type TreeActions } from './TreeView'
import {
  ARCHIVE_SORTS,
  archivedRoots,
  findNode,
  onDate,
  pinnedPathSet,
  pinnedRoots,
  sortArchived,
  withoutArchived,
  withoutPinned,
  type ArchiveSort
} from './organise/model'

// The whole sidebar, ported from the legacy prototype's `Sidebar`
// (legacy/src/App.jsx:157-1036) so the two apps read as the same product:
// header + archive toggle, the spotlight search pill, the Note/Folder bar, a
// Pinned section, the tree, and the archive and bin shelf views.

interface Props {
  vaultName: string
  /** the vault's absolute path, for Settings → Source folder */
  vaultPath: string | null
  tree: TreeNode[]
  workspace: Workspace
  openPath: string | null
  settings: AppSettings
  onChangeSettings: (partial: Partial<AppSettings>) => void
  spaceActions: SpaceActions
  /** the saved-look library, forwarded to Settings → Spaces. Held by App
   *  because it outlives the open vault (shared/presets.ts). */
  presets: SpacePreset[]
  presetActions: PresetActions
  /** Set to open Settings straight to a section (e.g. from a File-menu
   *  command) rather than through the gear. */
  settingsJumpToSection?: SectionId | null
  onSettingsJumpHandled?: () => void
  /** every space, for the footer switcher */
  spaces: Space[]
  activeSpaceFolder: string
  onSwitchSpace: (folder: string) => void
  /** notes sitting at the vault root, outside every space */
  looseNotes: TreeNode[]

  query: string
  onQuery: (q: string) => void
  deep: boolean
  onToggleDeep: () => void
  withArchived: boolean
  onToggleWithArchived: () => void
  searchHits: SearchHit[] | null
  onOpenSearchHit: (hit: SearchHit, newTab?: boolean) => void
  update: UpdateStatus
  /** Handed a function that opens one folder and closes the rest. An imperative
   *  handle, the same idiom as the editor's `editorRef`: the path bar lives in
   *  App and the tree state lives here, and passing the state up instead would
   *  make every expand/collapse a re-render of the whole window. */
  revealRef?: React.MutableRefObject<((folder: string) => void) | null>

  actions: TreeActions & {
    onNewNote: () => void
    onNewFolder: () => void
    onArchive: (paths: string[], archived: boolean) => void
    onRestoreFromBin: (ids: string[]) => void
    onPurge: (ids?: string[]) => void
    onPickVault: () => void
  }
}

type View = 'notes' | 'archive' | 'bin'

/** A nav-bar button (legacy's `TB`). */
function TB({
  onClick,
  active,
  title,
  children
}: {
  onClick: () => void
  active?: boolean
  title: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      data-tip={title}
      aria-pressed={active}
      className={
        'flex items-center gap-1.5 rounded-lg border-none px-2 py-1 text-[12px] font-medium outline-none transition duration-200 focus-visible:ring-2 focus-visible:ring-brand-300 ' +
        (active
          ? 'bg-brand-500/15 text-brand-600 hover:bg-brand-500/15'
          : 'bg-transparent text-ink-500 hover:bg-brand-500/10 hover:text-brand-600')
      }
    >
      {children}
    </button>
  )
}

/** The archive's sort picker (legacy's `SortMenu`). */
function SortMenu({
  value,
  onChange
}: {
  value: ArchiveSort
  onChange: (v: ArchiveSort) => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const current = ARCHIVE_SORTS.find((o) => o.id === value) ?? ARCHIVE_SORTS[0]
  return (
    <span className="relative inline-flex">
      <button
        onClick={() => setOpen((o) => !o)}
        data-tip="Sort the archive"
        className="flex items-center gap-1 rounded border-none bg-transparent px-1 py-0.5 text-[11px] font-medium normal-case tracking-normal text-ink-400 outline-none transition-colors hover:bg-transparent hover:text-brand-600"
      >
        <Icon name="sort" className="h-3.5 w-3.5" />
        <span>{current.short}</span>
      </button>
      {open && (
        <>
          <span className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <span className="fade-in absolute right-0 top-7 z-40 w-max rounded-xl border border-ink-300/25 bg-surface p-1 shadow-float">
            {ARCHIVE_SORTS.map((o) => (
              <button
                key={o.id}
                onClick={() => {
                  onChange(o.id)
                  setOpen(false)
                }}
                className={
                  'flex w-full items-center gap-2 rounded-lg border-none px-2 py-1.5 text-left text-[12px] outline-none ' +
                  (o.id === value
                    ? 'bg-brand-500/12 text-brand-600 hover:bg-brand-500/12'
                    : 'bg-transparent text-ink-600 hover:bg-brand-500/[0.08] hover:text-brand-600')
                }
              >
                <span className={o.id === value ? 'opacity-100' : 'opacity-0'}>
                  <Icon name="check" className="h-3.5 w-3.5" />
                </span>
                {o.label}
              </button>
            ))}
          </span>
        </>
      )}
    </span>
  )
}

// Split rather than built by string surgery: Tailwind's scanner only sees class
// names that appear literally in the source.
const SECTION_TEXT = 'text-[11px] font-semibold uppercase tracking-wider text-ink-400'
const SECTION_HEAD = 'px-3 pb-1 pt-1 ' + SECTION_TEXT

export function Sidebar({
  vaultName,
  vaultPath,
  tree,
  workspace,
  openPath,
  settings,
  onChangeSettings,
  spaceActions,
  presets,
  presetActions,
  settingsJumpToSection,
  onSettingsJumpHandled,
  spaces,
  activeSpaceFolder,
  onSwitchSpace,
  looseNotes,
  query,
  onQuery,
  deep,
  onToggleDeep,
  withArchived,
  onToggleWithArchived,
  searchHits,
  onOpenSearchHit,
  update,
  revealRef,
  actions
}: Props): React.JSX.Element {
  const [view, setView] = useState<View>('notes')
  const [selection, setSelection] = useState<Selection>({ paths: new Set() })
  const [dragging, setDragging] = useState<string[] | null>(null)
  // Which folders are open. ONE set for all four TreeViews (archive, pinned,
  // main, loose): "open this folder and close every other one" has to have a
  // single answer, and before this each tree kept its own — so the same folder
  // could be open in one and shut in another.
  //
  // Starts empty, which is what the sidebar has always done: every folder shut
  // until you open it. Not persisted, also as before — this is a change of
  // representation, not of behaviour.
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [revealTarget, setRevealTarget] = useState<string | null>(null)
  const toggleExpand = useCallback((path: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
    setRevealTarget(null) // a manual toggle ends whatever the last reveal set up
  }, [])

  /** Open `folder` and its ancestors, and close EVERY other folder in the
   *  sidebar. Driven by the path bar: the point of clicking a crumb is to see
   *  what else is in that folder, and leaving eight other folders open is the
   *  thing that made you look at the crumb in the first place.
   *
   *  `ancestorsOf` gives exactly the chain and nothing else, so "collapse
   *  everything else" is not a separate step — it is what a fresh set means. */
  const revealFolder = useCallback((folder: string): void => {
    setView('notes') // revealing into the archive or the bin would show nothing
    setExpanded(ancestorsOf(folder))
    setRevealTarget(folder)
  }, [])
  if (revealRef) revealRef.current = revealFolder
  const [archiveSort, setArchiveSort] = useState<ArchiveSort>('recent')
  const [dropZone, setDropZone] = useState<'archive' | 'trash' | null>(null)
  const [lidClick, setLidClick] = useState(false)
  const [archiveLidClick, setArchiveLidClick] = useState(false)

  // Collapse + resize, under live evaluation — not yet logged to CHANGELOG.md's
  // Unreleased (see CLAUDE.md "Tracking pending changes"); ask before adding it
  // once it's been tried here. Ported from the legacy prototype
  // (legacy/src/App.jsx), which stays legacy-only per rule 8.
  const SIDEBAR_MIN = 200
  const SIDEBAR_MAX = 480
  const SIDEBAR_DEFAULT = 288
  const SIDEBAR_NARROW = 220
  const [collapsed, setCollapsed] = useState(false)
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT)
  const [resizing, setResizing] = useState(false)
  const narrow = !collapsed && sidebarWidth <= SIDEBAR_NARROW
  // Arranging belongs to the active space. Derived here rather than taken as a
  // second prop: this component has to keep the whole `settings` object anyway
  // to forward it to SettingsButton, and two props could disagree.
  const space = activeSpace(settings)
  // Icon-only nav buttons: automatic once the sidebar's dragged narrow, or
  // permanent if the user opted in under the space's Arranging settings.
  const compactNav = narrow || space.compactNav
  const startResize = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      const startX = e.clientX
      const startWidth = sidebarWidth
      setResizing(true)
      const onMove = (ev: MouseEvent): void => {
        setSidebarWidth(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, startWidth + (ev.clientX - startX))))
      }
      const onUp = (): void => {
        setResizing(false)
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    [sidebarWidth]
  )

  const inArchive = view === 'archive'
  const inBin = view === 'bin'
  const searching = searchHits !== null
  const selCount = selection.paths.size
  const clearSel = useCallback((): void => setSelection({ paths: new Set() }), [])

  // Escape leaves selection mode. It is one of exactly two ways out (the other
  // is the Clear button below) — clicking the background deliberately does not
  // clear any more, because in this mode a plain click on a row SELECTS, and a
  // near-miss onto the background used to throw the whole set away.
  // Not capture-phase: the settings modal and the popovers listen in capture and
  // stop propagation, so an open dialog still gets Escape first.
  useEffect(() => {
    if (selCount === 0) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') clearSel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selCount, clearSel])

  // The bin lid hinges open when something goes in — the cue that it landed.
  const flipLid = (): void => {
    setLidClick(true)
    setTimeout(() => setLidClick(false), 420)
  }
  const lidOpen = lidClick || dropZone === 'trash'

  // Same cue on the archive chest.
  const flipArchiveLid = (): void => {
    setArchiveLidClick(true)
    setTimeout(() => setArchiveLidClick(false), 420)
  }
  const archiveLidOpen = archiveLidClick || dropZone === 'archive'

  // Live tree = everything not archived; pinned entries are hoisted out of it
  // into their own section so they can't appear twice.
  const live = useMemo(() => withoutArchived(tree, workspace), [tree, workspace])
  const hoisted = useMemo(() => pinnedPathSet(live, workspace), [live, workspace])
  const pinned = useMemo(() => pinnedRoots(live, workspace), [live, workspace])
  const mainTree = useMemo(() => withoutPinned(live, hoisted), [live, hoisted])

  // The archive lists only the tops of archived branches — everything beneath
  // came along for the ride and goes back with it.
  const archivedNodes = useMemo(() => {
    const roots = archivedRoots(workspace)
      .map((p) => findNode(tree, p))
      .filter((n): n is TreeNode => n !== null)
    return sortArchived(roots, workspace, archiveSort)
  }, [tree, workspace, archiveSort])

  const treeActions: TreeActions = actions

  const commonTreeProps = {
    expanded,
    onToggleExpand: toggleExpand,
    revealTarget,
    workspace,
    openPath,
    freeArrange: space.freeArrange,
    colorStyle: space.colorStyle,
    colorInherit: space.colorInherit,
    selection,
    onSelectionChange: setSelection,
    dragging,
    onDragging: setDragging,
    ...treeActions
  }

  return (
    <>
    <aside
      style={{ width: collapsed ? 0 : sidebarWidth }}
      className={
        'relative flex h-full shrink-0 select-none flex-col overflow-hidden bg-surface/45 backdrop-blur ' +
        (collapsed ? '' : 'border-r border-ink-300/25 ') +
        (resizing ? '' : 'transition-[width] duration-150 ') +
        (compactNav ? 'sidebar-narrow' : '')
      }
      onContextMenu={(e) => {
        if (e.target === e.currentTarget) actions.onContext(e, null)
      }}
    >
      {/* Under live evaluation (see note above the state block) — drag the
          right edge to resize. Transition is suspended mid-drag so React
          state, not the browser's cursor, drives it. */}
      {!collapsed && (
        <div
          onMouseDown={startResize}
          data-tip="Drag to resize"
          className={
            'absolute right-0 top-0 z-40 h-full w-1.5 cursor-col-resize select-none ' +
            (resizing ? 'bg-brand-400/60' : 'hover:bg-brand-400/40')
          }
        />
      )}
      {/* The header is the vault name alone — the archive toggle moved down to
          the bottom strip, beside the bin, since both are shelf views and they
          read as a pair there. */}
      <div className="flex items-center gap-2 px-4 pt-4 pb-2.5">
        <img src={logoLight} alt="" className="app-logo-mark app-logo-mark-light h-7 w-7 shrink-0" />
        <img src={logoDark} alt="" className="app-logo-mark app-logo-mark-dark h-7 w-7 shrink-0" />
        <p className="min-w-0 flex-1 truncate font-display text-lg font-semibold text-ink-900" data-tip={vaultName}>
          {vaultName}
        </p>
        <button
          onClick={() => setCollapsed(true)}
          data-tip="Collapse sidebar"
          className="flex shrink-0 items-center justify-center rounded-lg border-none bg-transparent p-1.5 text-ink-400 outline-none transition duration-200 hover:bg-brand-500/10 hover:text-brand-600 focus-visible:ring-2 focus-visible:ring-brand-300"
        >
          <Icon name="panelLeft" className="h-4 w-4" />
        </button>
      </div>

      <SearchBar
        query={query}
        onQuery={onQuery}
        deep={deep}
        onToggleDeep={onToggleDeep}
        withArchived={withArchived}
        onToggleWithArchived={onToggleWithArchived}
      />

      {/* hidden in the shelf views: nothing here applies to them */}
      <div
        className={
          'flex items-center justify-center gap-1 px-3 pb-1.5 ' + (inArchive || inBin ? 'hidden' : '')
        }
      >
        <TB onClick={actions.onNewNote} title="New note (Ctrl+N)">
          <Icon name="filePlus" className="h-4 w-4" />
          <span className="tb-label">Note</span>
        </TB>
        <TB onClick={actions.onNewFolder} title="New folder">
          <Icon name="folderPlus" className="h-4 w-4" />
          <span className="tb-label">Folder</span>
        </TB>
      </div>

      {/* From the FIRST item, not the second. The bar is what tells you the
          sidebar has changed mode — that a plain click now selects rather than
          opens — and it carries the only way out besides Escape. Showing it
          only at two left the one-item state looking like nothing had
          happened, with clicking around silently building a set. */}
      {selCount > 0 && (
        <div className="fade-in mx-3 mb-1.5 flex items-center gap-2 rounded-lg bg-brand-50 px-3 py-1.5 text-[11px] text-brand-600">
          <span className="flex-1">
            {selCount} selected · click rows to add
            {selCount > 1 ? ' · drag to move them together' : ''}
          </span>
          <button
            onClick={clearSel}
            data-tip="Leave selection mode (Esc)"
            className="rounded border-none bg-transparent px-1.5 py-0.5 text-ink-500 outline-none transition-colors hover:bg-transparent hover:text-brand-600"
          >
            Clear
          </button>
        </div>
      )}

      {/* ---- the list ---- */}
      <div className="relative min-h-0 flex-1">
        <div
          className={
            'h-full overflow-y-auto px-2 pt-1.5 ' +
            ((inBin && workspace.trash.length > 0) || (!inBin && (dragging || selCount > 0))
              ? 'pb-16'
              : 'pb-3')
          }
          // No clear-on-background-click. In selection mode a plain click on a
          // row selects it, so the background is one slip away from every row —
          // and losing a set you built over a dozen clicks to a near-miss is
          // the failure this mode exists to avoid. Escape and Clear, only.
          onContextMenu={(e) => {
            if (e.target === e.currentTarget) actions.onContext(e, null)
          }}
        >
          {/* a search always searches everywhere, so it outranks the shelf views */}
          {searching ? (
            <SearchResults
              hits={searchHits}
              activePath={openPath}
              onOpen={onOpenSearchHit}
              deep={deep}
              archivedCount={searchHits.filter((h) => h.archived).length}
            />
          ) : inBin ? (
            workspace.trash.length ? (
              <div className="fade-in">
                <p className={SECTION_HEAD}>
                  Bin · {workspace.trash.length} item{workspace.trash.length === 1 ? '' : 's'}
                </p>
                {workspace.trash.map((item) => (
                  <div
                    key={item.id}
                    className="tree-row group flex items-center pr-1.5 text-left hover:bg-surface/70"
                    style={{ paddingLeft: 'var(--row-pad0)' }}
                  >
                    <span className="shrink-0 text-ink-300">
                      <Icon name={item.type === 'dir' ? 'folder' : 'doc'} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="tree-title truncate font-medium text-ink-900">
                        {item.name.replace(/\.md$/i, '')}
                      </span>
                      <span className="tree-sub truncate text-ink-500">
                        Deleted {onDate(item.deletedAt)} · from {item.from}
                      </span>
                    </span>
                    <button
                      onClick={() => actions.onRestoreFromBin([item.id])}
                      data-tip="Put back"
                      className="shrink-0 rounded border-none bg-transparent p-0.5 text-ink-300 outline-none transition-colors hover:bg-transparent hover:text-brand-600"
                    >
                      <Icon name="restore" />
                    </button>
                    <button
                      onClick={() => actions.onPurge([item.id])}
                      data-tip="Delete permanently"
                      className="shrink-0 rounded border-none bg-transparent p-0.5 text-ink-300 outline-none transition-colors hover:bg-transparent hover:text-brand-600"
                    >
                      <Icon name="trash" />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="fade-in px-4 py-10 text-center">
                <p className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-surface/70 text-ink-400">
                  <BinIcon className="h-4 w-4" />
                </p>
                <p className="text-sm text-ink-500">The bin is empty.</p>
                <p className="mt-1 text-xs leading-relaxed text-ink-300">
                  Deleted notes wait here until you empty it — nothing leaves your disk before that.
                </p>
              </div>
            )
          ) : inArchive ? (
            archivedNodes.length ? (
              <div className="fade-in">
                <div className="flex items-center gap-1 px-3 pb-1 pt-1">
                  <p className={'min-w-0 flex-1 ' + SECTION_TEXT}>
                    Archived · {archivedNodes.length} item{archivedNodes.length === 1 ? '' : 's'}
                  </p>
                  <SortMenu value={archiveSort} onChange={setArchiveSort} />
                </div>
                <TreeView {...commonTreeProps} nodes={archivedNodes} mode="archive" />
              </div>
            ) : (
              <div className="fade-in px-4 py-10 text-center">
                <p className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-surface/70 text-ink-400">
                  <Icon name="archive" className="h-4 w-4" />
                </p>
                <p className="text-sm text-ink-500">Nothing archived yet.</p>
                <p className="mt-1 text-xs leading-relaxed text-ink-300">
                  Drag notes or folders into the sidebar — a drop zone appears at the top. A folder
                  brings everything inside it along, and nothing leaves your disk.
                </p>
              </div>
            )
          ) : (
            <>
              {pinned.length > 0 && (
                <div className="mb-2">
                  <p className={'flex items-center gap-1.5 ' + SECTION_HEAD}>
                    <span className="text-brand-500">
                      <Icon name="starFilled" className="h-3.5 w-3.5" />
                    </span>{' '}
                    Pinned
                  </p>
                  <TreeView {...commonTreeProps} nodes={pinned} mode="pinned" />
                  <div className="mx-3 mt-2 border-b border-ink-300/20" />
                </div>
              )}

              {mainTree.length > 0 && pinned.length > 0 && <p className={SECTION_HEAD}>Notes</p>}
              <TreeView {...commonTreeProps} nodes={mainTree} mode="tree" />

              {mainTree.length === 0 && pinned.length === 0 && looseNotes.length === 0 && (
                <p className="px-3 py-6 text-center text-sm text-ink-300">
                  {archivedNodes.length ? 'Everything is archived.' : 'No notes yet.'}
                </p>
              )}

              {/* Notes sitting at the vault root once spaces exist. They are
                  NOT moved into a space on the user's behalf (rule 1: the
                  files are theirs) — they're shown here, in every space, so
                  they can't get lost, and dragging one into a folder is the
                  way out. */}
              {looseNotes.length > 0 && (
                <>
                  <p className={SECTION_HEAD} data-tip="Notes in your vault that aren't inside a space">
                    Not in a space
                  </p>
                  <TreeView {...commonTreeProps} nodes={looseNotes} mode="tree" />
                </>
              )}
            </>
          )}
        </div>
      </div>

      {/* ---- footer ---- */}
      <div className="relative border-t border-ink-300/25 p-3 pb-[60px]">
        {/* Standing in the same slot as the drop zone, but a real button rather
            than a target — hence a solid, lit rim instead of a dashed outline. */}
        {inBin && workspace.trash.length > 0 && (
          <button
            onClick={() => {
              // No confirmation — the button itself only appears once you've
              // deliberately switched to the bin view, and every item in it
              // already went through its own delete confirmation on the way
              // in. Still fully recoverable: this hands each item to the OS
              // trash (shell.trashItem), never a hard unlink.
              actions.onPurge()
              flipLid()
              // The bin is now empty — stay on it and there's nothing to
              // look at. Go back to whichever space's notes you were in.
              setView('notes')
            }}
            className="fade-in absolute inset-x-2 bottom-full z-30 mb-2 flex items-center justify-center gap-2 rounded-xl border border-brand-400/70 bg-surface px-3 py-3 text-[12px] font-semibold text-brand-600 outline-none ring-2 ring-brand-500/15 transition duration-200 hover:bg-brand-500/10 hover:ring-4 hover:ring-brand-500/25"
          >
            <span className={lidOpen ? 'lid-open' : ''}>
              <BinIcon className="h-4 w-4" />
            </span>
            <span>Empty recycle bin</span>
          </button>
        )}

        {/* A click-to-bin action for a multi-select, not a drop target — while
            dragging, the bin button itself (bottom strip) highlights instead,
            so there's no separate "drop here" banner competing for attention. */}
        {!inBin && !dragging && selCount > 0 && (
          <button
            onClick={() => {
              actions.onTrash([...selection.paths])
              flipLid()
              clearSel()
            }}
            className="fade-in absolute inset-x-2 bottom-full z-30 mb-2 flex cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-ink-300/40 bg-surface px-3 py-3 text-[12px] font-medium text-ink-400 outline-none transition-all duration-200 hover:border-brand-300 hover:text-brand-600"
          >
            <span className={lidOpen ? 'lid-open' : ''}>
              <BinIcon className="h-4 w-4" />
            </span>
            <span>Move {selCount} to bin</span>
          </button>
        )}

        <UpdateBanner status={update} canSelfUpdate={update.state !== 'unsupported'} />

        {/* The space switcher, directly above "Switch folder": one row of
            emoji, one per top-level folder. Deliberately a horizontal strip
            *inside* the sidebar footer and not a vertical rail beside the tree
            — the rail is the shape that was removed in 2026-07-25 (CLAUDE.md).
            Hidden entirely when the vault has no spaces, so a flat vault shows
            no dead control. */}
        {/* A single unbound space means "the whole vault" — there is nothing to
            switch between, so the strip would be one dead button. */}
        {!(spaces.length === 1 && !spaces[0].folder) && (
          <div className="mb-2 flex flex-wrap items-center justify-center gap-1">
            {spaces.map((s, i) => {
              const on = s.folder === activeSpaceFolder
              return (
                <button
                  key={s.folder}
                  onClick={() => onSwitchSpace(s.folder)}
                  aria-pressed={on}
                  data-tip={s.folder}
                  className={
                    'flex h-8 w-8 items-center justify-center rounded-lg border text-[15px] leading-none outline-none transition duration-200 focus-visible:ring-2 focus-visible:ring-brand-300 ' +
                    // btn-edge only on the inactive ones: the selected space
                    // keeps its accent border, which is how you can see which
                    // space you're in
                    (on
                      ? 'border-brand-400/60 bg-brand-500/15 text-brand-600'
                      : 'btn-edge border-ink-300/25 bg-transparent text-ink-500 hover:bg-brand-500/10 hover:text-brand-600')
                  }
                >
                  {s.emoji || <span className="text-[12px] font-semibold">{i + 1}</span>}
                </button>
              )
            })}
          </div>
        )}

        {/* "Switch folder" and the "Editing real .md files on disk" line used to
            sit here. Both were permanent furniture for something you do once:
            the reassurance is true but you only need reading once, and changing
            vault is a rare, considered act. They live in
            Settings → Source folder now, which is also where the path itself is
            — the sidebar keeps the space switcher, which you use constantly. */}
      </div>

      {/* The bottom strip: settings (untouched, still h-10 w-10), then bin +
          archive at the same h-10 height but growing to fill whatever's left
          of the sidebar's current width — wider drop targets since both are
          dropped into constantly, without standing taller than the gear.
          Under live evaluation, not yet logged to CHANGELOG.md's Unreleased.
          inset-x-3 (rather than a fixed width) is what lets them track the
          sidebar's width as it's resized. */}
      <div className="pointer-events-none absolute inset-x-3 bottom-3 z-40 flex items-end gap-2">
        <SettingsButton
            settings={settings}
            onChange={onChangeSettings}
            spaceActions={spaceActions}
            vault={vaultPath}
            onPickVault={actions.onPickVault}
            presets={presets}
            presetActions={presetActions}
            jumpToSection={settingsJumpToSection}
            onJumpHandled={onSettingsJumpHandled}
          />
        <button
          onClick={() => {
            setView((v) => (v === 'bin' ? 'notes' : 'bin'))
            onQuery('')
            flipLid()
          }}
          onDragOver={(e) => {
            if (!dragging) return
            e.preventDefault()
            setDropZone('trash')
          }}
          onDragLeave={() => setDropZone((z) => (z === 'trash' ? null : z))}
          onDrop={(e) => {
            e.preventDefault()
            if (dragging) {
              actions.onTrash(dragging)
              flipLid()
              clearSel()
            }
            setDragging(null)
            setDropZone(null)
          }}
          data-tip={inBin ? 'Back to your notes' : 'Bin — deleted notes wait here'}
          aria-pressed={inBin}
          className={
            'btn-edge pointer-events-auto flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl border border-ink-300/30 px-2 text-[12px] font-medium tabular-nums shadow-card outline-none backdrop-blur transition duration-200 spring hover:-translate-y-0.5 hover:text-brand-600 focus-visible:ring-4 focus-visible:ring-brand-100 ' +
            (inBin || dropZone === 'trash'
              ? 'bg-brand-500/15 text-brand-600'
              : 'bg-surface/90 text-ink-500')
          }
        >
          <span className={lidOpen ? 'lid-open' : ''}>
            <BinIcon className="h-4 w-4" />
          </span>
          {workspace.trash.length > 0 && <span>{workspace.trash.length}</span>}
        </button>
        <button
          onClick={() => {
            setView((v) => (v === 'archive' ? 'notes' : 'archive'))
            onQuery('')
            flipArchiveLid()
          }}
          onDragOver={(e) => {
            if (!dragging) return
            e.preventDefault()
            setDropZone('archive')
          }}
          onDragLeave={() => setDropZone((z) => (z === 'archive' ? null : z))}
          onDrop={(e) => {
            e.preventDefault()
            if (dragging) {
              actions.onArchive(dragging, true)
              flipArchiveLid()
              clearSel()
            }
            setDragging(null)
            setDropZone(null)
          }}
          data-tip={inArchive ? 'Back to your notes' : 'Archived notes'}
          aria-pressed={inArchive}
          className={
            'btn-edge pointer-events-auto flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl border border-ink-300/30 px-2 text-[12px] font-medium tabular-nums shadow-card outline-none backdrop-blur transition duration-200 spring hover:-translate-y-0.5 hover:text-brand-600 focus-visible:ring-4 focus-visible:ring-brand-100 ' +
            (inArchive || dropZone === 'archive'
              ? 'bg-brand-500/15 text-brand-600'
              : 'bg-surface/90 text-ink-500')
          }
        >
          <span className={archiveLidOpen ? 'lid-open' : ''}>
            <ArchiveIcon className="h-4 w-4" />
          </span>
          {archivedNodes.length > 0 && <span>{archivedNodes.length}</span>}
        </button>
      </div>
    </aside>
    {/* A sibling of <aside>, not a fixed descendant of it: the aside's own
        backdrop-blur makes it a containing block for position:fixed, which
        would trap this at width 0 once collapsed. */}
    {collapsed && (
      <button
        onClick={() => setCollapsed(false)}
        data-tip="Show sidebar"
        className="btn-edge fixed left-2 top-3 z-40 flex items-center justify-center rounded-lg border border-ink-300/30 bg-surface/90 p-1.5 text-ink-500 shadow-card backdrop-blur transition duration-200 hover:text-brand-600 focus-visible:ring-4 focus-visible:ring-brand-100"
      >
        <Icon name="panelLeft" className="h-4 w-4" />
      </button>
    )}
    </>
  )
}
