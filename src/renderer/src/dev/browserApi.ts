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
import { indexLinks, stripMd } from '../../../shared/links'
import { indexEmbeds } from '../../../shared/attachments'
import { normalizeSettings, type AppSettings } from '../../../shared/settings'
import { findFont, type InstalledFont } from '../../../shared/fonts'
import {
  EMPTY_WORKSPACE,
  isSelfOrDescendant,
  normalizeEntry,
  normalizeWorkspace,
  remapPath,
  type EntryMeta,
  type RecoveryItem,
  type TrashItem,
  type Workspace
} from '../../../shared/workspace'

const KEY = 'mdnotes.browser-preview.v1'
const FONT_KEY = 'mdnotes.browser-preview.fonts.v1'

function loadFontCache(): InstalledFont[] {
  try {
    const raw = localStorage.getItem(FONT_KEY)
    return raw ? (JSON.parse(raw) as InstalledFont[]) : []
  } catch {
    return []
  }
}
function saveFontCache(list: InstalledFont[]): void {
  localStorage.setItem(FONT_KEY, JSON.stringify(list))
}
function bufToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

interface Store {
  /** vault-relative path → contents. Folders are the paths in `dirs`. */
  files: Record<string, string>
  dirs: string[]
  workspace: Workspace
  settings: unknown
  trashed: Record<string, { files: Record<string, string>; dirs: string[] }>
  /** same shape as `trashed`, one step further along — mirrors the real app's
   *  .mdnotes/recovery/ safety net (workspace.recovery). */
  recovered: Record<string, { files: Record<string, string>; dirs: string[] }>
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
        trashed: raw.trashed ?? {},
        recovered: raw.recovered ?? {}
      }
    }
  } catch {
    /* corrupt preview state — start over rather than block the page */
  }
  return {
    files: { ...SAMPLE },
    dirs: ['Demo'],
    workspace: EMPTY_WORKSPACE,
    settings: {},
    trashed: {},
    recovered: {}
  }
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
    // No filesystem, so no real timestamps — the fields are optional precisely
    // so a source that hasn't got them can leave them off.
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
  // No real files in browser preview, so an inline image has nothing to show —
  // imagePass falls back to its "not found" state, which is the honest answer.
  readAsset: async () => {
    throw new Error('No file access in browser preview')
  },
  // Same honest answer as readAsset: paste/drop/attach have nowhere to write
  // outside Electron, so the preview can't demonstrate this feature at all.
  writeAsset: async () => {
    throw new Error('No file access in browser preview')
  },
  pickAttachment: async () => {
    throw new Error('No file access in browser preview')
  },
  writeNote: async (path, content) => {
    store.files[path] = content
    save()
  },
  createNote: async (dirPath, name) => {
    const path = unique(dirPath, (name ? stripMd(name) : 'Untitled') + '.md')
    store.files[path] = ''
    save()
    return path
  },
  scanLinks: async (paths) => {
    const list = paths ? paths.filter((p) => p in store.files) : Object.keys(store.files)
    return list.map((path) => ({
      path,
      links: indexLinks(store.files[path]),
      embeds: indexEmbeds(store.files[path])
    }))
  },
  createFolder: async (dirPath, name) => {
    const path = unique(dirPath, name || 'New folder')
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

  // The saved-preset library lives in userData, which a browser tab has no
  // equivalent of (shared/presets.ts). Inert rather than faked against
  // localStorage: the Spaces page renders its empty state, and nothing here may
  // grow behaviour the Electron app doesn't have (rule 8).
  listPresets: async () => [],
  syncPresets: async () => [],
  renamePreset: async () => [],
  deletePreset: async () => [],
  exportPresets: async () => null,
  importPresets: async () => ({ added: 0, found: 0, cancelled: true, presets: [] }),

  // Real fetches, same CDN the Electron app hits — this is the one place a
  // fake window.api reaches the network, and it mirrors production rather
  // than inventing behaviour (rule at the top of this file): only the cache
  // differs (localStorage here, userData/fonts/ there). A native file picker
  // has no browser-tab equivalent, so importCustomFont is the one font
  // action that genuinely can't be prototyped here — same as everything else
  // that touches real files (see the file header).
  listInstalledFonts: async () => loadFontCache(),
  downloadFont: async (id) => {
    const entry = findFont(id)
    if (!entry || entry.source !== 'downloadable' || !entry.cdnUrl) {
      return { ok: false, error: 'Not a downloadable font.' }
    }
    try {
      const res = await fetch(entry.cdnUrl)
      if (!res.ok) return { ok: false, error: `Download failed (${res.status}).` }
      const font: InstalledFont = {
        id,
        source: 'downloaded',
        family: entry.family,
        fallback: entry.fallback,
        base64: bufToBase64(await res.arrayBuffer())
      }
      saveFontCache([...loadFontCache().filter((f) => f.id !== id), font])
      return { ok: true, font }
    } catch {
      return { ok: false, error: 'No connection.' }
    }
  },
  importCustomFont: async () => ({ ok: false, cancelled: true }),
  removeCustomFont: async () => {},

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
  trashEntries: async (paths, origins) => {
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
        deletedAt: Date.now(),
        // Mirrors main exactly (main/workspace.ts) — the preview has to carry
        // this or the restore-into-the-note behaviour can't be looked at here.
        ...(origins?.[path] ? { media: origins[path] } : {})
      })
    }
    store.workspace = { ...store.workspace, trash }
    save()
    announce(paths)
    return store.workspace
  },
  restoreEntries: async (ids) => {
    const landing: [string, string][] = []
    for (const id of ids) {
      const held = store.trashed[id]
      if (!held) continue
      const from = store.workspace.trash.find((t) => t.id === id)?.from
      if (from) landing.push([id, from])
      Object.assign(store.files, held.files)
      store.dirs.push(...held.dirs)
      delete store.trashed[id]
    }
    store.workspace = { ...store.workspace, trash: store.workspace.trash.filter((t) => !ids.includes(t.id)) }
    save()
    announce([])
    // The preview never collides on a name (a restore here writes straight back
    // over the key), so `landed` is always the promised path. Main is the one
    // that can suffix — see workspace.ts.
    return { workspace: store.workspace, landed: Object.fromEntries(landing) }
  },
  purgeEntries: async (ids) => {
    const gone = ids ?? store.workspace.trash.map((t) => t.id)
    const recovery: RecoveryItem[] = [...store.workspace.recovery]
    for (const item of store.workspace.trash) {
      if (!gone.includes(item.id)) continue
      const held = store.trashed[item.id]
      if (held) {
        store.recovered[item.id] = held
        delete store.trashed[item.id]
      }
      recovery.unshift({
        id: item.id,
        from: item.from,
        name: item.name,
        type: item.type,
        ...(item.media ? { media: item.media } : {}),
        purgedAt: Date.now()
      })
    }
    store.workspace = {
      ...store.workspace,
      trash: store.workspace.trash.filter((t) => !gone.includes(t.id)),
      recovery
    }
    save()
    return store.workspace
  },
  restoreRecoveryEntries: async (ids) => {
    const landing: [string, string][] = []
    for (const id of ids) {
      const held = store.recovered[id]
      if (!held) continue
      const from = store.workspace.recovery.find((r) => r.id === id)?.from
      if (from) landing.push([id, from])
      Object.assign(store.files, held.files)
      store.dirs.push(...held.dirs)
      delete store.recovered[id]
    }
    store.workspace = {
      ...store.workspace,
      recovery: store.workspace.recovery.filter((r) => !ids.includes(r.id))
    }
    save()
    announce([])
    return { workspace: store.workspace, landed: Object.fromEntries(landing) }
  },
  purgeRecoveryEntries: async (ids) => {
    const gone = ids ?? store.workspace.recovery.map((r) => r.id)
    for (const id of gone) delete store.recovered[id]
    store.workspace = {
      ...store.workspace,
      recovery: store.workspace.recovery.filter((r) => !gone.includes(r.id))
    }
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
  revealUpdate: async () => {},
  setAutoUpdate: async () => ({ state: 'unsupported', reason: 'Browser preview' }),
  setBetaChannel: async () => ({ state: 'unsupported', reason: 'Browser preview' }),
  openReleases: () => {},
  sendBugReport: async () => false,
  sendFeatureRequest: async () => false,
  openExternal: async () => false, // no shell access outside Electron
  // Browser preview has no real folder picker or importer, so onboarding
  // (which needs both) is never worth showing here — always "already done".
  getOnboarded: async () => true,
  setOnboarded: async () => {},
  getOnboardingStep: async () => null,
  setOnboardingStep: async () => {},
  revealInFolder: async () => {},
  // The preview IS the current build by definition — there is no second process
  // to be out of step with.
  bootInfo: async () => ({ startedAt: Date.now(), version: 'browser-preview' }),
  resetOnboardingTestVault: async () => 'browser-preview',
  importFormats: async () => [],
  importPickSource: async () => null,
  importPrepare: async (_format, paths) => paths,
  importPreview: async () => ({
    noteCount: 0,
    folderCount: 0,
    notes: [],
    warnings: ['Import needs the Electron app']
  }),
  importRun: async () => {
    throw new Error('Import needs the Electron app')
  },
  importCancel: async () => {},
  onImportProgress: () => () => {},
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
