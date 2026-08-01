import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { TreeNode } from '../../shared/types'
import type { Workspace } from '../../shared/workspace'
import type { EditorView } from '@codemirror/view'
import { ContextMenu, type MenuItem } from './ContextMenu'
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
import {
  activeSpace,
  DEFAULT_SETTINGS,
  reconcileSpaces,
  withNewSpace,
  withSpacePatch,
  type AppSettings
} from '../../shared/settings'
import type { SpaceActions } from './settings/Spaces'
import { Sidebar } from './Sidebar'
import type { SearchHit } from './Search'
import type { UpdateStatus } from '../../shared/update'
import { Icon } from './icons'
import { findNode, isArchived, sortSiblings } from './organise/model'

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
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS)
  // Appearance, arranging and the format bar's custom buttons belong to the
  // active space; the rest of `settings` is global. Derived rather than stored,
  // so the two can never disagree — a find over at most SPACE_CAP items.
  const space = activeSpace(settings)
  // Search (spotlight pill). `deep` also matches note contents, not just titles;
  // `withArchived` lets shelved notes back into the results.
  const [query, setQuery] = useState('')
  const [deep, setDeep] = useState(false)
  const [withArchived, setWithArchived] = useState(false)
  const [cacheVersion, setCacheVersion] = useState(0)
  const contentCache = useRef<Map<string, string>>(new Map())
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
  const loadSettings = useCallback(async (): Promise<AppSettings> => {
    const s = await window.api.getSettings()
    setSettings(s)
    applySettings(s)
    return s
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

  const spaceActions: SpaceActions = useMemo(
    () => ({
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
      }
    }),
    [loadTree, loadWorkspace, flash, remapOpen, forgetIfInside]
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
        applyLayout(restoreLayout(s.session, (p) => !!findNode(t, p)))
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
      const s = await loadSettings()
      if (v) await syncSpaces(loadedTree, s)
      if (v) restoreSession(loadedTree, s)
    })()
  }, [loadTree, loadWorkspace, loadSettings, restoreSession, syncSpaces])

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

  // external changes → refresh the tree, and every open tab that changed (not
  // just the focused one: a note edited on disk while it sits in the other half
  // of a split has to update there too)
  useEffect(() => {
    return window.api.onVaultChanged(async ({ paths }) => {
      contentCache.current.clear() // note contents may have changed on disk
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
  }, [loadTree, syncSpaces, applyLayout])

  const pick = async (): Promise<void> => {
    const v = await window.api.pickVault()
    if (v) {
      setVault(v)
      // A different vault means different files: drop every tab and its buffer.
      sessionReady.current = false
      applyLayout(EMPTY_LAYOUT)
      docsRef.current.clear()
      dirtyRef.current.clear()
      const t = await loadTree()
      await loadWorkspace()
      const s = await loadSettings() // a vault may carry its own saved appearance
      // The watcher only reports CHANGES from here on (ignoreInitial: true), so
      // a vault's pre-existing top-level folders never self-announce as spaces
      // otherwise — nothing would reconcile them until some later fs event.
      await syncSpaces(t, s)
      // Each vault remembers its own tabs, so switching to one reopens what you
      // were doing there — the same restore as a cold start.
      restoreSession(t, s)
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
      await window.api.createFolder(inSpace(dir))
      await loadTree()
    })

  const rename = (node: TreeNode): Promise<void> =>
    run(async () => {
      const next = await ask('Rename', nameOf(node.path))
      if (next == null || !next.trim() || next.trim() === nameOf(node.path)) return
      const to = joinPath(parentOf(node.path), next.trim())
      const actualRel = await window.api.renameEntry(node.path, to)
      await loadTree()
      await loadWorkspace()
      remapOpen(node.path, actualRel)
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
      items.push({ label: 'Move to bin', danger: true, onClick: () => trash([node.path]) })
    }
    setMenu({ x: e.clientX, y: e.clientY, items })
  }

  // Route application-menu commands (New Note / New Folder) to the current
  // handlers via a ref, so the subscription mounts once but never goes stale.
  const menuHandler = useRef<(cmd: string) => void>(() => {})
  menuHandler.current = (cmd: string): void => {
    if (!vault) return
    if (cmd === 'new-note') void newNote('')
    else if (cmd === 'new-folder') void newFolder('')
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
  // Every note in the vault, flattened and tagged with whether it's archived.
  // Search covers what the sidebar covers: the active space, plus the loose
  // notes shown alongside it. Searching the whole vault would hand back results
  // the sidebar can't show and can't highlight — you'd open a note that appears
  // to be in no folder at all.
  const allNotes = useMemo<SearchHit[]>(() => {
    const out: SearchHit[] = []
    const walk = (nodes: TreeNode[]): void => {
      for (const n of nodes) {
        if (n.type === 'file') {
          out.push({
            path: n.path,
            title: stripMd(nameOf(n.path)),
            archived: isArchived(workspace, n.path)
          })
        } else if (n.children) walk(n.children)
      }
    }
    walk(spaceTree)
    walk(looseNotes)
    return out
  }, [spaceTree, looseNotes, workspace])

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
    return hits
  }, [query, deep, withArchived, allNotes, cacheVersion])

  // The new column arrives empty and asks what goes in it, so the only thing
  // that can stop it is the cap — no second note required.
  const canSplit = layout.panes.length < MAX_PANES

  const openSearchResult = (h: SearchHit, newTab = false): void => {
    void openNote(h.path, newTab)
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
        tree={spaceTree}
        looseNotes={looseNotes}
        spaces={settings.spaces}
        activeSpaceFolder={space.folder}
        onSwitchSpace={(folder) => void changeSettings({ activeSpaceFolder: folder })}
        spaceActions={spaceActions}
        workspace={workspace}
        openPath={openPath}
        settings={settings}
        onChangeSettings={(p) => void changeSettings(p)}
        query={query}
        onQuery={setQuery}
        deep={deep}
        onToggleDeep={() => setDeep((d) => !d)}
        withArchived={withArchived}
        onToggleWithArchived={() => setWithArchived((a) => !a)}
        searchHits={searchHits}
        onOpenSearchHit={openSearchResult}
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

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}

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
