import { useMemo, useState } from 'react'
import type { TreeNode } from '../../shared/types'
import type { Workspace } from '../../shared/workspace'
import type { AppSettings } from '../../shared/settings'
import type { UpdateStatus } from '../../shared/update'
import { UpdateBanner } from './update/UpdateBanner'
import { BinIcon, Icon } from './icons'
import { SettingsButton } from './settings/Settings'
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
// header + archive toggle, the spotlight search pill, the Note/Folder/Organize
// bar, a Pinned section, the tree, and the archive and bin shelf views.

interface Props {
  vaultName: string
  tree: TreeNode[]
  workspace: Workspace
  openPath: string | null
  settings: AppSettings
  onChangeSettings: (partial: Partial<AppSettings>) => void

  query: string
  onQuery: (q: string) => void
  deep: boolean
  onToggleDeep: () => void
  withArchived: boolean
  onToggleWithArchived: () => void
  searchHits: SearchHit[] | null
  onOpenSearchHit: (hit: SearchHit) => void
  update: UpdateStatus

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
      title={title}
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
        title="Sort the archive"
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
  tree,
  workspace,
  openPath,
  settings,
  onChangeSettings,
  query,
  onQuery,
  deep,
  onToggleDeep,
  withArchived,
  onToggleWithArchived,
  searchHits,
  onOpenSearchHit,
  update,
  actions
}: Props): React.JSX.Element {
  const [view, setView] = useState<View>('notes')
  const [organize, setOrganize] = useState(false)
  const [selection, setSelection] = useState<Selection>({ paths: new Set() })
  const [dragging, setDragging] = useState<string[] | null>(null)
  const [archiveSort, setArchiveSort] = useState<ArchiveSort>('recent')
  const [dropZone, setDropZone] = useState<'archive' | 'trash' | null>(null)
  const [lidClick, setLidClick] = useState(false)

  const inArchive = view === 'archive'
  const inBin = view === 'bin'
  const searching = searchHits !== null
  const selCount = selection.paths.size
  const clearSel = (): void => setSelection({ paths: new Set() })

  // The bin lid hinges open when something goes in — the cue that it landed.
  const flipLid = (): void => {
    setLidClick(true)
    setTimeout(() => setLidClick(false), 420)
  }
  const lidOpen = lidClick || dropZone === 'trash'

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
    workspace,
    openPath,
    freeArrange: settings.freeArrange,
    organize,
    selection,
    onSelectionChange: setSelection,
    dragging,
    onDragging: setDragging,
    ...treeActions
  }

  return (
    <aside
      className="relative flex h-full w-72 shrink-0 select-none flex-col border-r border-ink-300/25 bg-surface/45 backdrop-blur"
      onContextMenu={(e) => {
        if (e.target === e.currentTarget) actions.onContext(e, null)
      }}
    >
      {/* The archive drop target exists only while dragging, and overlays the
          vault name rather than pushing the tree down — a row appearing mid-drag
          would move the rows out from under your cursor. */}
      {dragging && !inBin && !inArchive && (
        <div
          onDragOver={(e) => {
            e.preventDefault()
            setDropZone('archive')
          }}
          onDragLeave={() => setDropZone((z) => (z === 'archive' ? null : z))}
          onDrop={(e) => {
            e.preventDefault()
            actions.onArchive(dragging, true)
            setDragging(null)
            setDropZone(null)
            clearSel()
          }}
          className={
            'fade-in absolute inset-x-2 top-2 z-30 flex items-center justify-center gap-2 rounded-xl border-2 border-dashed bg-surface px-3 py-3 text-[12px] font-medium transition-all duration-200 ' +
            (dropZone === 'archive'
              ? 'border-brand-400 text-brand-600 ring-4 ring-brand-500/15'
              : 'border-ink-300/40 text-ink-400')
          }
        >
          <Icon name="archive" className="h-4 w-4" />
          <span>Drop here to archive</span>
        </div>
      )}

      {/* The header is the vault name alone — the archive toggle moved down to
          the bottom strip, beside the bin, since both are shelf views and they
          read as a pair there. */}
      <div className="flex items-center gap-2 px-4 pt-4 pb-2.5">
        <p className="min-w-0 flex-1 truncate font-display text-lg font-semibold text-ink-900" title={vaultName}>
          {vaultName}
        </p>
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
      <div className={'flex items-center gap-1 px-3 pb-1.5 ' + (inArchive || inBin ? 'hidden' : '')}>
        <TB onClick={actions.onNewNote} title="New note (Ctrl+N)">
          <Icon name="filePlus" className="h-4 w-4" />
          <span>Note</span>
        </TB>
        <TB onClick={actions.onNewFolder} title="New folder">
          <Icon name="folderPlus" className="h-4 w-4" />
          <span>Folder</span>
        </TB>
        <div className="flex-1" />
        <TB
          onClick={() => setOrganize((o) => !o)}
          active={organize}
          title="Rename & delete folders"
        >
          <Icon name={organize ? 'x' : 'sliders'} className="h-4 w-4" />
          <span>{organize ? 'Done' : 'Organize'}</span>
        </TB>
      </div>

      {organize && !searching && !inBin && (
        <p className="mx-3 mb-1.5 rounded-lg bg-brand-50 px-3 py-1.5 text-[11px] leading-snug text-brand-600">
          Rename or delete folders · click <b>Done</b> when finished.
        </p>
      )}

      {selCount > 1 && (
        <div className="fade-in mx-3 mb-1.5 flex items-center gap-2 rounded-lg bg-brand-50 px-3 py-1.5 text-[11px] text-brand-600">
          <span className="flex-1">{selCount} selected · drag to move them together</span>
          <button
            onClick={clearSel}
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
          onClick={(e) => {
            if (e.target === e.currentTarget) clearSel()
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
                      title="Put back"
                      className="shrink-0 rounded border-none bg-transparent p-0.5 text-ink-300 outline-none transition-colors hover:bg-transparent hover:text-brand-600"
                    >
                      <Icon name="restore" />
                    </button>
                    <button
                      onClick={() => actions.onPurge([item.id])}
                      title="Delete permanently"
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

              {mainTree.length === 0 && pinned.length === 0 && (
                <p className="px-3 py-6 text-center text-sm text-ink-300">
                  {archivedNodes.length ? 'Everything is archived.' : 'No notes yet.'}
                </p>
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
              if (
                window.confirm(
                  `Permanently delete ${workspace.trash.length} item${workspace.trash.length === 1 ? '' : 's'}? They go to your computer's trash.`
                )
              ) {
                actions.onPurge()
                flipLid()
              }
            }}
            className="fade-in absolute inset-x-2 bottom-full z-30 mb-2 flex items-center justify-center gap-2 rounded-xl border border-brand-400/70 bg-surface px-3 py-3 text-[12px] font-semibold text-brand-600 outline-none ring-2 ring-brand-500/15 transition duration-200 hover:bg-brand-500/10 hover:ring-4 hover:ring-brand-500/25"
          >
            <span className={lidOpen ? 'lid-open' : ''}>
              <BinIcon className="h-4 w-4" />
            </span>
            <span>Empty recycle bin</span>
          </button>
        )}

        {/* Mirrors the archive drop zone at the top: only when there's something
            to delete, and overlays rather than resizing the tree. */}
        {!inBin && (dragging || selCount > 0) && (
          <div
            role={dragging ? undefined : 'button'}
            tabIndex={dragging ? undefined : 0}
            onDragOver={
              dragging
                ? (e) => {
                    e.preventDefault()
                    setDropZone('trash')
                  }
                : undefined
            }
            onDragLeave={dragging ? () => setDropZone((z) => (z === 'trash' ? null : z)) : undefined}
            onDrop={
              dragging
                ? (e) => {
                    e.preventDefault()
                    actions.onTrash(dragging)
                    flipLid()
                    setDragging(null)
                    setDropZone(null)
                    clearSel()
                  }
                : undefined
            }
            onClick={
              dragging
                ? undefined
                : () => {
                    actions.onTrash([...selection.paths])
                    flipLid()
                    clearSel()
                  }
            }
            className={
              'fade-in absolute inset-x-2 bottom-full z-30 mb-2 flex items-center justify-center gap-2 rounded-xl border-2 border-dashed bg-surface px-3 py-3 text-[12px] font-medium outline-none transition-all duration-200 ' +
              (dragging ? '' : 'cursor-pointer ') +
              (dropZone === 'trash'
                ? 'border-brand-400 text-brand-600 ring-4 ring-brand-500/15'
                : 'border-ink-300/40 text-ink-400 hover:border-brand-300 hover:text-brand-600')
            }
          >
            <span className={lidOpen ? 'lid-open' : ''}>
              <BinIcon className="h-4 w-4" />
            </span>
            <span>{dragging ? 'Drop here to bin' : `Move ${selCount} to bin`}</span>
          </div>
        )}

        <UpdateBanner status={update} canSelfUpdate={update.state !== 'unsupported'} />

        <button
          onClick={actions.onPickVault}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-ink-300/35 bg-surface/70 px-3 py-1.5 text-[13px] font-medium text-ink-700 outline-none transition duration-200 hover:border-brand-300 hover:bg-surface/70 hover:text-brand-600 focus-visible:ring-4 focus-visible:ring-brand-100"
          title="Open a different folder as your vault"
        >
          <Icon name="folder" className="h-4 w-4" />
          Switch folder
        </button>
        <p className="mt-1.5 text-center text-[11px] leading-tight text-ink-300">
          Editing real .md files on disk
        </p>
      </div>

      {/* The bottom strip: settings, then the bin beside it — same slot legacy
          puts them in. Absolute so it overlays the footer's reserved padding. */}
      <div className="pointer-events-none absolute bottom-3 left-3 z-40 flex items-end gap-2">
        <SettingsButton settings={settings} onChange={onChangeSettings} />
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
          title={inBin ? 'Back to your notes' : 'Bin — deleted notes wait here'}
          aria-pressed={inBin}
          className={
            'pointer-events-auto flex h-10 min-w-10 shrink-0 items-center justify-center gap-1 rounded-xl border border-ink-300/30 px-2 text-[11px] font-medium tabular-nums shadow-card outline-none backdrop-blur transition duration-200 spring hover:-translate-y-0.5 hover:text-brand-600 focus-visible:ring-4 focus-visible:ring-brand-100 ' +
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
          }}
          title={inArchive ? 'Back to your notes' : 'Archived notes'}
          aria-pressed={inArchive}
          className={
            'pointer-events-auto flex h-10 min-w-10 shrink-0 items-center justify-center gap-1 rounded-xl border border-ink-300/30 px-2 text-[11px] font-medium tabular-nums shadow-card outline-none backdrop-blur transition duration-200 spring hover:-translate-y-0.5 hover:text-brand-600 focus-visible:ring-4 focus-visible:ring-brand-100 ' +
            (inArchive ? 'bg-brand-500/15 text-brand-600' : 'bg-surface/90 text-ink-500')
          }
        >
          <Icon name="archive" className="h-4 w-4" />
          {archivedNodes.length > 0 && <span>{archivedNodes.length}</span>}
        </button>
      </div>
    </aside>
  )
}
