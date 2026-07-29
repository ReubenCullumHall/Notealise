import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { EditorView } from '@codemirror/view'
import type { TreeNode } from '../../shared/types'
import type { Workspace } from '../../shared/workspace'
import { ContextMenu, type MenuItem } from './ContextMenu'
import { CodeEditor } from './editor'
import { FormatToolbar } from './editor/FormatToolbar'
import { ReadingView } from './reader/ReadingView'
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
import { formatNumber } from './intl'
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

export default function App(): React.JSX.Element {
  const [ready, setReady] = useState(false)
  const [vault, setVault] = useState<string | null>(null)
  const [tree, setTree] = useState<TreeNode[]>([])
  const [workspace, setWorkspace] = useState<Workspace>(EMPTY_WS)
  const [openPath, setOpenPath] = useState<string | null>(null)
  const [content, setContent] = useState('')
  const [wordCount, setWordCount] = useState(0)
  const [titleDraft, setTitleDraft] = useState('')
  // Reading view (Edit/Read toggle). `readSource` snapshots the live buffer when
  // entering Read, so unsaved edits show; the editor stays mounted (hidden) so
  // toggling back never loses the cursor or unsaved text.
  const [reading, setReading] = useState(false)
  const [readSource, setReadSource] = useState('')
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
  // `docVersion` bumps only on intentional loads (open / external reload); typing
  // never bumps it, so the editor is never re-seeded out from under the cursor.
  const [docVersion, setDocVersion] = useState(0)
  const openPathRef = useRef<string | null>(null)
  openPathRef.current = openPath
  const dirtyRef = useRef<{ path: string; text: string } | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const editorViewRef = useRef<EditorView | null>(null)

  const flush = useCallback(async (): Promise<void> => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current)
      saveTimer.current = null
    }
    const d = dirtyRef.current
    if (!d) return
    dirtyRef.current = null
    try {
      await window.api.writeNote(d.path, d.text)
    } catch (e) {
      dirtyRef.current = d // keep the buffer for a later retry
      flash(`Save failed: ${(e as Error).message}`)
    }
  }, [flash])

  const onDocChange = useCallback(
    (text: string): void => {
      const p = openPathRef.current
      if (!p) return
      dirtyRef.current = { path: p, text }
      setWordCount(countWords(text))
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(() => void flush(), 400)
    },
    [flush]
  )

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
    [loadTree, loadWorkspace, flash]
  )

  const openNote = useCallback(
    async (p: string): Promise<void> => {
      await flush() // save the note we're leaving before we load the next
      setOpenPath(p)
      try {
        const text = await window.api.readNote(p)
        setContent(text)
        setWordCount(countWords(text))
        setReadSource(text) // keep the reading view current when switching notes
      } catch {
        setContent('')
        setWordCount(0)
        setReadSource('')
      }
      setDocVersion((v) => v + 1)
    },
    [flush]
  )

  // initial load: open the saved vault, or fall through to the picker. Startup
  // "Reopen last note" is a one-time check here, against the freshly loaded
  // tree — the note may since have been renamed or binned, in which case this
  // just leaves the blank screen rather than erroring.
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
      if (v && s.startup === 'last' && s.lastNotePath && findNode(loadedTree, s.lastNotePath)) {
        await openNote(s.lastNotePath)
      }
    })()
  }, [loadTree, loadWorkspace, loadSettings, openNote, syncSpaces])

  // Remember whichever note is open, regardless of the current startup
  // preference — so turning "Reopen last note" on later picks up naturally
  // instead of being stuck on whatever was open when the toggle was flipped.
  // Bypasses changeSettings: this shouldn't re-run applySettings on every click.
  useEffect(() => {
    if (!openPath) return
    void window.api.setSettings({ lastNotePath: openPath })
  }, [openPath])

  // A space's folder can be made, renamed or deleted outside the app, so the
  // saved spaces re-sync whenever the tree does — not only at startup.
  const settingsRef = useRef(settings)
  settingsRef.current = settings

  // external changes → refresh the tree (and the open note if it changed)
  useEffect(() => {
    return window.api.onVaultChanged(async ({ paths }) => {
      contentCache.current.clear() // note contents may have changed on disk
      const t = await loadTree()
      await syncSpaces(t, settingsRef.current)
      const p = openPathRef.current
      if (p && paths.includes(p)) {
        if (dirtyRef.current && dirtyRef.current.path === p) return // don't clobber unsaved edits
        try {
          setContent(await window.api.readNote(p))
          setDocVersion((v) => v + 1)
        } catch {
          setOpenPath(null)
          setContent('')
        }
      }
    })
  }, [loadTree, syncSpaces])

  const pick = async (): Promise<void> => {
    const v = await window.api.pickVault()
    if (v) {
      setVault(v)
      setOpenPath(null)
      setContent('')
      const t = await loadTree()
      await loadWorkspace()
      const s = await loadSettings() // a vault may carry its own saved appearance
      // The watcher only reports CHANGES from here on (ignoreInitial: true), so
      // a vault's pre-existing top-level folders never self-announce as spaces
      // otherwise — nothing would reconcile them until some later fs event.
      await syncSpaces(t, s)
    }
  }

  const run = async (fn: () => Promise<void>): Promise<void> => {
    try {
      await fn()
    } catch (e) {
      window.alert((e as Error).message ?? String(e))
    }
  }

  // After a rename/move, keep the open note and any pending unsaved buffer
  // pointed at the entry's new path (covers a moved folder's descendants too).
  const remapOpen = (oldPath: string, newRel: string): void => {
    const d = dirtyRef.current
    if (d) {
      if (d.path === oldPath) d.path = newRel
      else if (d.path.startsWith(oldPath + '/')) d.path = newRel + d.path.slice(oldPath.length)
    }
    setOpenPath((cur) => {
      if (cur === oldPath) return newRel
      if (cur && cur.startsWith(oldPath + '/')) return newRel + cur.slice(oldPath.length)
      return cur
    })
  }

  /** Forget an open note / pending write that has just left the vault. */
  const forgetIfInside = (roots: string[]): void => {
    const inside = (p: string | null): boolean =>
      !!p && roots.some((r) => p === r || p.startsWith(r + '/'))
    if (inside(dirtyRef.current?.path ?? null)) {
      dirtyRef.current = null
      if (saveTimer.current) clearTimeout(saveTimer.current)
    }
    setOpenPath((cur) => {
      if (!inside(cur)) return cur
      setContent('')
      return null
    })
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

  // Toggle Edit/Read. Entering Read snapshots the live editor buffer (so unsaved
  // edits render); leaving just hides the reading layer over the still-mounted editor.
  const toggleRead = (): void => {
    if (reading) {
      setReading(false)
      return
    }
    setReadSource(editorViewRef.current?.state.doc.toString() ?? content)
    setReading(true)
  }

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

  const openSearchResult = (h: SearchHit): void => {
    void openNote(h.path)
    setQuery('')
  }

  // The editable note-title header mirrors the open note's filename (minus .md);
  // committing it renames the file, reusing the same sanitise/flash path.
  useEffect(() => {
    setTitleDraft(openPath ? stripMd(nameOf(openPath)) : '')
  }, [openPath])
  const commitTitle = (): Promise<void> =>
    run(async () => {
      const p = openPathRef.current
      if (!p) return
      const cur = stripMd(nameOf(p))
      const next = titleDraft.trim()
      if (!next || next === cur) {
        setTitleDraft(cur)
        return
      }
      const fname = next.toLowerCase().endsWith('.md') ? next : `${next}.md`
      const actualRel = await window.api.renameEntry(p, joinPath(parentOf(p), fname))
      await loadTree()
      await loadWorkspace()
      remapOpen(p, actualRel)
      const actualName = stripMd(nameOf(actualRel))
      setTitleDraft(actualName)
      if (actualName !== next) flash(`Renamed to "${actualName}" (adjusted for cross-platform safety)`)
    })

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
          onOpen: (p) => void openNote(p),
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
        {openPath ? (
          <>
            <div className="flex items-center gap-3 border-b border-ink-300/25 bg-surface/40 px-5 py-3 backdrop-blur">
              <input
                className="min-w-0 flex-1 truncate bg-transparent font-display text-lg font-semibold text-ink-900 outline-none placeholder:text-ink-300"
                value={titleDraft}
                placeholder="Untitled"
                title={openPath}
                onChange={(e) => setTitleDraft(e.target.value)}
                onBlur={() => void commitTitle()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    ;(e.target as HTMLInputElement).blur()
                  } else if (e.key === 'Escape') {
                    setTitleDraft(stripMd(nameOf(openPath ?? '')))
                    ;(e.target as HTMLInputElement).blur()
                  }
                }}
              />
              <span className="hidden shrink-0 text-xs text-ink-300 sm:block">
                {formatNumber(wordCount, settings.numberFormat)} {wordCount === 1 ? 'word' : 'words'}
              </span>
              <button
                className="flex shrink-0 items-center gap-1.5 rounded-full border-none bg-surface/70 px-3.5 py-1.5 text-sm font-medium text-ink-700 shadow-card outline-none transition duration-200 spring hover:-translate-y-0.5 hover:bg-surface/70 hover:text-brand-600 focus-visible:ring-4 focus-visible:ring-brand-100"
                title={reading ? 'Back to editing' : 'Reading view'}
                onClick={toggleRead}
              >
                <Icon name={reading ? 'edit' : 'eye'} className="h-4 w-4" />
                <span>{reading ? 'Edit' : 'Read'}</span>
              </button>
            </div>
            {!reading && (
              <FormatToolbar
                viewRef={editorViewRef}
                slots={space.toolbarSlots}
                onSetSlot={(i, id) => {
                  const next = [...space.toolbarSlots]
                  next[i] = id
                  void changeSettings(withSpacePatch(settings, space.folder, { toolbarSlots: next }))
                }}
              />
            )}
            <div className="pane-body">
              <div className="edit-layer" style={{ display: reading ? 'none' : 'flex' }}>
                <CodeEditor
                  path={openPath}
                  doc={content}
                  version={docVersion}
                  onDocChange={onDocChange}
                  editorRef={editorViewRef}
                />
              </div>
              {reading && (
                <div className="read-layer">
                  <ReadingView source={readSource} />
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center">
            <div className="text-center">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-surface/70 text-brand-300 shadow-card">
                <Icon name="doc" className="h-8 w-8" />
              </div>
              <p className="font-display text-xl text-ink-700">Pick a note, or start a new one</p>
              <p className="mt-1 text-sm text-ink-500">Your Markdown formats as you type.</p>
            </div>
          </div>
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
