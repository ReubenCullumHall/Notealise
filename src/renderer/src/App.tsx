import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { EditorView } from '@codemirror/view'
import type { TreeNode } from '../../shared/types'
import type { SpacesMap } from '../../shared/spaces'
import { TreeView } from './TreeView'
import { ContextMenu, type MenuItem } from './ContextMenu'
import { CodeEditor } from './editor'
import { FormatToolbar } from './editor/FormatToolbar'
import { SettingsButton } from './settings/Settings'
import { ReadingView } from './reader/ReadingView'
import { applySettings } from './settings/model'
import { DEFAULT_SETTINGS, type AppSettings } from '../../shared/settings'
import { SpaceRail } from './spaces/SpaceRail'
import { SpacePopover } from './spaces/SpacePopover'
import { deriveSpaces, hexToChannels, type Space } from './spaces/model'
import { SearchBar, SearchResults, type SearchHit } from './Search'
import { Icon } from './icons'

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

export default function App(): React.JSX.Element {
  const [ready, setReady] = useState(false)
  const [vault, setVault] = useState<string | null>(null)
  const [tree, setTree] = useState<TreeNode[]>([])
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
  // Spaces: raw presentation metadata (folder name → colour/icon/order), the
  // currently selected space ('' = the synthetic Home space of loose root notes),
  // the right-click popover, and the swipe/switch slide direction for animation.
  const [spaces, setSpaces] = useState<SpacesMap>({})
  const [activeSpace, setActiveSpace] = useState<string>('')
  const [spacePop, setSpacePop] = useState<{ x: number; y: number; space: Space } | null>(null)
  const [slideDir, setSlideDir] = useState<'left' | 'right' | null>(null)
  // Search (spotlight pill). `deep` also matches note contents, not just titles.
  const [query, setQuery] = useState('')
  const [deep, setDeep] = useState(false)
  const [cacheVersion, setCacheVersion] = useState(0)
  const contentCache = useRef<Map<string, string>>(new Map())
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

  const loadTree = useCallback(async (): Promise<void> => {
    setTree(await window.api.listTree())
  }, [])
  const loadSpaces = useCallback(async (): Promise<void> => {
    setSpaces(await window.api.getSpaces())
  }, [])

  // Appearance: load the active vault's settings (or cached defaults) and apply
  // theme/density/accent to <html>. `applySettings` is the only DOM writer.
  const changeSettings = useCallback(async (partial: Partial<AppSettings>): Promise<void> => {
    const next = await window.api.setSettings(partial)
    setSettings(next)
    applySettings(next)
  }, [])
  const loadSettings = useCallback(async (): Promise<void> => {
    const s = await window.api.getSettings()
    setSettings(s)
    applySettings(s)
  }, [])

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

  // initial load: open the saved vault, or fall through to the picker
  useEffect(() => {
    void (async () => {
      const v = await window.api.getVault()
      setVault(v)
      setReady(true)
      if (v) {
        await loadTree()
        await loadSpaces()
      }
      await loadSettings()
    })()
  }, [loadTree, loadSpaces, loadSettings])

  // external changes → refresh the tree (and the open note if it changed). A
  // folder created/removed in Finder/Explorer shows up (or disappears) as a
  // space here, auto-coloured, without a reload.
  useEffect(() => {
    return window.api.onVaultChanged(async ({ paths }) => {
      contentCache.current.clear() // note contents may have changed on disk
      await loadTree()
      await loadSpaces()
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
  }, [loadTree, loadSpaces])

  const pick = async (): Promise<void> => {
    const v = await window.api.pickVault()
    if (v) {
      setVault(v)
      setActiveSpace('') // a fresh vault starts on Home
      await loadTree()
      await loadSpaces()
      await loadSettings() // a vault may carry its own saved appearance
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
  const remapPath = (oldPath: string, newRel: string): void => {
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

  // Drag-and-drop: move an entry into folder `toDir` ("" = vault root). The file
  // is physically moved via renameEntry; guards mirror the tree's canDrop.
  const move = (fromPath: string, toDir: string): Promise<void> =>
    run(async () => {
      if (toDir === fromPath || toDir.startsWith(fromPath + '/')) return // into self/descendant
      const dest = joinPath(toDir, nameOf(fromPath))
      if (dest === fromPath) return // already there
      const actualRel = await window.api.renameEntry(fromPath, dest)
      await loadTree()
      remapPath(fromPath, actualRel)
    })

  // --- spaces ---------------------------------------------------------------
  // Derive the ordered rail (Home + one space per top-level folder) from the tree
  // and the stored metadata. Resolve the active space, always falling back to
  // Home if the selected folder has gone (deleted/renamed externally).
  const spaceList = useMemo(() => deriveSpaces(tree, spaces), [tree, spaces])
  const activeSpaceObj = spaceList.find((s) => s.name === activeSpace) ?? spaceList[0]
  const activeSpaceName = activeSpaceObj.name

  useEffect(() => {
    if (!spaceList.some((s) => s.name === activeSpace)) setActiveSpace('')
  }, [spaceList, activeSpace])

  // The active space's colour becomes a scoped CSS variable on the app wrapper,
  // so accents elsewhere (active row, focus rings, glow) pick it up without the
  // colour being threaded through as a prop. Home stays neutral (brand fallback).
  const accentStyle = useMemo<React.CSSProperties | undefined>(() => {
    const ch = activeSpaceObj.color ? hexToChannels(activeSpaceObj.color) : null
    return ch ? ({ ['--space-accent']: ch } as React.CSSProperties) : undefined
  }, [activeSpaceObj.color])

  // Refs so the stable wheel/swipe listener always sees the latest list + active.
  const spaceListRef = useRef(spaceList)
  spaceListRef.current = spaceList
  const activeSpaceRef = useRef(activeSpaceName)
  activeSpaceRef.current = activeSpaceName

  const switchSpace = useCallback((name: string, dir: 'left' | 'right' | null): void => {
    setSlideDir(dir)
    setActiveSpace(name)
  }, [])

  // Move `delta` spaces along the rail (+1 = next/right, -1 = previous/left).
  const switchByOffset = useCallback(
    (delta: 1 | -1): void => {
      const list = spaceListRef.current
      const cur = Math.max(0, list.findIndex((s) => s.name === activeSpaceRef.current))
      const next = cur + delta
      if (next < 0 || next >= list.length) return
      switchSpace(list[next].name, delta === 1 ? 'right' : 'left')
    },
    [switchSpace]
  )

  const recolorSpace = (name: string, color: string): void =>
    void run(async () => setSpaces(await window.api.updateSpace(name, { color })))
  const setSpaceIcon = (name: string, icon: string): void =>
    void run(async () => setSpaces(await window.api.updateSpace(name, { icon })))
  const reorderSpaces = (names: string[]): void =>
    void run(async () => setSpaces(await window.api.reorderSpaces(names)))

  const renameSpace = (space: Space): Promise<void> =>
    run(async () => {
      const next = await ask('Rename space', space.name)
      if (next == null || !next.trim() || next.trim() === space.name) return
      const res = await window.api.renameSpace(space.name, next.trim())
      setSpaces(res.spaces)
      await loadTree()
      remapPath(space.name, res.name) // keep an open note inside the space pointed right
      if (activeSpaceRef.current === space.name) setActiveSpace(res.name)
      if (res.name !== next.trim()) flash(`Renamed to "${res.name}" (adjusted for cross-platform safety)`)
    })

  const deleteSpace = (space: Space): Promise<void> =>
    run(async () => {
      if (!window.confirm(`Move the space "${space.name}" and all its notes to the trash?`)) return
      setSpaces(await window.api.deleteSpace(space.name))
      await loadTree()
      if (activeSpaceRef.current === space.name) setActiveSpace('')
      // drop the open note / pending write if it lived inside the deleted space
      const inside = (p: string | null): boolean => !!p && (p === space.name || p.startsWith(space.name + '/'))
      if (inside(dirtyRef.current?.path ?? null)) {
        dirtyRef.current = null
        if (saveTimer.current) clearTimeout(saveTimer.current)
      }
      if (inside(openPath)) {
        setOpenPath(null)
        setContent('')
      }
    })

  const newSpace = (): Promise<void> =>
    run(async () => {
      const name = await ask('New space name', 'New space')
      if (name == null || !name.trim()) return
      const rel = await window.api.createFolder(name.trim()) // top-level folder = a space
      await loadTree()
      await loadSpaces()
      setActiveSpace(rel) // createFolder returns the (top-level) folder name
      if (rel !== name.trim()) flash(`Created as "${rel}" (adjusted for cross-platform safety)`)
    })

  const openSpacePopover = (e: React.MouseEvent, space: Space): void =>
    setSpacePop({ x: e.clientX, y: e.clientY, space })

  // Two-finger trackpad swipe across the sidebar switches spaces, Arc-style. Only
  // horizontal-dominant wheels count (vertical stays scrolling); one gesture =
  // one switch (a momentum burst is locked out after the first step).
  const sidebarRef = useRef<HTMLElement>(null)
  useEffect(() => {
    const el = sidebarRef.current
    if (!el) return
    let accum = 0
    let locked = false
    let idle: ReturnType<typeof setTimeout> | null = null
    const onWheel = (e: WheelEvent): void => {
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return // vertical scroll — leave it alone
      e.preventDefault() // suppress history-nav / rubber-band on horizontal swipe
      if (locked) return
      accum += e.deltaX
      if (idle) clearTimeout(idle)
      idle = setTimeout(() => (accum = 0), 140) // a pause forgets a partial swipe
      if (Math.abs(accum) < 60) return
      const delta: 1 | -1 = accum > 0 ? 1 : -1
      accum = 0
      locked = true
      setTimeout(() => (locked = false), 450)
      switchByOffset(delta)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [switchByOffset, vault])

  // --- search ---------------------------------------------------------------
  // Every note in the vault, flattened, tagged with the top-level space it lives
  // in (first path segment; '' = Home). The basis for both title and deep search.
  const allNotes = useMemo<SearchHit[]>(() => {
    const out: SearchHit[] = []
    const walk = (nodes: TreeNode[]): void => {
      for (const n of nodes) {
        if (n.type === 'file') {
          const seg = n.path.includes('/') ? n.path.slice(0, n.path.indexOf('/')) : ''
          out.push({ path: n.path, title: stripMd(nameOf(n.path)), space: seg, spaceLabel: seg || 'Home' })
        } else if (n.children) walk(n.children)
      }
    }
    walk(tree)
    return out
  }, [tree])

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
  }, [query, deep, allNotes, cacheVersion])

  const openSearchResult = (h: SearchHit): void => {
    switchSpace(h.space, null)
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
      remapPath(p, actualRel)
      const actualName = stripMd(nameOf(actualRel))
      setTitleDraft(actualName)
      if (actualName !== next) flash(`Renamed to "${actualName}" (adjusted for cross-platform safety)`)
    })

  const newNote = (dir: string): Promise<void> =>
    run(async () => {
      const name = await ask('New note name', 'Untitled')
      if (name == null || !name.trim()) return
      const rel = await window.api.createNote(dir, name)
      await loadTree()
      await openNote(rel)
      const actual = nameOf(rel)
      if (stripMd(actual) !== stripMd(name.trim())) flash(`Created as "${actual}" (adjusted for cross-platform safety)`)
    })

  const newFolder = (dir: string): Promise<void> =>
    run(async () => {
      const name = await ask('New folder name', 'New folder')
      if (name == null || !name.trim()) return
      const rel = await window.api.createFolder(joinPath(dir, name.trim()))
      await loadTree()
      const actual = nameOf(rel)
      if (actual !== name.trim()) flash(`Created as "${actual}" (adjusted for cross-platform safety)`)
    })

  const rename = (node: TreeNode): Promise<void> =>
    run(async () => {
      const next = await ask('Rename', nameOf(node.path))
      if (next == null || !next.trim() || next.trim() === nameOf(node.path)) return
      const to = joinPath(parentOf(node.path), next.trim())
      const actualRel = await window.api.renameEntry(node.path, to)
      await loadTree()
      remapPath(node.path, actualRel)
      const actualName = nameOf(actualRel)
      if (stripMd(actualName) !== stripMd(next.trim())) flash(`Renamed to "${actualName}" (adjusted for cross-platform safety)`)
    })

  const del = (node: TreeNode): Promise<void> =>
    run(async () => {
      if (!window.confirm(`Move "${nameOf(node.path)}" to the trash?`)) return
      await window.api.deleteEntry(node.path)
      await loadTree()
      // drop any pending write for a note we just trashed (don't recreate it)
      const d = dirtyRef.current
      if (d && (d.path === node.path || d.path.startsWith(node.path + '/'))) {
        dirtyRef.current = null
        if (saveTimer.current) clearTimeout(saveTimer.current)
      }
      if (openPath === node.path || (openPath && openPath.startsWith(node.path + '/'))) {
        setOpenPath(null)
        setContent('')
      }
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
    // Background right-click creates inside the active space's folder ('' = Home/root).
    const dir = node == null ? activeSpaceName : node.type === 'dir' ? node.path : parentOf(node.path)
    const items: MenuItem[] = [
      { label: 'New note', onClick: () => void newNote(dir) },
      { label: 'New folder', onClick: () => void newFolder(dir) }
    ]
    if (node) {
      items.push({ label: 'Rename', onClick: () => void rename(node) })
      items.push({ label: 'Delete', danger: true, onClick: () => void del(node) })
    }
    setMenu({ x: e.clientX, y: e.clientY, items })
  }

  // Route application-menu commands (New Note / New Folder) to the current
  // handlers via a ref, so the subscription mounts once but never goes stale.
  const menuHandler = useRef<(cmd: string) => void>(() => {})
  menuHandler.current = (cmd: string): void => {
    if (!vault) return
    if (cmd === 'new-note') void newNote(activeSpaceName)
    else if (cmd === 'new-folder') void newFolder(activeSpaceName)
  }
  useEffect(() => window.api.onMenuCommand((cmd) => menuHandler.current(cmd)), [])

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
    <div className="app" style={accentStyle}>
      <aside className="sidebar" ref={sidebarRef} onContextMenu={(e) => openMenu(e, null)}>
        <header className="sidebar-head" title={vault}>
          <span className="vault-name">{baseName(vault)}</span>
          <SettingsButton
            settings={settings}
            onChange={changeSettings}
            spacesAdmin={{
              spaces: spaceList,
              onAdd: () => void newSpace(),
              onRename: (s) => void renameSpace(s),
              onRecolor: recolorSpace,
              onReorder: reorderSpaces,
              onDelete: (s) => void deleteSpace(s)
            }}
          />
          <button className="icon" title="New note" onClick={() => void newNote(activeSpaceName)}>
            +
          </button>
        </header>

        <SearchBar query={query} onQuery={setQuery} deep={deep} onToggleDeep={() => setDeep((d) => !d)} />

        {searchHits !== null ? (
          <div className="tree-scroll">
            <SearchResults hits={searchHits} activePath={openPath} onOpen={openSearchResult} deep={deep} />
          </div>
        ) : (
          <>
            <div className="space-head" title={activeSpaceObj.isHome ? 'Notes loose at the vault root' : activeSpaceObj.label}>
              <span
                className="space-dot"
                style={activeSpaceObj.color ? { background: activeSpaceObj.color } : undefined}
              />
              <span className="space-label">{activeSpaceObj.label}</span>
              <button className="space-head-add" title="New note here" aria-label="New note here" onClick={() => void newNote(activeSpaceName)}>
                <Icon name="plus" />
              </button>
            </div>

            <div className="tree-scroll">
              <div className="space-view" key={activeSpaceName} data-slide={slideDir ?? undefined}>
                {activeSpaceObj.nodes.length === 0 ? (
                  <p className="muted empty">
                    {activeSpaceObj.isHome
                      ? 'No loose notes here. Right-click to create one, or add a space in Settings.'
                      : 'This space is empty. Right-click to add a note.'}
                  </p>
                ) : (
                  <TreeView
                    nodes={activeSpaceObj.nodes}
                    rootDir={activeSpaceName}
                    openPath={openPath}
                    onOpen={(p) => void openNote(p)}
                    onContext={openMenu}
                    onMove={(from, to) => void move(from, to)}
                  />
                )}
              </div>
            </div>
          </>
        )}

        <SpaceRail
          spaces={spaceList}
          activeName={activeSpaceName}
          onSelect={(name) => switchSpace(name, null)}
          onContext={openSpacePopover}
          onReorder={reorderSpaces}
          onDropNote={(from, to) => void move(from, to)}
          onNewSpace={() => void newSpace()}
        />

        <div className="sidebar-foot">
          <button className="open-folder-btn" onClick={() => void pick()} title="Open a different folder as your vault">
            <Icon name="folder" />
            <span>Open folder…</span>
          </button>
        </div>
      </aside>

      <main className="viewer-pane">
        {openPath ? (
          <>
            <div className="editor-header">
              <input
                className="note-title"
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
              <div className="header-right">
                <span className="word-count">
                  {wordCount} {wordCount === 1 ? 'word' : 'words'}
                </span>
                <button
                  className="mode-toggle"
                  title={reading ? 'Back to editing' : 'Reading view'}
                  onClick={toggleRead}
                >
                  {reading ? 'Edit' : 'Read'}
                </button>
              </div>
            </div>
            {!reading && (
              <div className="editor-toolbar">
                <FormatToolbar viewRef={editorViewRef} />
              </div>
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
          <div className="center muted">Select a note to view it.</div>
        )}
      </main>

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}

      {spacePop && (
        <SpacePopover
          space={spaceList.find((s) => s.name === spacePop.space.name) ?? spacePop.space}
          x={spacePop.x}
          y={spacePop.y}
          onClose={() => setSpacePop(null)}
          onRecolor={(hex) => recolorSpace(spacePop.space.name, hex)}
          onSetIcon={(icon) => setSpaceIcon(spacePop.space.name, icon)}
          onRename={() => {
            const s = spacePop.space
            setSpacePop(null)
            void renameSpace(s)
          }}
          onDelete={() => {
            const s = spacePop.space
            setSpacePop(null)
            void deleteSpace(s)
          }}
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
