import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { TreeNode } from '../../shared/types'
import type { Workspace } from '../../shared/workspace'
import type { EditorView } from '@codemirror/view'
import { ContextMenu, type MenuItem } from './ContextMenu'
import { clearImageCache } from './editor/imageAssets'
import type { SectionId } from './settings/Settings'
import { FormatToolbar } from './editor/FormatToolbar'
import { NotePane, ROW_CLASS, type Drag } from './tabs/NotePane'
import { TabStrip } from './tabs/TabStrip'
import {
  activePath,
  closePane,
  closeTab,
  closeUnder,
  cycle,
  EMPTY_LAYOUT,
  MAX_PANES,
  moveTab,
  BLANK,
  movePane,
  openTab,
  renamePath,
  replaceActive,
  restoreLayout,
  selectTab,
  showInPane,
  splitAt,
  splitBlank,
  swapPanes,
  type TabLayout
} from './tabs/model'
import { applySettings } from './settings/model'
import { liveIndex, noteRefs } from './links/model'
import { PathBar } from './PathBar'
import { Tooltip } from './Tooltip'
import { LinkInspector, type Inspect } from './links/LinkInspector'
import { indexLinks, rewriteLinks, titleOf, type LinkRow } from '../../shared/links'
import type { LinkEnv, LinkHandlers, OpenHow } from './editor/linkEnv'
import {
  activeSpace,
  DEFAULT_SETTINGS,
  reconcileSpaces,
  SPACE_CAP,
  withNewSpace,
  withSpacePatch,
  type AppSettings
} from '../../shared/settings'
import type { SpaceActions } from './settings/Spaces'
import { ALL_SPACES, type PresetActions } from './settings/Presets'
import {
  lookKey,
  pickLook,
  PRESET_CAP,
  presetFromSpace,
  vaultName as vaultFolderName,
  type SpacePreset
} from '../../shared/presets'
import { Sidebar } from './Sidebar'
import type { SearchHit } from './Search'
import type { UpdateStatus } from '../../shared/update'
import { Icon } from './icons'
import {
  autoColorPlan,
  colorOf,
  findNode,
  isArchived,
  siblingColors,
  sortSiblings
} from './organise/model'
import { ColorPopover, type Anchor } from './color/Picker'
import { PALETTE_MAX, pickAutoColor } from '../../shared/color'

// --- small path helpers (renderer works in vault-relative POSIX paths) ---
const parentOf = (p: string): string => {
  const i = p.lastIndexOf('/')
  return i === -1 ? '' : p.slice(0, i)
}
const nameOf = (p: string): string => {
  const i = p.lastIndexOf('/')
  return i === -1 ? p : p.slice(i + 1)
}
const joinPath = (dir: string, name: string): string => (dir ? `${dir}/${name}` : name)
const baseName = (osPath: string): string => osPath.split(/[\\/]/).filter(Boolean).pop() ?? osPath
const stripMd = (s: string): string => (s.toLowerCase().endsWith('.md') ? s.slice(0, -3) : s)
const countWords = (t: string): number => (t.trim().match(/\S+/g) ?? []).length

// Steps up to the nearest shared ancestor folder, then back down — 0 for two
// notes in the same folder, 1 for parent/child, etc. Used to bias search
// results toward whatever folder you're currently working in.
const folderDistance = (a: string, b: string): number => {
  const as = a.split('/').filter(Boolean)
  const bs = b.split('/').filter(Boolean)
  let shared = 0
  while (shared < as.length && shared < bs.length && as[shared] === bs[shared]) shared++
  return as.length - shared + (bs.length - shared)
}

const EMPTY_WS: Workspace = { entries: {}, trash: [] }

/** The placeholder command row has no editor behind it; its buttons are inert
 *  and it is only there to hold the space open. */
const NO_VIEW: React.RefObject<EditorView | null> = { current: null }

/** Re-key a path map after a rename/move (a moved folder takes its notes with
 *  it, so descendants are re-keyed too). */
const remapKeys = <T,>(m: Map<string, T>, map: (p: string) => string): void => {
  for (const [p, v] of [...m]) {
    const next = map(p)
    if (next === p) continue
    m.delete(p)
    m.set(next, v)
  }
}
const remapRecord = <T,>(r: Record<string, T>, map: (p: string) => string): Record<string, T> =>
  Object.fromEntries(Object.entries(r).map(([p, v]) => [map(p), v]))

export default function App(): React.JSX.Element {
  const [ready, setReady] = useState(false)
  const [vault, setVault] = useState<string | null>(null)
  const [tree, setTree] = useState<TreeNode[]>([])
  const treeRef = useRef(tree)
  treeRef.current = tree
  const [workspace, setWorkspace] = useState<Workspace>(EMPTY_WS)
  // Which notes are open as tabs, and which of them each pane shows. All the
  // arithmetic (what a pane falls back to, where a dropped tab lands) is in
  // tabs/model.ts; App only holds the result and the documents behind it.
  const [layout, setLayout] = useState<TabLayout>(EMPTY_LAYOUT)
  const openPath = activePath(layout) // the focused pane's note
  const layoutRef = useRef(layout)
  layoutRef.current = layout
  // What is being dragged, if anything — a tab out of the strip or a whole
  // column by its row. The panes show their drop zones for either.
  const [drag, setDrag] = useState<Drag | null>(null)
  // Loaded text for every open note. A ref, not state: a keystroke must not
  // re-render the other panes' editors. `versions` IS state, because pushing a
  // freshly loaded document into an editor is exactly what a render is for — it
  // bumps only on an intentional load (open, external change), never on typing,
  // so no editor is ever re-seeded out from under the cursor.
  const docsRef = useRef<Map<string, string>>(new Map())
  const loadingRef = useRef<Set<string>>(new Set())
  const [versions, setVersions] = useState<Record<string, number>>({})
  const [wordCounts, setWordCounts] = useState<Record<string, number>>({})
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null)
  // Which rows the colour picker is open for, and where it points. One popover
  // for the whole window, like the context menu and the hover card — the
  // sidebar renders four TreeViews and a per-instance picker could put two on
  // screen at once.
  const [colorFor, setColorFor] = useState<{ paths: string[]; at: Anchor } | null>(null)
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS)
  // Appearance, arranging and the format bar's custom buttons belong to the
  // active space; the rest of `settings` is global. Derived rather than stored,
  // so the two can never disagree — a find over at most SPACE_CAP items.
  const space = activeSpace(settings)
  // The saved-preset library (shared/presets.ts). App owns it rather than the
  // settings window, because the mirror below has to keep running whether or not
  // that window is open. There is nothing here about WHERE it lives: it lives in
  // the app, so a vault switch neither moves it nor has anything to ask.
  const [presets, setPresets] = useState<SpacePreset[]>([])
  // Search (spotlight pill). `deep` also matches note contents, not just titles;
  // `withArchived` lets shelved notes back into the results; `allSpaces` widens
  // the index from the active space to the whole vault.
  const [query, setQuery] = useState('')
  const [deep, setDeep] = useState(false)
  const [withArchived, setWithArchived] = useState(false)
  const [allSpaces, setAllSpaces] = useState(false)
  const [cacheVersion, setCacheVersion] = useState(0)
  const contentCache = useRef<Map<string, string>>(new Map())
  // Every note's outgoing [[links]], as main last read them off disk. The
  // backlink half of the links block is derived from this; the notes that are
  // OPEN are laid over the top from `docsRef`, so what you have just typed shows
  // up before the autosave rather than after it.
  const [linkRows, setLinkRows] = useState<LinkRow[]>([])
  const linkRowsRef = useRef(linkRows)
  linkRowsRef.current = linkRows
  // Bumped when an open note's links change, which is the only thing about
  // typing that the links block cares about — not every keystroke.
  const [openLinkVersion, setOpenLinkVersion] = useState(0)
  const openTargetsRef = useRef<Map<string, string>>(new Map())
  // `[[Note#Heading]]`: the note opens, and the heading is looked for once its
  // text has landed in the pane.
  const [pendingHeading, setPendingHeading] = useState<{ path: string; heading: string } | null>(null)
  // The sidebar's "open this folder, close the rest", handed up so the path bar
  // can drive it. Imperative on purpose — see Sidebar's `revealRef` prop.
  const revealRef = useRef<((folder: string) => void) | null>(null)
  // Each space's own tabs. A note opened in one space stays open when you go
  // elsewhere — it just isn't on screen, because a strip showing notes you
  // can't see in the sidebar is the confusing part. Swapped explicitly by
  // `switchSpace` rather than in an effect, so following a cross-space link
  // can't race the swap and open into the space it just left.
  // In memory only: `settings.session` remembers the space you were IN, which is
  // the one you come back to.
  const spaceTabs = useRef<Map<string, TabLayout>>(new Map())
  // The one hover card, for every link anywhere: a chip in a note's links strip
  // or a [[link]] in the text. Held here rather than by whatever raised it so
  // there is only ever one on screen, and so it can be portalled clear of the
  // strip — which carries a transform and a backdrop blur, either of which would
  // capture a `position: fixed` child (CLAUDE.md).
  const [inspect, setInspect] = useState<Inspect | null>(null)
  // In-app updates. `unsupported` covers a dev build and unsigned macOS; the
  // banner and Settings both read it, so it lives here and flows down.
  const [update, setUpdate] = useState<UpdateStatus>({ state: 'idle' })
  const [notice, setNotice] = useState<string | null>(null)
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const flash = useCallback((msg: string): void => {
    setNotice(msg)
    if (noticeTimer.current) clearTimeout(noticeTimer.current)
    noticeTimer.current = setTimeout(() => setNotice(null), 4000)
  }, [])

  // in-app prompt (window.prompt is unreliable in Electron)
  const [prompt, setPrompt] = useState<{ title: string; value: string } | null>(null)
  const promptResolve = useRef<((v: string | null) => void) | null>(null)
  const ask = useCallback((title: string, initial = ''): Promise<string | null> => {
    setPrompt({ title, value: initial })
    return new Promise((resolve) => {
      promptResolve.current = resolve
    })
  }, [])
  const closePrompt = (v: string | null): void => {
    setPrompt(null)
    promptResolve.current?.(v)
    promptResolve.current = null
  }

  // --- autosave: 400ms after typing stops, on window blur, and before quit ---
  // Keyed by path now that several notes can be open at once: one timer, but a
  // buffer per dirty note, so a pane you last typed in ten seconds ago still
  // gets written when a pane you are typing in now triggers the flush.
  const dirtyRef = useRef<Map<string, string>>(new Map())
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const flush = useCallback(async (): Promise<void> => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current)
      saveTimer.current = null
    }
    const pending = [...dirtyRef.current]
    if (!pending.length) return
    dirtyRef.current.clear()
    for (const [path, text] of pending) {
      try {
        await window.api.writeNote(path, text)
      } catch (e) {
        // Keep the buffer for a later retry — unless typing has already put a
        // newer one in its place, which must not be overwritten by this one.
        if (!dirtyRef.current.has(path)) dirtyRef.current.set(path, text)
        flash(`Save failed: ${(e as Error).message}`)
      }
    }
  }, [flash])

  const onDocChange = useCallback(
    (path: string, text: string): void => {
      dirtyRef.current.set(path, text)
      // Keep the loaded copy current too: a pane that shows this note again
      // later re-seeds from here, and stale text would look like lost edits.
      docsRef.current.set(path, text)
      const words = countWords(text)
      setWordCounts((c) => (c[path] === words ? c : { ...c, [path]: words }))
      // Re-derive the links block only when the LINKS changed, not on every
      // keystroke: typing inside a paragraph must not cost a backlink rebuild
      // across every open note.
      const targets = indexLinks(text)
        .map((l) => l.target + '#' + (l.heading ?? ''))
        .join(' ')
      if (openTargetsRef.current.get(path) !== targets) {
        openTargetsRef.current.set(path, targets)
        setOpenLinkVersion((v) => v + 1)
      }
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(() => void flush(), 400)
    },
    [flush]
  )

  /** Read a note from disk into the open-documents map. The version bump is what
   *  the pane showing it reacts to. */
  const loadDoc = useCallback(async (path: string): Promise<void> => {
    if (path === BLANK || loadingRef.current.has(path)) return
    loadingRef.current.add(path)
    let text = ''
    try {
      text = await window.api.readNote(path)
    } catch {
      text = '' // unreadable (gone, or not yet written) — show it empty
    } finally {
      loadingRef.current.delete(path)
    }
    docsRef.current.set(path, text)
    setWordCounts((c) => ({ ...c, [path]: countWords(text) }))
    setVersions((v) => ({ ...v, [path]: (v[path] ?? 0) + 1 }))
  }, [])

  const loadTree = useCallback(async (): Promise<TreeNode[]> => {
    const t = await window.api.listTree()
    setTree(t)
    return t
  }, [])
  const loadWorkspace = useCallback(async (): Promise<void> => {
    setWorkspace(await window.api.getWorkspace())
  }, [])

  // Appearance: load the active vault's settings (or cached defaults) and apply
  // theme/density/accent to <html>. `applySettings` is the only DOM writer.
  const changeSettings = useCallback(async (partial: Partial<AppSettings>): Promise<void> => {
    const next = await window.api.setSettings(partial)
    setSettings(next)
    applySettings(next)
  }, [])
  /** Which vault the `settings` in state were read from.
   *
   *  `vault` is set at the START of a folder switch and the settings arrive
   *  several awaits later, so for a moment the two disagree — and the preset
   *  mirror below, which stamps every saved look with the vault it came from,
   *  would file the OLD vault's spaces under the NEW vault's name. Passing the
   *  vault in rather than reading it from state is what keeps the pair honest. */
  const settingsVault = useRef<string | null>(null)
  const loadSettings = useCallback(async (forVault: string | null): Promise<AppSettings> => {
    const s = await window.api.getSettings()
    settingsVault.current = forVault
    setSettings(s)
    applySettings(s)
    return s
  }, [])

  /** Read the saved-preset library (shared/presets.ts).
   *
   *  Declared up here with the other loaders and NOT beside the rest of the
   *  preset code below, because the boot effect lists it as a dependency — and a
   *  deps array is evaluated during render, at the `useEffect` call itself, so a
   *  `const` declared further down would be read before its initialiser has run
   *  and throw on launch. */
  const loadPresets = useCallback(async (): Promise<void> => {
    try {
      setPresets(await window.api.listPresets())
    } catch {
      // The library is a convenience layer over settings.json, which none of
      // this touches — a failure here must never stop a vault opening.
    }
  }, [])

  /** Let go of a note that has just left the strip: write anything unsaved (a
   *  tab closing is not a way to discard edits, and the 400ms autosave may not
   *  have fired), then drop its loaded copy. */
  const dropDoc = useCallback(
    (path: string): void => {
      if (path === BLANK) return // the "+" tab never had a file
      const pending = dirtyRef.current.get(path)
      if (pending !== undefined) {
        dirtyRef.current.delete(path)
        void window.api
          .writeNote(path, pending)
          .catch((e: Error) => flash(`Save failed: ${e.message}`))
      }
      docsRef.current.delete(path)
    },
    [flash]
  )

  /** The single way the layout changes. Everything that opens, closes, splits,
   *  cycles or reorders goes through here, so "which notes are loaded" is
   *  reconciled with "which notes are open" in one place instead of at every
   *  call site — and `layoutRef` stays correct for the handler that runs next,
   *  before React has re-rendered. */
  const applyLayout = useCallback(
    (next: TabLayout): void => {
      const prev = layoutRef.current
      if (next === prev) return
      layoutRef.current = next
      setLayout(next)
      for (const gone of prev.tabs) if (!next.tabs.includes(gone)) dropDoc(gone)
    },
    [dropDoc]
  )

  // After a rename/move, keep every open tab — and any pending unsaved buffer —
  // pointed at the entry's new path (covers a moved folder's descendants too).
  const remapOpen = useCallback(
    (oldPath: string, newRel: string): void => {
      const map = (p: string): string =>
        p === oldPath
          ? newRel
          : p.startsWith(oldPath + '/')
            ? newRel + p.slice(oldPath.length)
            : p
      remapKeys(dirtyRef.current, map)
      remapKeys(docsRef.current, map)
      setWordCounts((c) => remapRecord(c, map))
      setVersions((v) => remapRecord(v, map))
      applyLayout(renamePath(layoutRef.current, oldPath, newRel))
    },
    [applyLayout]
  )

  /** Forget open notes / pending writes that have just left the vault. */
  const forgetIfInside = useCallback(
    (roots: string[]): void => {
      const inside = (p: string): boolean => roots.some((r) => p === r || p.startsWith(r + '/'))
      for (const p of [...dirtyRef.current.keys()]) if (inside(p)) dirtyRef.current.delete(p)
      for (const p of [...docsRef.current.keys()]) if (inside(p)) docsRef.current.delete(p)
      applyLayout(closeUnder(layoutRef.current, roots))
    },
    [applyLayout]
  )

  // --- spaces ---------------------------------------------------------------
  // The vault's top-level folders ARE the spaces. The tree already comes back
  // vault-relative, so scoping is a slice of it rather than a different query:
  // main keeps returning the whole vault and the sidebar renders one branch.
  // Memoised, not derived inline: an unmemoised `?? []` hands back a fresh array
  // every render, which would defeat the search index's own memo downstream.
  const spaceTree = useMemo<TreeNode[]>(() => {
    if (!space.folder) return tree // no spaces yet — the whole vault is the view
    return tree.find((n) => n.type === 'dir' && n.path === space.folder)?.children ?? []
  }, [tree, space.folder])
  // Notes sitting loose at the vault root, outside every space. Shown in their
  // own group rather than moved — nothing on disk shifts without being asked.
  const looseNotes = useMemo(
    () => (settings.spaces.length ? tree.filter((n) => n.type === 'file') : []),
    [tree, settings.spaces.length]
  )

  // Folders on disk are the source of truth, so every tree load re-syncs the
  // saved spaces against them: a folder made in Explorer becomes a space, and
  // one deleted there stops being one. `reconcileSpaces` returns null when
  // nothing changed, which keeps this from writing settings.json on every load.
  //
  // A vault must never settle on zero REAL (folder-backed) spaces — otherwise
  // the switcher hides and new notes/folders silently land at the vault root
  // ("Not in a space"). If reconciling leaves only the unbound whole-vault
  // placeholder, make a folder and register it. `withNewSpace` already rebinds
  // a lone unbound placeholder rather than appending beside it, so this carries
  // the placeholder's theme/density forward instead of resetting to defaults.
  // Termination: the folder created here is already a bound space in the
  // settings this call writes, so the watcher-triggered call this create
  // provokes sees a bound space and takes the normal no-op path.
  const syncSpaces = useCallback(
    async (t: TreeNode[], current: AppSettings): Promise<void> => {
      const folders = t.filter((n) => n.type === 'dir').map((n) => n.path)
      const reconciled = reconcileSpaces(current, folders)
      const merged = reconciled ? { ...current, ...reconciled } : current
      if (merged.spaces.some((sp) => sp.folder)) {
        if (reconciled) await changeSettings(reconciled)
        return
      }
      try {
        const folder = await window.api.createFolder('')
        await loadTree()
        await changeSettings(withNewSpace(merged, folder))
      } catch (e) {
        flash(`Couldn't create your first space: ${(e as Error).message}`)
        if (reconciled) await changeSettings(reconciled)
      }
    },
    [changeSettings, loadTree, flash]
  )

  /** Kept pointing at the live `colorExistingFolders` below — see the note on
   *  `onColorExistingFolders` in the object this feeds. */
  const colorExistingRef = useRef<(folders: string[]) => void>(() => {})

  /** Kept pointing at the live `openImportedSpace` below — see the note on
   *  `onOpenSpace` in the object this feeds. */
  const openSpaceRef = useRef<(folder: string) => Promise<void>>(async () => {})

  const spaceActions: SpaceActions = useMemo(
    () => ({
      // Via a ref for the same reason onColorExistingFolders is: it needs
      // switchSpace and settingsRef, both declared further down.
      onOpenSpace: (folder) => openSpaceRef.current(folder),
      onCreateSpace: async () => {
        try {
          const path = await window.api.createFolder('') // '' = vault root
          await loadTree()
          return path
        } catch (e) {
          flash(`Couldn't create the space: ${(e as Error).message}`)
          return null
        }
      },
      onRenameSpace: async (from, to) => {
        try {
          const actual = await window.api.renameEntry(from, to)
          await loadTree()
          await loadWorkspace() // main re-keys the entry and its descendants
          // Anything open inside this space moved with it. Without this the
          // open note keeps its old path and the next autosave writes into a
          // folder that no longer exists. Same call the tree's own rename makes.
          remapOpen(from, actual)
          // Main sanitises for cross-platform safety, so say so rather than
          // letting the name quietly come back different — same as tree rename.
          if (actual !== to) flash(`Renamed to "${actual}" (adjusted for cross-platform safety)`)
          // The library keys a preset by (space name, vault), so a rename has to
          // move the saved look with it — otherwise the next mirror writes a
          // second preset under the new name and the old one sits there as a
          // twin that never updates again.
          //
          // Caught SEPARATELY, because by this line the rename has already
          // happened: the folder moved, the tree reloaded, the open tabs were
          // remapped. Letting a preset failure fall to the outer catch returns
          // null, and `renameSpace` reads that as "the rename failed" and skips
          // withSpaceRenamed — leaving settings pointed at a folder that is no
          // longer there. The library is a mirror (it can be rebuilt); the
          // filesystem rename is the real work and it succeeded, so this reports
          // the shortfall and still returns the name main actually used.
          if (vault) {
            try {
              setPresets(await window.api.renamePreset(from, actual, vaultFolderName(vault)))
            } catch (e) {
              flash(`Space renamed, but its saved look kept the old name: ${(e as Error).message}`)
            }
          }
          return actual
        } catch (e) {
          flash(`Couldn't rename the space: ${(e as Error).message}`)
          return null
        }
      },
      onDeleteSpace: async (folder) => {
        try {
          // Straight to the OS trash — deliberately NOT window.api.trashEntries,
          // which is the app's own recoverable bin. A deleted space sitting in
          // that bin next to individually-trashed notes conflates two different
          // levels of the hierarchy; the two-step "click again" button is the
          // confirmation, so it doesn't need a second, in-app safety net too.
          setWorkspace(await window.api.deleteSpace(folder))
          await loadTree()
          // If the open note was inside it, close it and drop any pending save —
          // otherwise autosave would try to write it back into a gone folder.
          forgetIfInside([folder])
          return true
        } catch (e) {
          flash(`Couldn't delete the space: ${(e as Error).message}`)
          return false
        }
      },
      // Through a ref, because the implementation needs `run` and the tree
      // helpers, which are declared further down this component — calling it
      // directly here would read a `const` before its initialiser has run. Same
      // idiom `menuHandler` uses below, and for the same reason.
      onColorExistingFolders: (folders) => colorExistingRef.current(folders)
    }),
    [loadTree, loadWorkspace, flash, remapOpen, forgetIfInside, vault]
  )

  /** Open a note. A plain sidebar click REPLACES the focused note — the strip
   *  doesn't grow, which is how clicking a note behaved before tabs existed;
   *  Cmd/Ctrl+click (`newTab`) is what adds one. Notes stay open until closed,
   *  so this only reads from disk the first time. */
  const openNote = useCallback(
    async (p: string, newTab = false): Promise<void> => {
      applyLayout(newTab ? openTab(layoutRef.current, p) : replaceActive(layoutRef.current, p))
      if (!docsRef.current.has(p)) await loadDoc(p)
    },
    [applyLayout, loadDoc]
  )

  const closeNote = useCallback(
    (path: string): void => applyLayout(closeTab(layoutRef.current, path)),
    [applyLayout]
  )

  /** The top-level folder a path belongs to — "" for a note loose at the vault
   *  root, which belongs to no space and so shows in all of them. */
  const spaceOf = (p: string): string => (p.includes('/') ? p.slice(0, p.indexOf('/')) : '')

  /** Move to another space, taking this one's tabs with you. */
  const switchSpace = useCallback(
    async (folder: string): Promise<void> => {
      const from = settingsRef.current.activeSpaceFolder
      if (from === folder) return
      spaceTabs.current.set(from, layoutRef.current)
      await changeSettings({ activeSpaceFolder: folder })
      applyLayout(spaceTabs.current.get(folder) ?? EMPTY_LAYOUT)
    },
    [changeSettings, applyLayout]
  )

  // --- links ------------------------------------------------------------------
  /** Show a folder from the path bar. The sidebar does the opening and closing;
   *  what App has to add is the space, because the sidebar only ever renders one
   *  space's branch — so revealing a folder in a space you aren't in has to
   *  switch to it first, or the reveal would silently do nothing. */
  const reveal = useCallback(
    async (folder: string): Promise<void> => {
      const wanted = folder.split('/')[0]
      const isSpace = settingsRef.current.spaces.some((sp) => sp.folder === wanted)
      if (isSpace && wanted !== settingsRef.current.activeSpaceFolder) await switchSpace(wanted)
      // The space's own crumb has no row of its own — the sidebar is already
      // showing its contents — so revealing it means closing everything else,
      // which an empty ancestor chain does anyway.
      revealRef.current?.(folder)
    },
    [switchSpace]
  )



  /** Open a note beside the one you're in, rather than over it — what Alt+click
   *  on a link does, and what dropping a link on a column's edge does. */
  const openBeside = useCallback(
    async (p: string): Promise<void> => {
      const l = layoutRef.current
      applyLayout(l.panes.length >= MAX_PANES ? showInPane(l, p, l.focus) : splitAt(l, p, l.focus + 1))
      if (!docsRef.current.has(p)) await loadDoc(p)
    },
    [applyLayout, loadDoc]
  )

  const openLink = useCallback(
    async (p: string, how: OpenHow, heading?: string | null): Promise<void> => {
      // A note belongs to its space. Following a link into another one takes you
      // there rather than dragging the note across — otherwise the tab strip
      // would show a note the sidebar beside it can't.
      const owner = spaceOf(p)
      if (owner && owner !== settingsRef.current.activeSpaceFolder) {
        if (settingsRef.current.spaces.some((sp) => sp.folder === owner)) await switchSpace(owner)
      }
      if (heading) setPendingHeading({ path: p, heading })
      if (how === 'split') await openBeside(p)
      else await openNote(p, how === 'tab')
    },
    [openBeside, openNote, switchSpace]
  )

  /** Clicking a `[[link]]` to a note nobody has written yet: make it, beside the
   *  note that mentioned it, and open it. The name is sanitised in main, so the
   *  path that comes back is the one to use — never the title we asked for. */
  const createFromLink = useCallback(
    async (dir: string, title: string, how: OpenHow): Promise<void> => {
      try {
        const actual = await window.api.createNote(dir, title)
        await loadTree()
        await openLink(actual, how)
        if (titleOf(actual) !== title) {
          flash(`Made "${titleOf(actual)}" — "${title}" isn't a usable filename`)
        }
      } catch (e) {
        flash(`Couldn't make that note: ${(e as Error).message}`)
      }
    },
    [loadTree, openLink, flash]
  )

  /** Every note in the whole vault, for resolving links. Deliberately not the
   *  space-scoped `allNotes` the search uses: a link may point outside the space
   *  you're in, and showing which space it lands in is the point. */
  const vaultNotes = useMemo(() => noteRefs(tree), [tree])

  /** When each note was made and last written, straight off the tree main sends.
   *  Rebuilt with the tree, which is also what the watcher refreshes — so an edit
   *  made in another app updates the "last edited" here without anything extra. */
  const fileTimes = useMemo(() => {
    const out: Record<string, { createdAt?: number; updatedAt?: number }> = {}
    const walk = (nodes: TreeNode[]): void => {
      for (const n of nodes) {
        if (n.type === 'file') out[n.path] = { createdAt: n.createdAt, updatedAt: n.updatedAt }
        else if (n.children) walk(n.children)
      }
    }
    walk(tree)
    return out
  }, [tree])

  /** What the editors need to know about the vault. Per-pane `path` is added by
   *  the pane itself — a link resolves relative to the note it is written in. */
  const linkEnvBase = useMemo(
    (): Omit<LinkEnv, 'path'> => ({
      notes: vaultNotes,
      spaces: settings.spaces.map((sp) => ({ folder: sp.folder, emoji: sp.emoji }))
    }),
    [vaultNotes, settings.spaces]
  )

  const linkHandlers = useMemo(
    (): LinkHandlers => ({
      open: (p, how, heading) => void openLink(p, how, heading),
      create: (dir, title, how) => void createFromLink(dir, title, how),
      jump: (heading) => setPendingHeading({ path: activePath(layoutRef.current) ?? '', heading }),
      reveal: (folder) => void reveal(folder),
      inspect: (at) => setInspect(at as Inspect | null),
      dragStart: (p) => setDrag({ kind: 'tab', path: p }),
      dragEnd: () => setDrag(null)
    }),
    [openLink, createFromLink, reveal]
  )

  /** The index as it stands now: what main read from disk, with the open buffers
   *  laid over it. `openLinkVersion` is what re-runs this — deliberately not
   *  every keystroke, only the ones that changed a link. */
  const linkIndex = useMemo(
    () => liveIndex(linkRows, new Map(docsRef.current)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [linkRows, openLinkVersion, layout.tabs]
  )

  const rescanLinks = useCallback(async (paths?: string[]): Promise<void> => {
    try {
      const rows = await window.api.scanLinks(paths)
      setLinkRows((prev) => {
        if (!paths) return rows
        // A partial rescan replaces only what it looked at. A path that came back
        // with nothing is a note whose links are gone — or a note that is gone —
        // and either way its old row must not survive.
        const touched = new Set(paths)
        return [...prev.filter((r) => !touched.has(r.path)), ...rows]
      })
    } catch {
      // No vault open yet, or it went away mid-scan. The block shows nothing,
      // which is honest — the alternative is showing a stale set of backlinks.
    }
  }, [])

  /**
   * A note was renamed — point every `[[link]]` that meant it at its new name.
   *
   * Links resolve by TITLE, so renaming a note breaks every link to it while a
   * move between folders leaves them all working. That is why this only fires on
   * a real rename: rewriting on a move would edit the user's prose for no reason.
   *
   * The order matters and is the whole safety story:
   *   1. `flush()` first, so no note has unsaved text this could clobber.
   *   2. Only notes the index says actually link here — never a vault-wide
   *      text replace, and never a link that resolved somewhere else.
   *   3. An OPEN note is rewritten through `onDocChange`, so the normal autosave
   *      owns the write and the editor sees the change; a closed one is read and
   *      written directly. Writing disk under an open editor would be undone by
   *      that editor's next autosave.
   *   4. `rewriteLinks` returns null when nothing changed, so untouched notes
   *      are never rewritten.
   */
  const followRename = useCallback(
    async (from: string, to: string): Promise<void> => {
      if (titleOf(from) === titleOf(to)) return // a move: title-based links still resolve
      await flush()
      // The note list as it was BEFORE the rename. The tree has already been
      // reloaded by the time we get here, so the note is in it under its NEW
      // name — and `[[Waves]]` resolved against that list finds nothing, which
      // is exactly the link we are trying to follow. Putting the old name back
      // is what makes the resolution answer "this one".
      const notes = noteRefs(treeRef.current).map((n) =>
        n.path === to ? { path: from, title: titleOf(from), kind: 'note' as const } : n
      )
      const rows = linkRowsRef.current.filter((r) => r.path !== from)
      let changed = 0
      for (const row of rows) {
        if (!row.links.some((l) => l.target)) continue
        const openText = docsRef.current.get(row.path)
        let text: string
        try {
          text = openText ?? (await window.api.readNote(row.path))
        } catch {
          continue // gone since the scan — nothing to rewrite
        }
        const next = rewriteLinks(text, row.path, from, to, notes)
        if (next === null) continue
        changed++
        if (openText !== undefined) {
          // Through the normal typing path, so the editor re-seeds and the
          // autosave — not this function — does the writing.
          docsRef.current.set(row.path, next)
          setVersions((v) => ({ ...v, [row.path]: (v[row.path] ?? 0) + 1 }))
          onDocChange(row.path, next)
        } else {
          try {
            await window.api.writeNote(row.path, next)
          } catch (e) {
            flash(`Couldn't update links in ${titleOf(row.path)}: ${(e as Error).message}`)
          }
        }
      }
      if (changed) {
        flash(`Updated links in ${changed} ${changed === 1 ? 'note' : 'notes'}`)
        void rescanLinks()
      }
    },
    [flush, onDocChange, flash, rescanLinks]
  )

  // Anything that puts a note in a pane — a drop, a keyboard cycle, a restored
  // layout — goes through here for its content, so no path has to remember to
  // load it. Panes whose note is already loaded cost nothing.
  useEffect(() => {
    for (const p of layout.panes) if (!docsRef.current.has(p)) void loadDoc(p)
  }, [layout.panes, loadDoc])

  // Put back the tabs and the split the app was closed on. Checked against the
  // freshly loaded tree, so notes renamed or binned in the meantime are simply
  // dropped rather than reopened as dead paths (`restoreLayout`).
  const sessionReady = useRef(false)
  const restoreSession = useCallback(
    (t: TreeNode[], s: AppSettings): void => {
      if (s.startup === 'last') {
        // Only the notes that belong to the space being restored INTO. A saved
        // session can carry tabs from a space you left, and reopening them here
        // would put a note in the strip that the sidebar beside it doesn't show
        // — the same confusion switching spaces now avoids. A note loose at the
        // vault root belongs to no space and comes back in any of them.
        const home = s.activeSpaceFolder
        const mine = (p: string): boolean => {
          const owner = p.includes('/') ? p.slice(0, p.indexOf('/')) : ''
          return !owner || owner === home || !s.spaces.some((sp) => sp.folder === owner)
        }
        applyLayout(restoreLayout(s.session, (p) => mine(p) && !!findNode(t, p)))
      }
      // From here the layout is the user's, and worth saving. Until it is, an
      // empty layout must NOT be written back — that would wipe the session
      // that this very boot is in the middle of restoring.
      sessionReady.current = true
    },
    [applyLayout]
  )

  // initial load: open the saved vault, or fall through to the picker.
  useEffect(() => {
    void (async () => {
      const v = await window.api.getVault()
      setVault(v)
      setReady(true)
      let loadedTree: TreeNode[] = []
      if (v) {
        loadedTree = await loadTree()
        await loadWorkspace()
      }
      const s = await loadSettings(v)
      if (v) await syncSpaces(loadedTree, s)
      if (v) restoreSession(loadedTree, s)
      if (v) await loadPresets()
      if (v) await rescanLinks() // one walk of the vault; incremental after this
    })()
  }, [loadTree, loadWorkspace, loadSettings, restoreSession, syncSpaces, rescanLinks, loadPresets])

  // Remember the whole layout — which notes are open, how they're split, which
  // pane you were in — regardless of the current startup preference, so turning
  // "Reopen your tabs" on later picks up naturally instead of being stuck on
  // whatever was open when the toggle was flipped. Debounced, because clicking
  // between panes changes `focus` and that shouldn't be a file write each time.
  // Bypasses changeSettings: this shouldn't re-run applySettings on every click.
  useEffect(() => {
    if (!vault || !sessionReady.current) return
    const t = setTimeout(() => {
      void window.api.setSettings({
        session: { tabs: layout.tabs, panes: layout.panes, focus: layout.focus }
      })
    }, 400)
    return () => clearTimeout(t)
  }, [layout, vault])

  // A space's folder can be made, renamed or deleted outside the app, so the
  // saved spaces re-sync whenever the tree does — not only at startup.
  const settingsRef = useRef(settings)
  settingsRef.current = settings

  /** Show the space an import just wrote into.
   *
   *  An importer's writes all go through the vault's echo-guard (`markWrite`),
   *  so the watcher stays silent about them by design — which means a whole new
   *  space can appear on disk with nothing telling the sidebar it exists. The
   *  notes were there and invisible until a relaunch. Hence the explicit
   *  reload; and `syncSpaces` has to run BEFORE the switch, because the new
   *  folder only becomes a *space* once reconcile has recorded it, and
   *  switching to a folder that isn't one yet silently does nothing. */
  openSpaceRef.current = async (folder: string): Promise<void> => {
    try {
      const t = await loadTree()
      await syncSpaces(t, settingsRef.current)
      await switchSpace(folder)
    } catch (e) {
      flash(`Couldn't open "${folder}": ${(e as Error).message}`)
    }
  }

  // --- the saved-preset library (shared/presets.ts) ---------------------------
  // Two halves. The effect MIRRORS every space into the library — that is why
  // there is no "save preset" button and no way to end up with a stale one. The
  // actions below are the other direction: pouring a saved look back onto a
  // space, which is what makes the library worth keeping across a folder switch.
  //
  // It lives in App rather than in the settings window because the mirror has to
  // run whether or not that window is open.

  /** What was last mirrored. Without it every settings write would rewrite the
   *  whole library, and `session` alone is written on each click between panes —
   *  on a vault inside OneDrive that is real sync churn for no change at all. */
  const mirroredRef = useRef('')

  useEffect(() => {
    // Not `if (!vault)`: mid-switch, `vault` is already the new folder while
    // `settings` is still the old one's, and mirroring then would save the old
    // vault's spaces under the new vault's name. Wait for the two to agree.
    if (!vault || settingsVault.current !== vault) return
    const origin = vaultFolderName(vault)
    // An unbound space (`folder: ''`) stands for the whole vault and has no
    // name, so there is nothing to call its preset — it isn't mirrored.
    const drafts = settings.spaces.filter((s) => s.folder).map((s) => presetFromSpace(s, origin, 0))
    if (drafts.length === 0) return
    // `origin` is part of the key so switching vault always counts as a change,
    // even between two vaults whose spaces happen to look identical.
    // Stringified rather than concatenated with a separator: no character is
    // illegal in a folder name, and a raw control character as the delimiter is
    // what already makes this file read as binary to grep (CLAUDE.md).
    const key = JSON.stringify([origin, drafts.map((d) => [d.name, lookKey(d.look)])])
    if (key === mirroredRef.current) return
    const t = setTimeout(() => {
      mirroredRef.current = key
      const at = Date.now()
      void window.api
        .syncPresets(drafts.map((d) => ({ ...d, savedAt: at })))
        .then(setPresets)
        .catch(() => {
          mirroredRef.current = '' // let the next change try again
        })
    }, 800)
    return () => clearTimeout(t)
  }, [vault, settings.spaces])

  /** Make a space out of a saved look: a folder named after the preset, with
   *  that look already on it. The one thing the drag cannot express — there is
   *  no tab to drop onto when the space doesn't exist yet — and what rebuilds a
   *  setup in a folder that has never seen it. */
  const newSpaceFromPreset = async (preset: SpacePreset): Promise<void> => {
    if (settingsRef.current.spaces.filter((s) => s.folder).length >= SPACE_CAP) {
      flash(`You can have up to ${SPACE_CAP} spaces`)
      return
    }
    try {
      // Created with its final name, never created-then-renamed: `syncSpaces`
      // runs on every tree load and would register a temporary "New folder" as
      // a real space in between.
      const folder = await window.api.createFolder('', preset.name)
      await loadTree()
      const current = settingsRef.current
      const created = withNewSpace(current, folder)
      // ONE settings write. Registering the space and then patching its look
      // would paint the app twice — default theme for a frame, then the
      // preset's.
      const merged = { ...current, ...created }
      await changeSettings({ ...created, ...withSpacePatch(merged, folder, preset.look) })
      flash(
        folder === preset.name
          ? `Created "${folder}" from your saved look`
          : `Created "${folder}" from your saved look (name adjusted for cross-platform safety)`
      )
    } catch (e) {
      flash(`Couldn't create a space from "${preset.name}": ${(e as Error).message}`)
    }
  }

  /** `newSpaceFromPreset` is a plain const, rebuilt every render; the memo below
   *  must not depend on it or the actions would rebuild each time. Same ref
   *  idiom `onColorExistingFolders` uses, and for the same reason. */
  const newSpaceFromPresetRef = useRef(newSpaceFromPreset)
  newSpaceFromPresetRef.current = newSpaceFromPreset

  const presetActions: PresetActions = useMemo(
    () => ({
      // The folder and everything in it are untouched — only the ticked parts of
      // the look move. `withSpacePatch` re-pins `folder` last for exactly this
      // reason, and `pickLook` is what makes "leave my format buttons alone"
      // mean it.
      onApply: (preset, folder, parts) => {
        const patch = pickLook(preset.look, parts)
        const current = settingsRef.current
        if (folder === ALL_SPACES) {
          // Deliberately one write across every space rather than a loop of
          // them: each `setSettings` is a full read-modify-write of
          // settings.json, so a loop would rewrite the file once per space and
          // repaint the app in between.
          void changeSettings({ spaces: current.spaces.map((sp) => ({ ...sp, ...patch, folder: sp.folder })) })
          flash(`"${preset.name}" applied to every space`)
          return
        }
        void changeSettings(withSpacePatch(current, folder, patch))
        flash(`"${preset.name}" applied to ${folder}`)
      },
      onNewSpace: (preset) => void newSpaceFromPresetRef.current(preset),
      onDelete: (id) => {
        void window.api.deletePreset(id).then(setPresets)
      },
      onExport: (ids) => {
        void window.api
          .exportPresets(ids)
          .then((written) => {
            // null means the save dialog was cancelled, which needs no report.
            if (written) flash(`Saved to ${written.split(/[\\/]/).pop()}`)
          })
          .catch((e: Error) => flash(`Couldn't export: ${e.message}`))
      },
      onImport: (text) => {
        void window.api
          .importPresets(text)
          .then(({ added, found, cancelled, presets: list }) => {
            setPresets(list)
            if (cancelled) return // closed the picker; nothing to report
            // Three outcomes, three sentences. Saying "no presets in that file"
            // when the file was fine and the library was full sends you to look
            // at the wrong thing.
            flash(
              added > 0
                ? `Imported ${added} ${added === 1 ? 'preset' : 'presets'}`
                : found > 0
                  ? `Your preset library is full (${PRESET_CAP}) — delete some first`
                  : 'No presets in that file'
            )
          })
          .catch((e: Error) => flash(`Couldn't import: ${e.message}`))
      }
    }),
    [changeSettings, flash]
  )

  // external changes → refresh the tree, and every open tab that changed (not
  // just the focused one: a note edited on disk while it sits in the other half
  // of a split has to update there too)
  useEffect(() => {
    return window.api.onVaultChanged(async ({ paths }) => {
      contentCache.current.clear() // note contents may have changed on disk
      // Only what changed gets re-read for links — the watcher already tells us
      // exactly which notes those are, and it already debounces by 100ms.
      void rescanLinks(paths.filter((p) => p.toLowerCase().endsWith('.md')))
      const t = await loadTree()
      await syncSpaces(t, settingsRef.current)
      for (const p of layoutRef.current.tabs) {
        if (!paths.includes(p)) continue
        if (dirtyRef.current.has(p)) continue // don't clobber unsaved edits
        try {
          const text = await window.api.readNote(p)
          docsRef.current.set(p, text)
          setWordCounts((c) => ({ ...c, [p]: countWords(text) }))
          setVersions((v) => ({ ...v, [p]: (v[p] ?? 0) + 1 }))
        } catch {
          docsRef.current.delete(p) // gone from disk — close its tab
          applyLayout(closeTab(layoutRef.current, p))
        }
      }
    })
  }, [loadTree, syncSpaces, applyLayout, rescanLinks])

  const pick = async (): Promise<void> => {
    const v = await window.api.pickVault()
    if (v) {
      setVault(v)
      // A different vault means different files: drop every tab and its buffer.
      sessionReady.current = false
      applyLayout(EMPTY_LAYOUT)
      docsRef.current.clear()
      dirtyRef.current.clear()
      // A different vault's links are a different graph — keeping the old rows
      // would show backlinks from notes that aren't here.
      setLinkRows([])
      openTargetsRef.current.clear()
      spaceTabs.current.clear() // a different vault's spaces are different spaces
      // Image blobs are keyed by vault-RELATIVE path, so the same
      // "Import/photo.png" names a different file in a different vault — a kept
      // cache would show the previous vault's picture. Also frees the blobs.
      clearImageCache()
      const t = await loadTree()
      await loadWorkspace()
      const s = await loadSettings(v) // a vault may carry its own saved appearance
      // The watcher only reports CHANGES from here on (ignoreInitial: true), so
      // a vault's pre-existing top-level folders never self-announce as spaces
      // otherwise — nothing would reconcile them until some later fs event.
      await syncSpaces(t, s)
      // Each vault remembers its own tabs, so switching to one reopens what you
      // were doing there — the same restore as a cold start.
      restoreSession(t, s)
      // Nothing about the library changes on a switch — it is in the app, not in
      // either folder. This re-read only exists so a preset written while
      // another vault was open shows up in the list straight away.
      await loadPresets()
    }
  }

  const run = async (fn: () => Promise<void>): Promise<void> => {
    try {
      await fn()
    } catch (e) {
      window.alert((e as Error).message ?? String(e))
    }
  }

  // --- organise actions ------------------------------------------------------

  /** Move entries into `toDir`, optionally positioned around `anchor`. The files
   *  really move (renameEntry); the sibling order is then recorded in the
   *  sidecar, since the filesystem alone is only alphabetical. */
  const move = (paths: string[], toDir: string, anchor: string | null, after: boolean): void =>
    void run(async () => {
      const landed: string[] = []
      for (const from of paths) {
        if (toDir === from || toDir.startsWith(from + '/')) continue // into self/descendant
        const dest = joinPath(toDir, nameOf(from))
        if (dest === from) {
          landed.push(from) // already in this folder — a pure reorder
          continue
        }
        const actual = await window.api.renameEntry(from, dest)
        remapOpen(from, actual)
        landed.push(actual)
      }
      const fresh = await window.api.listTree()
      setTree(fresh)

      // Re-sequence the destination folder: take its children in display order,
      // pull out the ones that moved, and splice them back at the anchor.
      const siblings =
        toDir === '' ? fresh : (findNode(fresh, toDir)?.children ?? [])
      const ws = await window.api.getWorkspace()
      const ordered = sortSiblings(siblings, ws, false).map((n) => n.path)
      const moved = new Set(landed)
      const rest = ordered.filter((p) => !moved.has(p))
      let at = rest.length
      if (anchor) {
        const i = rest.indexOf(anchor)
        if (i >= 0) at = after ? i + 1 : i
      }
      const next = [...rest.slice(0, at), ...landed.filter((p) => ordered.includes(p)), ...rest.slice(at)]
      setWorkspace(await window.api.reorderEntries(next))
    })

  const togglePin = (paths: string[], pinned: boolean): void =>
    void run(async () => setWorkspace(await window.api.updateEntries(paths, { pinned })))

  const setArchived = (paths: string[], archived: boolean): void =>
    void run(async () =>
      setWorkspace(
        await window.api.updateEntries(paths, {
          archived,
          archivedAt: archived ? Date.now() : undefined
        })
      )
    )

  const trash = (paths: string[]): void =>
    void run(async () => {
      if (!paths.length) return
      setWorkspace(await window.api.trashEntries(paths))
      await loadTree()
      forgetIfInside(paths)
    })

  const restoreFromBin = (ids: string[]): void =>
    void run(async () => {
      setWorkspace(await window.api.restoreEntries(ids))
      await loadTree()
    })

  const purge = (ids?: string[]): void =>
    void run(async () => setWorkspace(await window.api.purgeEntries(ids)))

  // No naming prompt — a click should just create the thing. A collision
  // (another "Untitled") is resolved by main with a " (2)", " (3)"... suffix,
  // same convention restoreEntry already uses. Rename afterwards if wanted.
  // "" means "the top of what I'm looking at", which is the active space's
  // folder — not the vault root. Making a note in the Revision space must not
  // drop it beside the spaces; that's the whole point of the hierarchy.
  const inSpace = (dir: string): string => (dir === '' ? space.folder : dir)

  const newNote = (dir: string): Promise<void> =>
    run(async () => {
      const rel = await window.api.createNote(inSpace(dir))
      await loadTree()
      await openNote(rel)
    })

  const newFolder = (dir: string): Promise<void> =>
    run(async () => {
      const rel = await window.api.createFolder(inSpace(dir))
      await loadTree()
      // Auto-colour, if the space asks for it: a new folder comes out a colour
      // its siblings aren't already using, so a sidebar of folders reads as
      // distinct without anyone assigning anything. Notes are deliberately left
      // alone — they inherit this folder's colour, and colouring each one
      // individually would make the sidebar louder rather than clearer.
      if (!space.colorAuto) return
      // Read the sidecar back rather than closing over `workspace`: the state in
      // this closure is from the render that made the button, and what matters
      // is which colours the siblings hold NOW.
      const ws = await window.api.getWorkspace()
      const hex = pickAutoColor(space.colorPalette, siblingColors(ws, parentOf(rel)))
      if (hex) setWorkspace(await window.api.updateEntry(rel, { color: hex }))
    })

  /** Write (or clear) the colour on some rows. `null` removes it — the merge in
   *  main drops an undefined field, the same way un-archiving clears
   *  `archivedAt`, so there is no separate "delete" channel to keep in step. */
  const setColor = (paths: string[], hex: string | null): void =>
    void run(async () =>
      setWorkspace(await window.api.updateEntries(paths, { color: hex ?? undefined }))
    )

  const pickColor = (paths: string[], at: Anchor): void => {
    if (paths.length) setColorFor({ paths, at })
  }

  /** Colour the folders that already exist in `spaceFolders`, from each space's
   *  own palette. Called when auto-colour is switched on — see
   *  `SpaceActions.onColorExistingFolders`. Groups the writes by colour so a
   *  vault of 200 folders is a handful of round trips, not 200. */
  const colorExistingFolders = (spaceFolders: string[]): void =>
    void run(async () => {
      const fresh = await window.api.listTree()
      let ws = await window.api.getWorkspace()
      for (const folder of spaceFolders) {
        const sp = settings.spaces.find((s) => s.folder === folder)
        if (!sp?.colorPalette.length) continue
        // '' is the whole-vault space, whose folders are the tree's own roots.
        const roots = folder === '' ? fresh : (findNode(fresh, folder)?.children ?? [])
        const plan = autoColorPlan(roots, ws, sp.colorPalette, folder)
        const byColor = new Map<string, string[]>()
        for (const [path, hex] of Object.entries(plan)) {
          const list = byColor.get(hex)
          if (list) list.push(path)
          else byColor.set(hex, [path])
        }
        for (const [hex, paths] of byColor) {
          ws = await window.api.updateEntries(paths, { color: hex })
        }
      }
      setWorkspace(ws)
    })
  colorExistingRef.current = colorExistingFolders

  const rename = (node: TreeNode): Promise<void> =>
    run(async () => {
      const next = await ask('Rename', nameOf(node.path))
      if (next == null || !next.trim() || next.trim() === nameOf(node.path)) return
      const to = joinPath(parentOf(node.path), next.trim())
      const actualRel = await window.api.renameEntry(node.path, to)
      await loadTree()
      await loadWorkspace()
      remapOpen(node.path, actualRel)
      // Folders are skipped: a folder has no title for a link to name, and its
      // notes keep theirs, so every link through it still resolves.
      if (node.type === 'file') await followRename(node.path, actualRel)
      const actualName = nameOf(actualRel)
      if (stripMd(actualName) !== stripMd(next.trim()))
        flash(`Renamed to "${actualName}" (adjusted for cross-platform safety)`)
    })

  const openMenu = (e: React.MouseEvent, node: TreeNode | null): void => {
    e.preventDefault()
    e.stopPropagation()
    const dir = node == null ? '' : node.type === 'dir' ? node.path : parentOf(node.path)
    const items: MenuItem[] = [
      { label: 'New note', onClick: () => void newNote(dir) },
      { label: 'New folder', onClick: () => void newFolder(dir) }
    ]
    if (node) {
      items.push({ label: 'Rename', onClick: () => void rename(node) })
      // The row's hover swatch opens the same picker. Both, deliberately and to
      // the same pattern "Move to bin" already follows: the hover button is the
      // fast path once you know it's there, the menu is where you look when you
      // don't. The menu has no anchor element to measure, so it points at the
      // click — which is where you are looking anyway.
      items.push({
        label: 'Colour…',
        onClick: () =>
          pickColor([node.path], { left: e.clientX, top: e.clientY, bottom: e.clientY })
      })
      items.push({ label: 'Move to bin', danger: true, onClick: () => trash([node.path]) })
    }
    setMenu({ x: e.clientX, y: e.clientY, items })
  }

  // Set to jump Settings straight to a section (currently just File > Import
  // notes…), bypassing the gear. Sidebar/SettingsButton clear it once opened.
  const [settingsJumpTo, setSettingsJumpTo] = useState<SectionId | null>(null)

  // Route application-menu commands (New Note / New Folder) to the current
  // handlers via a ref, so the subscription mounts once but never goes stale.
  const menuHandler = useRef<(cmd: string) => void>(() => {})
  menuHandler.current = (cmd: string): void => {
    if (!vault) return
    if (cmd === 'new-note') void newNote('')
    else if (cmd === 'new-folder') void newFolder('')
    else if (cmd === 'import-notes') setSettingsJumpTo('import')
  }
  useEffect(() => window.api.onMenuCommand((cmd) => menuHandler.current(cmd)), [])

  // --- tab keyboard ----------------------------------------------------------
  // Ctrl+Tab cycles on BOTH platforms — Cmd+Tab is the macOS app switcher and
  // never reaches us. Cmd/Ctrl+W closes a tab, which is only free because
  // main/menu.ts moves "Close Window" to Shift+Cmd+W (VS Code's arrangement);
  // without that the macOS Window menu would eat the key and shut the window.
  // Capture phase, so a keystroke is decided here before CodeMirror sees it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const mod = e.metaKey || e.ctrlKey
      if (e.key === 'Tab' && e.ctrlKey) {
        e.preventDefault()
        applyLayout(cycle(layoutRef.current, e.shiftKey ? -1 : 1))
        return
      }
      if (!mod || e.repeat) return
      if (e.altKey && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
        e.preventDefault()
        applyLayout(cycle(layoutRef.current, e.key === 'ArrowRight' ? 1 : -1))
      } else if (e.key === 'w' || e.key === 'W') {
        const p = activePath(layoutRef.current)
        if (p == null) return // '' is a blank tab, and closing that is the point
        e.preventDefault()
        closeNote(p)
      } else if (e.key === '\\') {
        e.preventDefault()
        applyLayout(splitBlank(layoutRef.current))
      } else if (!e.altKey && /^[1-9]$/.test(e.key)) {
        e.preventDefault()
        applyLayout(selectTab(layoutRef.current, Number(e.key) - 1))
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [closeNote, applyLayout])

  // Update state: seed once, then follow the pushes from main.
  useEffect(() => {
    void window.api.getUpdateState().then((s) => setUpdate(s.status))
    return window.api.onUpdateStatus(setUpdate)
  }, [])

  // flush unsaved edits when the window loses focus and just before the app quits
  useEffect(() => {
    const onBlur = (): void => void flush()
    window.addEventListener('blur', onBlur)
    return () => window.removeEventListener('blur', onBlur)
  }, [flush])
  useEffect(() => {
    return window.api.onBeforeQuit(() => {
      void flush().finally(() => window.api.notifyFlushed())
    })
  }, [flush])

  // --- search ---------------------------------------------------------------
  // Every note the search can currently reach, flattened and tagged with
  // whether it's archived and which space owns it. By default that's what the
  // sidebar covers — the active space, plus the loose notes shown alongside it
  // — since the sidebar can't show or highlight a result from elsewhere. The
  // `allSpaces` toggle widens the walk to the whole vault; `spaceOf` (used
  // elsewhere for link-following) says which space each hit lands back in.
  const allNotes = useMemo<SearchHit[]>(() => {
    const out: SearchHit[] = []
    const walk = (nodes: TreeNode[]): void => {
      for (const n of nodes) {
        if (n.type === 'file') {
          out.push({
            path: n.path,
            title: stripMd(nameOf(n.path)),
            archived: isArchived(workspace, n.path),
            spaceFolder: spaceOf(n.path)
          })
        } else if (n.children) walk(n.children)
      }
    }
    if (allSpaces) {
      walk(tree)
    } else {
      walk(spaceTree)
      walk(looseNotes)
    }
    return out
  }, [allSpaces, tree, spaceTree, looseNotes, workspace])

  // Deep search reads every note's contents once (lazily, cached), then bumps a
  // version so the hit list recomputes. Titles are always searched instantly.
  useEffect(() => {
    if (!deep || !query.trim()) return
    let cancelled = false
    void (async () => {
      const missing = allNotes.filter((n) => !contentCache.current.has(n.path))
      if (missing.length === 0) return
      await Promise.all(
        missing.map(async (n) => {
          try {
            contentCache.current.set(n.path, await window.api.readNote(n.path))
          } catch {
            /* unreadable note — skip it */
          }
        })
      )
      if (!cancelled) setCacheVersion((v) => v + 1)
    })()
    return () => {
      cancelled = true
    }
  }, [deep, query, allNotes])

  const searchHits = useMemo<SearchHit[] | null>(() => {
    const q = query.trim().toLowerCase()
    if (!q) return null
    void cacheVersion // recompute when the content cache fills
    const hits: SearchHit[] = []
    for (const n of allNotes) {
      if (n.archived && !withArchived) continue
      if (n.title.toLowerCase().includes(q)) {
        hits.push(n)
        continue
      }
      if (deep) {
        const c = contentCache.current.get(n.path)
        const idx = c ? c.toLowerCase().indexOf(q) : -1
        if (idx === -1) continue
        const from = Math.max(0, idx - 24)
        const snippet =
          (from > 0 ? '…' : '') +
          c!
            .slice(from, idx + q.length + 44)
            .replace(/\s+/g, ' ')
            .trim() +
          '…'
        hits.push({ ...n, snippet })
      }
    }
    // No open note means no "where you're working" to be close to — leave the
    // default (tree) order alone. Otherwise a stable sort nudges hits that
    // share a folder with the open note ahead of ones that don't, without
    // hiding anything the plain substring match already found.
    if (openPath) {
      const home = parentOf(openPath)
      hits.sort((a, b) => folderDistance(parentOf(a.path), home) - folderDistance(parentOf(b.path), home))
    }
    // Tag hits that live outside the active space — only meaningful once
    // search has actually widened past it. Builds fresh objects rather than
    // mutating `n` in place, since title-match hits above are `allNotes`
    // entries by reference and those are cached across renders.
    if (!allSpaces) return hits
    return hits.map((h) => {
      if (h.spaceFolder === space.folder) return h
      const sp = settings.spaces.find((s) => s.folder === h.spaceFolder)
      const tag = h.spaceFolder ? (sp?.emoji ? `${sp.emoji} ${h.spaceFolder}` : h.spaceFolder) : 'Loose notes'
      return { ...h, spaceTag: tag }
    })
  }, [query, deep, withArchived, allNotes, cacheVersion, openPath, allSpaces, space.folder, settings.spaces])

  // Shown in the results header so the reordering isn't invisible — only when
  // it actually did something (an open note outside the space root).
  const searchContextLabel = openPath ? nameOf(parentOf(openPath)) || null : null

  // The new column arrives empty and asks what goes in it, so the only thing
  // that can stop it is the cap — no second note required.
  const canSplit = layout.panes.length < MAX_PANES

  const openSearchResult = (h: SearchHit, newTab = false): void => {
    void (async () => {
      // An all-spaces hit from elsewhere: land in its space first (same
      // ordering as following a cross-space `[[link]]`, see `openLink`) so the
      // note opens into a layout the sidebar is actually showing.
      const owner = h.spaceFolder
      if (owner && owner !== space.folder && settings.spaces.some((s) => s.folder === owner)) {
        await switchSpace(owner)
      }
      await openNote(h.path, newTab)
    })()
    setQuery('')
  }

  // A pane's editable title header renames the file, reusing the same
  // sanitise/flash path as every other rename. Resolves to the name the file
  // actually got, so the pane can show that rather than what was typed.
  const renameOpen = async (path: string, title: string): Promise<string | null> => {
    try {
      const fname = title.toLowerCase().endsWith('.md') ? title : `${title}.md`
      const actualRel = await window.api.renameEntry(path, joinPath(parentOf(path), fname))
      await loadTree()
      await loadWorkspace()
      remapOpen(path, actualRel)
      await followRename(path, actualRel)
      const actualName = stripMd(nameOf(actualRel))
      if (actualName !== title)
        flash(`Renamed to "${actualName}" (adjusted for cross-platform safety)`)
      return actualName
    } catch (e) {
      flash((e as Error).message)
      return null
    }
  }

  if (!ready) return <div className="center muted">Loading…</div>

  if (!vault) {
    return (
      <div className="center picker">
        <h1>Notes</h1>
        <p className="muted">Choose a folder to use as your vault. Your notes stay as plain .md files inside it.</p>
        <button className="primary" onClick={() => void pick()}>
          Choose folder…
        </button>
      </div>
    )
  }

  return (
    <div className="flex h-full w-full">
      <Sidebar
        vaultName={baseName(vault)}
        vaultPath={vault}
        tree={spaceTree}
        looseNotes={looseNotes}
        spaces={settings.spaces}
        activeSpaceFolder={space.folder}
        onSwitchSpace={(folder) => void switchSpace(folder)}
        spaceActions={spaceActions}
        workspace={workspace}
        openPath={openPath}
        settings={settings}
        onChangeSettings={(p) => void changeSettings(p)}
        presets={presets}
        presetActions={presetActions}
        settingsJumpToSection={settingsJumpTo}
        onSettingsJumpHandled={() => setSettingsJumpTo(null)}
        query={query}
        onQuery={setQuery}
        deep={deep}
        onToggleDeep={() => setDeep((d) => !d)}
        withArchived={withArchived}
        onToggleWithArchived={() => setWithArchived((a) => !a)}
        allSpaces={allSpaces}
        onToggleAllSpaces={() => setAllSpaces((a) => !a)}
        searchHits={searchHits}
        searchContextLabel={searchContextLabel}
        onOpenSearchHit={openSearchResult}
        revealRef={revealRef}
        update={update}
        actions={{
          onOpen: (p, newTab) => void openNote(p, newTab),
          onContext: openMenu,
          onMove: move,
          onTogglePin: togglePin,
          onTrash: trash,
          onRestore: (paths) => setArchived(paths, false),
          onNewNoteIn: (dir) => void newNote(dir),
          onNewFolderIn: (dir) => void newFolder(dir),
          onRename: (node) => void rename(node),
          onPickColor: pickColor,
          onNewNote: () => void newNote(''),
          onNewFolder: () => void newFolder(''),
          onArchive: setArchived,
          onRestoreFromBin: restoreFromBin,
          onPurge: purge,
          onPickVault: () => void pick()
        }}
      />

      <main className="flex min-w-0 flex-1 flex-col">
        {/* The strip and the command row are ALWAYS on screen, empty or not.
            They're the app's fixed chrome: rows that appear when you open a
            second note would shove the text down mid-work, and the whole reason
            to reserve the space is that filling it moves nothing. */}
        <TabStrip
          tabs={layout.tabs}
          panes={layout.panes}
          active={openPath}
          onSelect={(p) => void openNote(p)}
          onClose={closeNote}
          onReorder={(p, before) => applyLayout(moveTab(layoutRef.current, p, before))}
          onDragTab={(path) => setDrag(path === null ? null : { kind: 'tab', path })}
          onNewTab={() => applyLayout(openTab(layoutRef.current, BLANK))}
          dragging={drag}
        />
        {/* Between the tabs and the format bar, on a line of its own. The tabs
            are which notes are open; this is where THE one you're in lives;
            the format bar below is what you can do to it — three different
            questions, and running them together (the path reading as part of
            the note's own links) is what made this confusing before.
            It appears and disappears with the SETTING, never with what's open:
            a bar that came and went per note would move the text under you. */}
        {space.showPath && (
          <PathBar
            path={openPath ?? ''}
            spaces={linkEnvBase.spaces}
            onReveal={(folder) => void reveal(folder)}
          />
        )}
        {layout.panes.length > 0 ? (
          <>
            <div className="flex min-h-0 flex-1">
              {layout.panes.map((p, i) => (
                <NotePane
                  // Keyed by position, not path: switching the note in a pane
                  // must NOT remount CodeMirror (it swaps the document in place,
                  // which is what keeps the cursor and undo history).
                  key={i}
                  path={p}
                  doc={docsRef.current.get(p) ?? ''}
                  version={versions[p] ?? 0}
                  wordCount={wordCounts[p] ?? 0}
                  numberFormat={settings.numberFormat}
                  createdAt={fileTimes[p]?.createdAt}
                  updatedAt={fileTimes[p]?.updatedAt}
                  showNoteInfo={space.showNoteInfo}
                  dateFormat={settings.dateFormat}
                  timezone={settings.timezone}
                  // A link resolves relative to the note it is written in, so
                  // each column gets the same vault with its own `path`.
                  env={{ ...linkEnvBase, path: p }}
                  linkHandlers={linkHandlers}
                  linkIndex={linkIndex}
                  showLinks={space.showLinks}
                  pinLinks={space.pinLinks}
                  markdownPro={space.markdownPro}
                  // Which notes are RAW is a property of each note, so it sits
                  // in workspace.json beside its pin and its colour — not in the
                  // space, and not in React state that a reopen would forget.
                  raw={!!workspace.entries[p]?.rawView}
                  // Through `run` like every other updateEntry* call (pin,
                  // colour): a bare .then() drops a rejection on the floor, so
                  // a failed write left the button toggled in the UI with the
                  // flag never persisted and nothing said.
                  onToggleRaw={() =>
                    void run(async () =>
                      setWorkspace(
                        await window.api.updateEntry(p, { rawView: !workspace.entries[p]?.rawView })
                      )
                    )
                  }
                  onFollowLink={(target, how, heading) => void openLink(target, how, heading)}
                  onCreateLink={(dir, title, how) => void createFromLink(dir, title, how)}
                  onDragLink={(target) => setDrag(target ? { kind: 'tab', path: target } : null)}
                  onInspect={setInspect}
                  revealHeading={pendingHeading?.path === p ? pendingHeading.heading : null}
                  focused={i === layout.focus}
                  split={layout.panes.length > 1}
                  slots={space.toolbarSlots}
                  onSetSlot={(slot, id) => {
                    const next = [...space.toolbarSlots]
                    next[slot] = id
                    void changeSettings(withSpacePatch(settings, space.folder, { toolbarSlots: next }))
                  }}
                  onFocus={() => applyLayout(layout.focus === i ? layout : { ...layout, focus: i })}
                  onDocChange={(text) => onDocChange(p, text)}
                  onRename={(title) => renameOpen(p, title)}
                  // Beside THIS column, not "the focused one": the button is in
                  // the row it belongs to, so it must not depend on the click
                  // having moved focus there first.
                  onSplit={() => applyLayout(splitBlank({ ...layoutRef.current, focus: i }))}
                  canSplit={canSplit}
                  onClosePane={() => applyLayout(closePane(layoutRef.current, i))}
                  dragging={drag}
                  onDragPane={() => setDrag({ kind: 'pane', path: p, from: i })}
                  onDragEnd={() => setDrag(null)}
                  edgeDrops={
                    // A column being dragged is only ever rearranged, so the cap
                    // doesn't apply to it; a tab may need a new column, which is
                    // where it does.
                    drag?.kind === 'pane' || canSplit || layout.panes.includes(drag?.path ?? '')
                  }
                  onDropTab={(zone) => {
                    const d = drag
                    setDrag(null)
                    if (!d) return
                    const l = layoutRef.current
                    if (d.kind === 'pane') {
                      // Rearranging the split: nothing opens or closes. Onto the
                      // middle of another column the two swap; onto an edge the
                      // dragged column moves there.
                      const from = d.from ?? l.panes.indexOf(d.path)
                      applyLayout(
                        zone === 'center'
                          ? swapPanes(l, from, i)
                          : movePane(l, from, zone === 'left' ? i : i + 1)
                      )
                      return
                    }
                    applyLayout(
                      zone === 'center'
                        ? showInPane(l, d.path, i)
                        : splitAt(l, d.path, zone === 'left' ? i : i + 1)
                    )
                  }}
                />
              ))}
            </div>
          </>
        ) : (
          <>
            {/* The command row with nothing to command: same shell, same height,
                so opening a note fills it instead of pushing the page down. */}
            <div className={ROW_CLASS + ' pointer-events-none opacity-40'} aria-hidden="true">
              <span className="min-w-0 flex-1" />
              <FormatToolbar viewRef={NO_VIEW} slots={space.toolbarSlots} onSetSlot={() => {}} />
              <span className="min-w-0 flex-1" />
            </div>
            <div className="flex flex-1 items-center justify-center">
              <div className="text-center">
                <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-surface/70 text-brand-300 shadow-card">
                  <Icon name="doc" className="h-8 w-8" />
                </div>
                <p className="font-display text-xl text-ink-700">Pick a note, or start a new one</p>
                <p className="mt-1 text-sm text-ink-500">Your Markdown formats as you type.</p>
              </div>
            </div>
          </>
        )}
      </main>

      {/* Every `data-tip` in the app, in one place. Replaces the HTML `title`
          attribute, which went stale when a control was toggled while hovered,
          didn't always appear at all, and can't be styled. */}
      <Tooltip />

      {/* One card for every link in the window. It portals itself to
          document.body — the links strip has a transform and a backdrop blur,
          and either would make it the containing block for a fixed-position
          child, which is what put this card hundreds of pixels from the link it
          described. */}
      {inspect && <LinkInspector at={inspect} />}

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}

      {/* The one colour picker, for whichever rows the sidebar asked about. It
          stays open while you drag in the square, so the sidebar recolours live
          under it — you are choosing against the real thing, not a preview. */}
      {colorFor && (
        <ColorPopover
          at={colorFor.at}
          value={workspace.entries[colorFor.paths[0]]?.color ?? ''}
          palette={space.colorPalette}
          inherited={((): { hex: string; from: string } | null => {
            const c = colorOf(workspace, colorFor.paths[0], space.colorInherit)
            return c && !c.own ? { hex: c.hex, from: c.from } : null
          })()}
          onPick={(hex) => setColor(colorFor.paths, hex)}
          onClear={() => {
            setColor(colorFor.paths, null)
            setColorFor(null)
          }}
          onSaveToPalette={(hex) =>
            void changeSettings(
              withSpacePatch(settings, space.folder, {
                // Oldest out when it's full, so "save" always saves rather than
                // silently doing nothing once you hit the cap.
                colorPalette: [...space.colorPalette, hex].slice(-PALETTE_MAX)
              })
            )
          }
          onClose={() => setColorFor(null)}
        />
      )}

      {notice && <div className="notice">{notice}</div>}

      {prompt && (
        <div className="menu-backdrop" onClick={() => closePrompt(null)}>
          <div className="prompt" onClick={(e) => e.stopPropagation()}>
            <div className="prompt-title">{prompt.title}</div>
            {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
            <input
              autoFocus
              value={prompt.value}
              onChange={(e) => setPrompt({ ...prompt, value: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') closePrompt(prompt.value)
                if (e.key === 'Escape') closePrompt(null)
              }}
            />
            <div className="prompt-actions">
              <button onClick={() => closePrompt(null)}>Cancel</button>
              <button className="primary" onClick={() => closePrompt(prompt.value)}>
                OK
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
