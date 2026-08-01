/** A stand-in for the preload bridge, so the REAL renderer runs in a browser tab.
 *
 *  `electron-vite dev` serves this renderer on http://localhost:5173 as an
 *  ordinary Vite app; open it and everything works except `window.api`, which
 *  only exists inside Electron (rule 6 — the renderer never touches fs, so
 *  without the bridge it has no notes at all and dies on the first call).
 *  This module fakes the bridge against localStorage.
 *
 *  DEV ONLY, and deliberately so: it is imported from a
 *  `import.meta.env.DEV && !window.api` branch in main.tsx, which a production
 *  build drops entirely. It is a preview of the UI, NOT a second implementation
 *  of the app — nothing here may grow behaviour the Electron app doesn't have,
 *  and no feature may be built against it (CLAUDE.md rule 8: legacy/ drifted for
 *  exactly this reason). Files are the source of truth; localStorage is a
 *  stunt double.
 */
import type { TreeNode, VaultApi, VaultChange } from '../../../shared/types'
import { normalizeSettings, type AppSettings } from '../../../shared/settings'
import {
  EMPTY_WORKSPACE,
  isSelfOrDescendant,
  normalizeEntry,
  normalizeWorkspace,
  remapPath,
  type EntryMeta,
  type TrashItem,
  type Workspace
} from '../../../shared/workspace'

const KEY = 'mdnotes.browser-preview.v1'

interface Store {
  /** vault-relative path → contents. Folders are the paths in `dirs`. */
  files: Record<string, string>
  dirs: string[]
  workspace: Workspace
  settings: unknown
  trashed: Record<string, { files: Record<string, string>; dirs: string[] }>
}

const SAMPLE: Record<string, string> = {
  'Demo/Welcome.md':
    '# Welcome\n\nThis is the **browser preview** of the real editor — the same React, the same\nCodeMirror, standing on localStorage instead of your vault.\n\n- Open a few notes: each one gets a tab across the top.\n- `Ctrl+Tab` cycles through them.\n- Drag a tab onto the *left or right edge* of the text to split the screen.\n',
  'Demo/Split screen.md':
    '# Split screen\n\nDrag a tab over the edge of a pane and a highlight shows where it will land:\n\n| Where you drop      | What happens          |\n| ------------------- | --------------------- |\n| left / right edge   | a new column          |\n| the middle          | replaces that column  |\n\nUp to three columns fit side by side.\n',
  'Demo/Shortcuts.md':
    '# Shortcuts\n\n- `Ctrl+Tab` / `Ctrl+Shift+Tab` — next / previous tab\n- `Cmd/Ctrl+1…9` — jump to a tab\n- `Cmd/Ctrl+\\` — split the focused note off to the right\n- `Cmd/Ctrl+W` — close the tab\n',
  'Demo/Formatting.md':
    '# Formatting\n\nMarkdown formats as you type: **bold**, *italic*, `code`.\n\n> A quote, for comparing panes side by side.\n\n1. One\n2. Two\n3. Three\n',
  'Demo/Maths.md': '# Maths\n\nInline $e^{i\\pi} + 1 = 0$, and a display block:\n\n$$\n\\int_0^1 x^2 dx = \\tfrac13\n$$\n'
}

const load = (): Store => {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Store> | null
    if (raw?.files) {
      return {
        files: raw.files,
        dirs: raw.dirs ?? [],
        workspace: normalizeWorkspace(raw.workspace),
        settings: raw.settings ?? {},
        trashed: raw.trashed ?? {}
      }
    }
  } catch {
    /* corrupt preview state — start over rather than block the page */
  }
  return { files: { ...SAMPLE }, dirs: ['Demo'], workspace: EMPTY_WORKSPACE, settings: {}, trashed: {} }
}

const store = load()
const save = (): void => localStorage.setItem(KEY, JSON.stringify(store))

const parentOf = (p: string): string => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')
const nameOf = (p: string): string => p.slice(p.lastIndexOf('/') + 1)
const join = (dir: string, name: string): string => (dir ? `${dir}/${name}` : name)

/** " (2)", " (3)"… until the name is free — the same convention main uses. */
const unique = (dir: string, name: string): string => {
  const taken = (p: string): boolean => p in store.files || store.dirs.includes(p)
  const dot = name.lastIndexOf('.')
  const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, '']
  let candidate = join(dir, name)
  for (let n = 2; taken(candidate); n++) candidate = join(dir, `${stem} (${n})${ext}`)
  return candidate
}

const preview = (text: string): string =>
  text
    .replace(/^#+\s.*$/m, '')
    .replace(/[#*`>_~-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)

function buildTree(): TreeNode[] {
  const nodes = new Map<string, TreeNode>()
  for (const dir of store.dirs) nodes.set(dir, { name: nameOf(dir), path: dir, type: 'dir', children: [] })
  const roots: TreeNode[] = []
  const attach = (node: TreeNode): void => {
    const parent = nodes.get(parentOf(node.path))
    if (parent) parent.children!.push(node)
    else roots.push(node)
  }
  for (const dir of [...store.dirs].sort()) attach(nodes.get(dir)!)
  for (const path of Object.keys(store.files).sort()) {
    attach({ name: nameOf(path), path, type: 'file', preview: preview(store.files[path]) })
  }
  const order = (list: TreeNode[]): TreeNode[] => {
    list.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1))
    for (const n of list) if (n.children) order(n.children)
    return list
  }
  return order(roots)
}

/** No watcher in a browser — but the tree still has to refresh after a create or
 *  a rename, which in Electron arrives as a change event. */
const listeners = new Set<(c: VaultChange) => void>()
const announce = (paths: string[]): void => {
  for (const cb of listeners) cb({ paths })
}

const api: VaultApi = {
  getVault: async () => 'Browser preview',
  pickVault: async () => 'Browser preview', // no folder picker outside Electron
  listTree: async () => buildTree(),
  readNote: async (path) => {
    if (!(path in store.files)) throw new Error(`No such note: ${path}`)
    return store.files[path]
  },
  writeNote: async (path, content) => {
    store.files[path] = content
    save()
  },
  createNote: async (dirPath) => {
    const path = unique(dirPath, 'Untitled.md')
    store.files[path] = ''
    save()
    return path
  },
  createFolder: async (dirPath) => {
    const path = unique(dirPath, 'New folder')
    store.dirs.push(path)
    save()
    return path
  },
  renameEntry: async (from, to) => {
    const dest = unique(parentOf(to), nameOf(to))
    if (store.dirs.includes(from)) {
      store.dirs = store.dirs.map((d) => remapPath(d, from, dest))
      for (const p of Object.keys(store.files)) {
        const next = remapPath(p, from, dest)
        if (next === p) continue
        store.files[next] = store.files[p]
        delete store.files[p]
      }
    } else {
      store.files[dest] = store.files[from] ?? ''
      delete store.files[from]
    }
    const entries: Record<string, EntryMeta> = {}
    for (const [p, meta] of Object.entries(store.workspace.entries)) entries[remapPath(p, from, dest)] = meta
    store.workspace = { ...store.workspace, entries }
    save()
    announce([from, dest])
    return dest
  },

  getSettings: async () => normalizeSettings(store.settings),
  setSettings: async (partial) => {
    const next = normalizeSettings({ ...(normalizeSettings(store.settings) as object), ...partial })
    store.settings = next as unknown as AppSettings
    save()
    return next
  },

  getWorkspace: async () => store.workspace,
  updateEntry: async (path, partial) => api.updateEntries([path], partial),
  updateEntries: async (paths, partial) => {
    const entries = { ...store.workspace.entries }
    for (const p of paths) entries[p] = normalizeEntry({ ...entries[p], ...partial })
    store.workspace = { ...store.workspace, entries }
    save()
    return store.workspace
  },
  reorderEntries: async (paths) => {
    const entries = { ...store.workspace.entries }
    paths.forEach((p, i) => (entries[p] = normalizeEntry({ ...entries[p], order: i })))
    store.workspace = { ...store.workspace, entries }
    save()
    return store.workspace
  },
  trashEntries: async (paths) => {
    const trash: TrashItem[] = [...store.workspace.trash]
    for (const path of paths) {
      const id = Math.random().toString(36).slice(2, 10)
      const held = { files: {} as Record<string, string>, dirs: [] as string[] }
      for (const p of Object.keys(store.files)) {
        if (!isSelfOrDescendant(p, path)) continue
        held.files[p] = store.files[p]
        delete store.files[p]
      }
      held.dirs = store.dirs.filter((d) => isSelfOrDescendant(d, path))
      store.dirs = store.dirs.filter((d) => !isSelfOrDescendant(d, path))
      store.trashed[id] = held
      trash.push({
        id,
        name: nameOf(path),
        from: path,
        type: held.dirs.includes(path) ? 'dir' : 'file',
        deletedAt: Date.now()
      })
    }
    store.workspace = { ...store.workspace, trash }
    save()
    announce(paths)
    return store.workspace
  },
  restoreEntries: async (ids) => {
    for (const id of ids) {
      const held = store.trashed[id]
      if (!held) continue
      Object.assign(store.files, held.files)
      store.dirs.push(...held.dirs)
      delete store.trashed[id]
    }
    store.workspace = { ...store.workspace, trash: store.workspace.trash.filter((t) => !ids.includes(t.id)) }
    save()
    announce([])
    return store.workspace
  },
  purgeEntries: async (ids) => {
    const gone = ids ?? store.workspace.trash.map((t) => t.id)
    for (const id of gone) delete store.trashed[id]
    store.workspace = { ...store.workspace, trash: store.workspace.trash.filter((t) => !gone.includes(t.id)) }
    save()
    return store.workspace
  },
  deleteSpace: async (folder) => {
    for (const p of Object.keys(store.files)) if (isSelfOrDescendant(p, folder)) delete store.files[p]
    store.dirs = store.dirs.filter((d) => !isSelfOrDescendant(d, folder))
    save()
    announce([folder])
    return store.workspace
  },

  // Updates are an Electron-only concern; the preview says so rather than
  // pretending it can install anything.
  getUpdateState: async () => ({
    version: 'browser-preview',
    status: { state: 'unsupported', reason: 'This is the browser preview — updates live in the app.' },
    prefs: { autoUpdate: false, betaChannel: false }
  }),
  checkForUpdate: async () => ({ state: 'unsupported', reason: 'Browser preview' }),
  downloadUpdate: async () => ({ state: 'unsupported', reason: 'Browser preview' }),
  installUpdate: () => {},
  setAutoUpdate: async () => ({ state: 'unsupported', reason: 'Browser preview' }),
  setBetaChannel: async () => ({ state: 'unsupported', reason: 'Browser preview' }),
  openReleases: () => {},
  sendBugReport: async () => false,
  onUpdateStatus: () => () => {},

  onVaultChanged: (cb) => {
    listeners.add(cb)
    return () => listeners.delete(cb) as unknown as void
  },
  onMenuCommand: () => () => {}, // no application menu in a browser tab
  onBeforeQuit: () => () => {},
  notifyFlushed: () => {}
}

export function installBrowserApi(): void {
  window.api = api
  // eslint-disable-next-line no-console
  console.info('[notes] browser preview: window.api is a localStorage stub, not your vault')
}
