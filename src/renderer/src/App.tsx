import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { TreeNode } from '../../shared/types'
import type { Workspace } from '../../shared/workspace'
import type { EditorView } from '@codemirror/view'
import { ContextMenu, type MenuItem } from './ContextMenu'
import { clearAssetCaches } from './editor/assetCache'
import { checkMainIsCurrent } from './boot'
import { encodeTarget } from '../../shared/attachments'
import { mediaUsage, otherNotesUsing } from './media/usage'
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
import { applySettings, resolveTheme } from './settings/model'
import { liveIndex, noteRefs } from './links/model'
import { PathBar } from './PathBar'
import { Tooltip } from './Tooltip'
import { StartupSplash } from './StartupSplash'
import { Onboarding } from './onboarding/Onboarding'
import { seedWelcomeNotes } from './onboarding/welcomeNotes'
import { STEPS, type StepId } from './onboarding/model'
import { LinkInspector, type Inspect } from './links/LinkInspector'
import { indexLinks, rewriteLinks, titleOf, type LinkRow } from '../../shared/links'
import type { LinkEnv, LinkHandlers, MediaDelete, OpenHow } from './editor/linkEnv'
import {
  type MediaLanding,
  asRestoreResult,
  isWorkspace,
  spliceMediaBack,
  type MediaOrigin,
  type RecoveryItem,
  type TrashItem
} from '../../shared/workspace'
import {
  activeSpace,
  DEFAULT_SETTINGS,
  reconcileSpaces,
  SPACE_CAP,
  withNewSpace,
  withSpacePatch,
  type AppSettings,
  type Space
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
/** Which space's folder `path` sits under, or '' when it's outside every space
 *  (loose at the vault root). Spaces are top-level vault folders (CLAUDE.md
 *  rule 1: "the folders on disk ARE the spaces"), so this is pure path
 *  arithmetic — no need to know which space is currently active. */
const spaceFolderOf = (path: string, spaces: Space[]): string => {
  for (const s of spaces) {
    if (s.folder && (path === s.folder || path.startsWith(s.folder + '/'))) return s.folder
  }
  return ''
}
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

const EMPTY_WS: Workspace = { entries: {}, trash: [], recovery: [] }

/** A line on the bottom strip. `action` is the one-click way back out of
 *  something that happened WITHOUT asking — currently only a media delete with
 *  the confirmation turned off, which is the single thing in the app that can
 *  remove a file with no dialog in front of it. A notice carrying one is given
 *  longer on screen, since it now has to be read AND acted on. */
interface Notice {
  text: string
  action?: { label: string; run: () => void }
}

/** A tick and a label as one clickable row.
 *
 *  `role="checkbox"` on a <button> rather than a real <input>, because every
 *  other control in these dialogs is a button and inherits the same focus ring
 *  — at the cost of having to undo the base `button` styling (border-none,
 *  bg-transparent) or the row renders as a grey pill. Sized to its own content,
 *  not the dialog: a full-width row with a hover fill reads as a wide flat
 *  button sitting where a button shouldn't be. */
function TickRow({
  on,
  onClick,
  label
}: {
  on: boolean
  onClick: () => void
  label: string
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={on}
      onClick={onClick}
      className={
        'flex items-center gap-2 rounded-lg border-none bg-transparent px-1.5 py-1.5 text-left ' +
        'text-[12.5px] outline-none transition duration-150 hover:bg-brand-500/10 ' +
        'hover:text-ink-700 focus-visible:ring-2 focus-visible:ring-brand-300 ' +
        (on ? 'text-ink-700' : 'text-ink-500')
      }
    >
      <span
        aria-hidden="true"
        className={
          'flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[4px] border ' +
          (on ? 'border-brand-400 bg-brand-500/25 text-brand-600' : 'border-ink-300/50')
        }
      >
        {on && <Icon name="check" className="h-3 w-3" />}
      </span>
      {label}
    </button>
  )
}

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
  // null = not yet answered by main. Gates onboarding, not vault activation —
  // an already-onboarded user whose vault folder went missing still gets the
  // plain recovery picker below, never the full first-run flow again.
  const [hasOnboarded, setHasOnboarded] = useState<boolean | null>(null)
  // syncSpaces reads the flag through THIS, never the state value beside it,
  // and the reason is a boot loop rather than staleness: the boot effect
  // depends on `syncSpaces` and is also what calls `setHasOnboarded`, so if
  // `hasOnboarded` were in syncSpaces' dependency list, answering it would
  // change syncSpaces' identity and re-run the whole boot sequence mid-flight —
  // tree, workspace and settings all loaded a second time, with the second
  // run's `restoreSession` free to overwrite a note the user had already opened
  // in the gap. Same `xRef.current = x` idiom as layoutRef/settingsRef below.
  const hasOnboardedRef = useRef<boolean | null>(null)
  hasOnboardedRef.current = hasOnboarded
  // Which step to mount Onboarding on — fetched once at boot alongside
  // hasOnboarded, so a quit mid-flow resumes instead of always restarting at
  // 'welcome'. Only ever read; Onboarding.tsx itself persists further changes.
  const [onboardingResumeStep, setOnboardingResumeStep] = useState<StepId>('welcome')
  // Set once, the moment a vault becomes active from a cold boot or a first-run
  // folder pick (never from a mid-session "Switch folder") — see the two call
  // sites below. StartupSplash reads `settings.playStartupAnimation` itself at
  // render time, so a settings.json that turns this off still wins even though
  // this flips true first.
  const [splashActive, setSplashActive] = useState(false)
  // A ref alongside the state for the capture-phase keydown listener below,
  // which — like layoutRef beside it — reads this without depending on it, so
  // the global listener doesn't unsubscribe/resubscribe on every change.
  const splashActiveRef = useRef(splashActive)
  splashActiveRef.current = splashActive
  const [tree, setTree] = useState<TreeNode[]>([])
  const treeRef = useRef(tree)
  treeRef.current = tree
  const [workspace, setWorkspaceRaw] = useState<Workspace>(EMPTY_WS)
  /** Every workspace that arrives from main goes through here, and a malformed
   *  one is refused rather than stored.
   *
   *  Roughly fifteen call sites hand this whatever an IPC call returned, so one
   *  reply of the wrong shape used to reach React state and blow up on the next
   *  render — taking the entire window with it (ErrorBoundary.tsx exists
   *  because of exactly that). Keeping the last good value is always better
   *  than storing a broken one: the sidebar goes stale, which is visible and
   *  survivable, instead of the app disappearing. */
  const setWorkspace = (next: Workspace): void => {
    if (!isWorkspace(next)) {
      console.error('refusing a malformed workspace from main', next)
      return
    }
    setWorkspaceRaw(next)
  }
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
  const [notice, setNotice] = useState<Notice | null>(null)
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const showNotice = useCallback((n: Notice): void => {
    setNotice(n)
    if (noticeTimer.current) clearTimeout(noticeTimer.current)
    noticeTimer.current = setTimeout(() => setNotice(null), n.action ? 9000 : 4000)
  }, [])
  /** Say one line and let it fade. The plain form — everything that is only
   *  telling you something, which is everything but the undo above. */
  const flash = useCallback((msg: string): void => showNotice({ text: msg }), [showNotice])

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
        // A literal NUL here made grep and ripgrep treat this whole file as
        // BINARY and silently skip it, so a search for anything in App.tsx
        // found nothing. Same separator, written as an escape.
        .join('\u0000')
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
      // Onboarding's own Spaces step is what's supposed to create the first
      // real space, from what the user picks — this fallback firing first
      // (on the very first tree load, before that screen even shows) would
      // pre-empt it with a blank "New folder" nobody asked for. A vault with
      // zero bound spaces for the length of onboarding is expected, not the
      // "switcher hides, new notes land at the root" problem this guards
      // against for the plain (already-onboarded, no-Onboarding-UI) picker.
      // Read through the ref (see hasOnboardedRef's own note) — `null`, meaning
      // main hasn't answered yet, counts as "not onboarded" here, which is the
      // safe direction: it defers creating a folder until the answer is in.
      if (!hasOnboardedRef.current) {
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

  /** switchSpace, but only for a folder `settings.spaces` has actually
   *  reconciled as a space. That check is not optional and is why this exists:
   *  switching to an unregistered folder sets `activeSpaceFolder` to one with no
   *  tab layout of its own, so whatever is opened next lands in what looks like
   *  a blank pane. Every "take me to this note's space" caller goes through
   *  here — following a link, revealing a folder from the path bar, and the
   *  hand-off at the end of onboarding, where the folder in question may be one
   *  an import created seconds ago and syncSpaces hasn't caught up with yet. */
  const enterSpace = useCallback(
    async (folder: string): Promise<void> => {
      if (!folder || folder === settingsRef.current.activeSpaceFolder) return
      if (!settingsRef.current.spaces.some((sp) => sp.folder === folder)) return
      await switchSpace(folder)
    },
    [switchSpace]
  )

  // --- links ------------------------------------------------------------------
  /** Show a folder from the path bar. The sidebar does the opening and closing;
   *  what App has to add is the space, because the sidebar only ever renders one
   *  space's branch — so revealing a folder in a space you aren't in has to
   *  switch to it first, or the reveal would silently do nothing. */
  const reveal = useCallback(
    async (folder: string): Promise<void> => {
      await enterSpace(folder.split('/')[0])
      // The space's own crumb has no row of its own — the sidebar is already
      // showing its contents — so revealing it means closing everything else,
      // which an empty ancestor chain does anyway.
      revealRef.current?.(folder)
    },
    [enterSpace]
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
      await enterSpace(spaceOf(p))
      if (heading) setPendingHeading({ path: p, heading })
      if (how === 'split') await openBeside(p)
      else await openNote(p, how === 'tab')
    },
    [openBeside, openNote, enterSpace]
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
      dragEnd: () => setDrag(null),
      // The editor has no notice strip of its own, so it borrows this one —
      // the same line "Couldn't make that note" already appears on.
      notify: (message) => flash(message),
      confirmMediaDelete: (req) => {
        // Read from the ref, not a captured value: this callback outlives the
        // render it was built in. Asked never to be asked, the file is binned
        // there and then and the notice carries the way back — that route
        // matters more now that the FILE goes, not just the text.
        if (!settingsRef.current.confirmMediaDelete) {
          deleteMediaNowRef.current(req)
          return
        }
        // Always ticked on open: the dialog is only here BECAUSE asking is on.
        setKeepAsking(true)
        setConfirmClosing(false)
        setMediaConfirm(req)
      }
    }),
    [openLink, createFromLink, reveal, flash]
  )

  // Delete-then-confirm for a photo or video pulled out of a note. The editor
  // has ALREADY removed it by the time this opens, which is the point: you
  // confirm something you can see rather than predict. `restore` is the whole
  // of Cancel — it puts the exact text back at the exact offset, and the embed
  // renders again from it because the text is what it was.
  const [mediaConfirm, setMediaConfirm] = useState<MediaDelete | null>(null)
  // The exit animation needs the dialog to outlive the decision, so closing is a
  // state of its own and `animationend` is what actually unmounts — the same
  // pattern the settings genie uses for its close.
  const [confirmClosing, setConfirmClosing] = useState(false)
  /** The dialog's two ticks are one switch wearing two boxes, so what is held is
   *  the ANSWER rather than a boolean per box — they cannot drift into both-on
   *  or both-off, and "which is ticked" has exactly one source. */
  const [keepAsking, setKeepAsking] = useState(true)
  /** Read by the window-level shortcut handler further down, which listens in
   *  the CAPTURE phase and so fires no matter what has focus. Ctrl+Tab or Cmd+W
   *  with this dialog open would switch or close the note behind it, and Cancel
   *  restores by document OFFSET — it would put the photo into whatever note
   *  ended up on screen. A ref, not the state, because that handler is an effect
   *  with its own dependency list and must not be torn down and rebuilt every
   *  time a dialog opens. */
  const mediaConfirmRef = useRef(false)
  mediaConfirmRef.current = mediaConfirm !== null

  /** Put the file an embed pointed at into the bin, and hand back its bin id.
   *
   *  Taking a photo out of a note takes it out of the vault too — but into
   *  `.mdnotes/trash`, the same bin a deleted note goes to, with the same 7-day
   *  recovery net beneath it. Nothing here reaches the OS trash.
   *
   *  Null when the move didn't happen (trashEntries logs and skips a file it
   *  can't move). That is what tells an undo there is only text to put back —
   *  correctly, because in that case the file never left. */
  const binMedia = async (file: string, origin: MediaOrigin | null): Promise<string | null> => {
    const ws = await window.api.trashEntries([file], origin ? { [file]: origin } : undefined)
    setWorkspace(ws)
    await loadTree()
    // Newest first (trashEntries unshifts), so a file binned, restored and
    // binned again still finds the record this call just made.
    const id = ws.trash.find((t) => t.from === file)?.id ?? null
    // No row means main couldn't move it (it logs and skips — see workspace.ts's
    // trashEntries). The file is still sitting in the vault, and until this said
    // so the only symptom was a photo that left the note and turned up nowhere:
    // not in the bin, not in recovery, still in the folder. Exactly the silent
    // failure the notice channel exists for.
    if (!id) flash(`Couldn't move ${file.split('/').pop()} to the bin — it's still in your vault`)
    return id
  }

  /** The Undo half of a silent delete: the TEXT is put back by the editor
   *  (`req.restore()`), this puts the file back. Split that way because the
   *  editor owns the document and only main can move a file.
   *
   *  A name taken since would land it somewhere else, leaving the restored
   *  markdown pointing at nothing. Seconds after the delete that is close to
   *  impossible — but silent if it happened, so it says so instead. */
  const unbinMedia = (id: string, from: string): void =>
    void run(async () => {
      const res = asRestoreResult(await window.api.restoreEntries([id]))
      if (!res) return void flash("Couldn't put the file back — restart the app and try again")
      setWorkspace(res.workspace)
      await loadTree()
      const at = res.landed[id]
      if (at && at !== from) flash(`Put the file back as ${at.split('/').pop()} — that name was taken`)
    })

  /** The no-dialog path, taken when the confirmation has been switched off.
   *
   *  Held in a ref because `linkHandlers` above is memoised and this is not —
   *  the same reason `settingsRef` sits beside it. The notice is not a courtesy:
   *  it is the only thing standing between a stray Backspace and a file leaving
   *  the note with nothing said about it. */
  const deleteMediaNowRef = useRef<(req: MediaDelete) => void>(() => {})
  deleteMediaNowRef.current = (req) => {
    void run(async () => {
      const id = req.file ? await binMedia(req.file, req.origin) : null
      showNotice({
        text: id ? 'Moved to the bin.' : 'Removed from the note.',
        action: {
          label: 'Undo',
          run: () => {
            req.restore()
            if (id && req.file) unbinMedia(id, req.file)
          }
        }
      })
    })
  }

  /** Commit the decision immediately (so a restored embed reappears behind the
   *  dialog rather than after it), then play the dialog out.
   *
   *  The ticks only bite on Delete. Cancel means "forget I did any of this", and
   *  quietly switching off a safety net while someone backs out of using it is
   *  exactly the kind of thing that safety net exists to prevent. */
  const closeMediaConfirm = (restore: boolean): void => {
    if (confirmClosing) return
    const file = mediaConfirm?.file
    if (restore) mediaConfirm?.restore()
    else {
      if (!keepAsking) void changeSettings({ confirmMediaDelete: false })
      // No undo offered here — they were asked, and Cancel was the way out.
      const origin = mediaConfirm?.origin ?? null
      if (file) void run(async () => void (await binMedia(file, origin)))
    }
    setConfirmClosing(true)
  }
  useEffect(() => {
    if (!mediaConfirm || confirmClosing) return
    const onKey = (e: KeyboardEvent): void => {
      // Escape is Cancel, not dismiss: leaving the media deleted because
      // someone pressed Escape would be the dialog answering for them.
      //
      // Enter is deliberately NOT bound. It used to mean Delete, which put the
      // most destructive answer on the key people hit to make a dialog go away
      // — and it now bins a file, not just some text. Focus starts on Cancel
      // (below), so Enter still does something sensible; it just does the safe
      // thing, and Delete has to be aimed at.
      if (e.key === 'Escape') {
        e.preventDefault()
        closeMediaConfirm(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mediaConfirm, confirmClosing, keepAsking])

  /** The index as it stands now: what main read from disk, with the open buffers
   *  laid over it. `openLinkVersion` is what re-runs this — deliberately not
   *  every keystroke, only the ones that changed a link. */
  const linkIndex = useMemo(
    () => liveIndex(linkRows, new Map(docsRef.current)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [linkRows, openLinkVersion, layout.tabs]
  )

  /** Which notes hold which photos, off the same scan — see media/usage.ts.
   *  This is the app KNOWING a picture is in a note, rather than trusting a
   *  breadcrumb written when one was deleted. */
  const mediaUsage_ = useMemo(() => mediaUsage(linkIndex), [linkIndex])
  /** Other notes that will lose their picture if this delete goes through.
   *  Plain, not memoised: a map lookup and a filter over at most a handful of
   *  paths, recomputed only while a dialog is actually open. */
  const alsoUsedBy = otherNotesUsing(mediaUsage_, mediaConfirm?.file ?? null, mediaConfirm?.origin?.note)

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
      const [v, onboarded, resumeStep] = await Promise.all([
        window.api.getVault(),
        window.api.getOnboarded(),
        window.api.getOnboardingStep()
      ])
      setVault(v)
      setHasOnboarded(onboarded)
      // Eagerly, not waiting for the re-render the setState above schedules:
      // syncSpaces is called further down IN THIS SAME PASS and reads the ref,
      // so leaving it at `null` until React re-renders would make the very
      // first sync of an already-onboarded vault skip the "no real spaces —
      // make one" fallback it exists for.
      hasOnboardedRef.current = onboarded
      // Validated against the current STEPS list rather than trusted as-is —
      // a step name from a build that no longer has it (e.g. the removed
      // 'walkthrough') would otherwise render nothing at all.
      if (resumeStep && (STEPS as readonly string[]).includes(resumeStep)) {
        setOnboardingResumeStep(resumeStep as StepId)
      }
      // Three independent reads (tree walk, workspace.json, settings.json) —
      // run concurrently rather than summing their latencies, which matters on
      // a large or slow-syncing vault (see MAX_MS in StartupSplash.tsx).
      let loadedTree: TreeNode[] = []
      let s: AppSettings
      if (v) {
        const [t, , loadedSettings] = await Promise.all([loadTree(), loadWorkspace(), loadSettings(v)])
        loadedTree = t
        s = loadedSettings
      } else {
        s = await loadSettings(null)
      }
      // Only now, not before the settings read above: Onboarding (which reads
      // `ready`) also reads `space.theme` for its Welcome-screen clip, and
      // rendering that off DEFAULT_SETTINGS's optimistic default rather than
      // the real loaded value picked the wrong clip once during testing —
      // same class of bug the comment below already guards for splashActive.
      setReady(true)
      // Gated on the just-loaded REAL settings, not the optimistic default —
      // triggering off the default and correcting a moment later flashed the
      // splash on and yanked it off mid-clip for anyone who'd turned it off.
      // Also gated on onboarding already being done: Onboarding's Welcome
      // screen plays this same clip itself, so the ambient one stays off
      // until that flow has actually finished.
      if (v && s.playStartupAnimation && onboarded) setSplashActive(true)
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

  // Any space left on 'system' (the default for a brand-new one — see
  // DEFAULT_SPACE) should re-skin live if the OS is switched while the app is
  // open, not just at next launch. `applySettings` re-resolves 'system' itself
  // and is a no-op paint for a space pinned to a fixed theme, so this can fire
  // unconditionally rather than checking the active space's theme first.
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const mql = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (): void => applySettings(settingsRef.current)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])

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
    // Captured before the await: true only for the very first "Choose folder…"
    // pick, never for "Switch folder" in Settings, which only exists once a
    // vault is already open. That's what keeps the splash a startup moment
    // rather than something a mid-session vault switch retriggers.
    const firstRun = !vault
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
      // Image AND video blobs are keyed by vault-RELATIVE path, so the same
      // "Import/photo.png" names a different file in a different vault — a kept
      // cache would show the previous vault's picture. Also frees the blobs.
      // One call for both: this used to clear only the images, so a switch
      // between two vaults sharing a relative path played the old vault's video.
      clearAssetCaches()
      // Three independent reads, run concurrently rather than summed — see the
      // identical pattern (and why) in the boot effect above.
      const [t, , s] = await Promise.all([loadTree(), loadWorkspace(), loadSettings(v)])
      // Via the ref, not the render closure: this line runs after an await, and
      // the last onboarding step's vault pick lands right beside the settings
      // write that flips the flag — reading a value captured before the await
      // could show or hide the splash on the losing side of that race.
      if (firstRun && s.playStartupAnimation && hasOnboardedRef.current) setSplashActive(true)
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

  /** Runs once, ever, when onboarding finishes — called as Onboarding.tsx's
   *  `onFinished`, and awaited BEFORE it plays its own closing fade (see that
   *  file's `closing`/onDismissed split, added 2026-08-21). That ordering is
   *  why this does NOT flip `hasOnboarded` itself any more: the app shell
   *  underneath is already mounted the whole time onboarding is up, so doing
   *  all the real work here — while the overlay is still fully visible —
   *  means the shell has already updated (welcome note open, sidebar
   *  populated) by the time the fade reveals it. Flipping `hasOnboarded` here
   *  instead would unmount the overlay immediately, before that fade ever
   *  gets to play, and reveal a still-blank pane a beat before the note pops
   *  in. `onDismissed` (wired below, alongside `hasOnboardedRef`'s eager
   *  update) is what actually flips it, once the fade has finished.
   *
   *  Two jobs otherwise: seed the curated welcome notes into whatever space
   *  is active right now (the "main" space Spaces created — imports always
   *  land in their OWN space, so the two never clash), then decide which
   *  note the real workspace opens on.
   *
   *  `importNotePath` is set only when a real import ran during onboarding
   *  (Onboarding.tsx's ImportStep) — its "how this import is organised" note
   *  lives in the imported space, which by now is very likely no longer
   *  active (SpacesStep switches to the first space it creates). That one
   *  takes priority: switch back to it and open it, the same "a note takes
   *  you to its own space" rule `openLink` follows for any other cross-space
   *  note. Nothing imported (or Import was skipped) means importNotePath is
   *  null, and the welcome note just seeded is what opens instead — this
   *  used to be a plain empty landing, and before that, a "Three things worth
   *  knowing" screen (Walkthrough, cut 2026-08-20) whose links (Tutorials,
   *  Report a bug, Request a feature) now live in that note's own text. */
  const finishOnboarding = async (importNotePath: string | null): Promise<void> => {
    const homeSpaceFolder = settingsRef.current.activeSpaceFolder
    let welcomeNotePath: string | null = null
    try {
      welcomeNotePath = await seedWelcomeNotes(homeSpaceFolder)
      await loadTree()
    } catch (e) {
      // A first-run nicety, not a load-bearing feature — a failure here must
      // not strand the user mid-onboarding with no way into their own app.
      flash(`Couldn't set up the welcome notes: ${(e as Error).message}`)
    }
    await window.api.setOnboarded(true)
    await window.api.setOnboardingStep(null)
    if (importNotePath) {
      // enterSpace, not switchSpace: if the imported folder isn't a registered
      // space yet, switching to it would leave the note opening into a pane
      // with no layout behind it. Staying put and opening the note is the
      // honest fallback — same rule openLink follows.
      await enterSpace(spaceOf(importNotePath))
      await openNote(importNotePath)
    } else if (welcomeNotePath) {
      await openNote(welcomeNotePath)
    }
  }

  /** Onboarding's Fonts step, applied to EVERY space rather than just the
   *  active one. Picking a font before you've really met the idea of spaces is
   *  an answer to "how should this app look", not "how should this one folder
   *  look" — the whole-app scope Customisation offers later, reached from a
   *  screen that hasn't introduced the per-space one yet. One write across all
   *  of them, not a loop: each setSettings is a full read-modify-write of
   *  settings.json (same reasoning as the preset ALL_SPACES path above). */
  const pickOnboardingFont = (id: string): void => {
    const current = settingsRef.current
    void changeSettings({ spaces: current.spaces.map((sp) => ({ ...sp, font: id })) })
  }

  /** Same reasoning as pickOnboardingFont, for the accent swatch added to
   *  onboarding's Fonts step 2026-08-20 — applied to every space, not just
   *  the active one. */
  const pickOnboardingAccent = (id: string): void => {
    const current = settingsRef.current
    void changeSettings({ spaces: current.spaces.map((sp) => ({ ...sp, accent: id })) })
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
   *  sidecar, since the filesystem alone is only alphabetical.
   *
   *  A move that crosses from one space's subtree into a different one is
   *  blind from the destination's point of view — the user was looking at the
   *  space they dragged FROM, not the tree they dropped into (whether that's
   *  a space tab or a subfolder reached by hovering one open), so an `anchor`
   *  position, alphabetical order, or free-arrange mixing would bury it. Those
   *  land at the very front instead, stamped `movedAt` so the sidebar can hold
   *  them under a small "Moved" divider (`organise/model.ts`'s `splitMoved`)
   *  until the user files them properly. An ordinary same-space move — a
   *  reorder, or dragging one of those moved items into its final spot —
   *  clears the flag: that action IS "sorting it into what's next". */
  const move = (paths: string[], toDir: string, anchor: string | null, after: boolean): void =>
    void run(async () => {
      const toSpace = spaceFolderOf(toDir, settings.spaces)

      const landed: string[] = []
      // Which of the landed entries genuinely arrived from ANOTHER space,
      // tracked per item rather than as one flag for the whole batch. A mixed
      // multi-select — one note already living in the destination folder,
      // dragged alongside one really coming from elsewhere — used to mark the
      // whole batch cross-space, so the resident note was stamped `movedAt` and
      // turned up under the sidebar's "Moved" divider without having moved
      // anywhere.
      const arrived: string[] = []
      for (const from of paths) {
        if (toDir === from || toDir.startsWith(from + '/')) continue // into self/descendant
        const crossed = spaceFolderOf(from, settings.spaces) !== toSpace
        const dest = joinPath(toDir, nameOf(from))
        if (dest === from) {
          landed.push(from) // already in this folder — a pure reorder, never crossed
          continue
        }
        const actual = await window.api.renameEntry(from, dest)
        remapOpen(from, actual)
        landed.push(actual)
        if (crossed) arrived.push(actual)
      }
      // The blind-drop positioning below is still decided for the drag as a
      // whole: if any of it crossed a space boundary, the destination isn't the
      // list the user was looking at, and the group belongs together at the
      // front. Only the `movedAt` stamp is per item.
      const crossSpace = arrived.length > 0
      const fresh = await window.api.listTree()
      setTree(fresh)

      // Re-sequence the destination folder: take its children in display order,
      // pull out the ones that moved, and splice them back at the anchor — or,
      // for a cross-space arrival, at the very front, ignoring the anchor.
      const siblings =
        toDir === '' ? fresh : (findNode(fresh, toDir)?.children ?? [])
      const ws = await window.api.getWorkspace()
      const ordered = sortSiblings(siblings, ws, false).map((n) => n.path)
      const moved = new Set(landed)
      const rest = ordered.filter((p) => !moved.has(p))
      let at = rest.length
      if (crossSpace) {
        at = 0
      } else if (anchor) {
        const i = rest.indexOf(anchor)
        if (i >= 0) at = after ? i + 1 : i
      }
      const next = [...rest.slice(0, at), ...landed.filter((p) => ordered.includes(p)), ...rest.slice(at)]
      let nextWs = await window.api.reorderEntries(next)

      if (arrived.length) {
        nextWs = await window.api.updateEntries(arrived, { movedAt: Date.now() })
      }
      // Everything else in the batch is an ordinary move within this space,
      // which CLEARS a stale flag — that action IS the user filing it. Both
      // halves run for a mixed drag, which is the whole point of splitting them.
      // Merging an explicit `undefined` drops the field (see `setColor` below)
      // — the same way un-archiving clears `archivedAt`.
      const settled = landed.filter(
        (p) => !arrived.includes(p) && ws.entries[p]?.movedAt !== undefined
      )
      if (settled.length) nextWs = await window.api.updateEntries(settled, { movedAt: undefined })
      setWorkspace(nextWs)
    })

  const togglePin = (paths: string[], pinned: boolean): void =>
    void run(async () =>
      setWorkspace(
        await window.api.updateEntries(paths, {
          pinned,
          // Same reasoning as `setArchived` just below: pinning a just-arrived
          // item is a decision about it, so it doesn't resurface under
          // "Moved" with a stale timestamp if it's later unpinned.
          ...(pinned ? { movedAt: undefined } : {})
        })
      )
    )

  const setArchived = (paths: string[], archived: boolean): void =>
    void run(async () =>
      setWorkspace(
        await window.api.updateEntries(paths, {
          archived,
          archivedAt: archived ? Date.now() : undefined,
          // Archiving is itself a decision about a just-arrived item — the
          // same "sorted into what's next" signal an ordinary move clears
          // (see `move`'s comment) — so it doesn't resurface under "Moved"
          // with a stale timestamp the next time it's restored.
          ...(archived ? { movedAt: undefined } : {})
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

  /** Put a restored photo's markdown back into the note it came out of.
   *
   *  Reports which of three things happened, because the notice has to say it.
   *  Someone who restores a picture and then can't find it in the note is worse
   *  off than someone who is told where it went — and the note is allowed to
   *  have changed completely in the seven days this can sit in recovery.
   *
   *  Aims at the exact line and column it was cut from, and re-inserts the exact
   *  text, so a photo that sat mid-sentence goes back mid-sentence. If the note
   *  has shrunk past that point the text goes on the end instead, which is the
   *  one place it is certain not to land inside something else. */
  const putMediaBack = async (
    m: MediaOrigin,
    /** where the file REALLY came back to — see RestoreResult.landed */
    landed: string
  ): Promise<MediaLanding | 'missing'> => {
    // Unsaved keystrokes have to reach disk first: this reads the note and
    // writes it back, so anything still sitting in the buffer would be erased.
    await flush()
    let doc: string
    try {
      doc = await window.api.readNote(m.note)
    } catch {
      return 'missing'
    }
    const { doc: next, how } = spliceMediaBack(doc, { ...m, text: retarget(m, landed) })
    await window.api.writeNote(m.note, next)
    // Re-seed whichever pane is showing it; a no-op when it isn't open.
    await loadDoc(m.note)
    return how
  }

  /** Point a restored embed at the file that now exists.
   *
   *  `from` is a promise restore can't always keep: if something has taken that
   *  name since, main suffixes rather than overwrites. Putting the original text
   *  back then gives the note a picture pointing at a file that isn't there —
   *  the failure looks like "restore is broken" and says nothing. Same encoding
   *  as attachInput writes, from the same function, so the two can't disagree. */
  const retarget = (m: MediaOrigin, landed: string): string => {
    const promised = m.text
    const dir = m.note.includes('/') ? m.note.slice(0, m.note.lastIndexOf('/')) : ''
    const rel = dir && landed.startsWith(dir + '/') ? landed.slice(dir.length + 1) : landed
    const target = encodeTarget(rel)
    return promised
      .replace(/(!\[[^\]\n]*\]\()[^)\n]*(\))/, `$1${target}$2`)
      .replace(/(\bsrc=["'])[^"']*(["'])/i, `$1${target}$2`)
  }

  /** Go and look at something that has just come back. A note opens; a folder is
   *  revealed in the sidebar; a photo opens the NOTE it went back into, which is
   *  the only place looking at it means anything. */
  const navigateToRestored = (item: TrashItem | RecoveryItem): void => {
    if (item.media) void openLink(item.media.note, 'replace')
    else if (item.type === 'dir') void reveal(item.from)
    else if (item.from.toLowerCase().endsWith('.md')) void openLink(item.from, 'replace')
    else void reveal(item.from.includes('/') ? item.from.slice(0, item.from.lastIndexOf('/')) : '')
  }

  /** Shared by the bin's Restore and Settings → Recovery's, because "where did
   *  that go?" is the same question at both stages. The items are read BEFORE
   *  the restore, since the call is what removes them from the list. */
  const afterRestore = async (
    items: (TrashItem | RecoveryItem)[],
    landed: Record<string, string>
  ): Promise<void> => {
    const back = items.filter(Boolean)
    if (!back.length) return
    // Every photo goes back into its note, but the strip describes — and
    // navigates to — ONE of them. The same one, deliberately: a bulk restore
    // that reads out the last item and then jumps to the first is a small lie
    // that costs someone a hunt through the wrong note.
    let said: { text: string; item: TrashItem | RecoveryItem } | null = null
    for (const item of back) {
      if (!item.media) continue
      const how = await putMediaBack(item.media, landed[item.id] ?? item.from)
      if (said) continue
      const title = titleOf(item.media.note)
      said = {
        item,
        // Each of these is a claim about where a picture now is, and someone
        // reads it INSTEAD of going to look. "Where it was" used to be printed
        // for every landing including a stale-coordinate guess, which is how a
        // photo ended up above the note's heading under a notice saying it
        // hadn't moved. Only `anchored` earns that sentence now.
        text:
          how === 'missing'
            ? `${title} no longer exists, so only the file came back`
            : how === 'appended'
              ? `Added to the end of ${title} — the note changed too much to place it`
              : how === 'aimed'
                ? `Back in ${title}, near where it was — the note changed since`
                : `Back in ${title}, where it was`
      }
    }
    const target = said?.item ?? back[0]
    showNotice({
      text:
        said?.text ??
        (back.length > 1 ? `${back.length} items restored` : `${back[0].name} restored`),
      // Not a question in a box: restoring isn't destructive and a modal after
      // every single one — including a bulk restore — would wear thin fast.
      action: { label: 'Navigate', run: () => navigateToRestored(target) }
    })
  }

  const restoreFromBin = (ids: string[]): void =>
    void run(async () => {
      const items = ids.map((id) => workspace.trash.find((t) => t.id === id)).filter((t): t is TrashItem => !!t)
      const res = asRestoreResult(await window.api.restoreEntries(ids))
      if (!res) return void flash("Couldn't put that back — restart the app and try again")
      setWorkspace(res.workspace)
      await loadTree()
      await afterRestore(items, res.landed)
    })

  const purge = (ids?: string[]): void =>
    void run(async () => setWorkspace(await window.api.purgeEntries(ids)))

  // The 7-day safety net items purging the bin now land in, Settings-only
  // (see shared/workspace.ts's RecoveryItem / RECOVERY_TTL_MS).
  const restoreRecovery = (ids: string[]): void =>
    void run(async () => {
      const items = ids
        .map((id) => workspace.recovery.find((r) => r.id === id))
        .filter((r): r is RecoveryItem => !!r)
      const res = asRestoreResult(await window.api.restoreRecoveryEntries(ids))
      if (!res) return void flash("Couldn't put that back — restart the app and try again")
      setWorkspace(res.workspace)
      await loadTree()
      await afterRestore(items, res.landed)
    })

  const purgeRecovery = (ids?: string[]): void =>
    void run(async () => setWorkspace(await window.api.purgeRecoveryEntries(ids)))

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
    if (!vault || splashActive) return
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
      // Nothing may move the note out from under a delete that is waiting to be
      // confirmed — see mediaConfirmRef.
      if (splashActiveRef.current || mediaConfirmRef.current) return
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

  // Dev only, and once: does the process behind this window understand it? See
  // boot.ts — this is the check that would have named the blank-window bug in
  // one glance instead of two rounds of debugging.
  useEffect(() => {
    void checkMainIsCurrent(flash)
  }, [flash])

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

  if (!ready || hasOnboarded === null) return <div className="center muted">Loading…</div>

  // A vault-less, already-onboarded install means the saved folder went
  // missing (moved/deleted) — the plain recovery picker, not the full flow
  // again. A vault-less, not-yet-onboarded install falls through to
  // Onboarding below instead, which owns its own vault-picking screen.
  if (!vault && hasOnboarded) {
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
    <>
      {!hasOnboarded && (
        <Onboarding
          vault={vault}
          activeSpaceFolder={space.folder}
          theme={resolveTheme(space.theme)}
          animationsEnabled={settings.animationsEnabled}
          noteFont={space.font}
          accent={space.accent}
          initialStep={onboardingResumeStep}
          onPickVault={pick}
          onOpenSpace={(folder) => openSpaceRef.current(folder)}
          onPickNoteFont={pickOnboardingFont}
          onPickAccent={pickOnboardingAccent}
          onFinished={(path) => finishOnboarding(path)}
          onDismissed={() => {
            setHasOnboarded(true)
            hasOnboardedRef.current = true // same eager update as the boot effect's
          }}
        />
      )}
      {splashActive && (
        <StartupSplash theme={resolveTheme(space.theme)} onFinished={() => setSplashActive(false)} />
      )}
      {vault && (
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
        onRestoreRecovery={restoreRecovery}
        onPurgeRecovery={purgeRecovery}
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
                  linksPosition={space.linksPosition}
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
                  // Beside `rawView` in the same sidecar, for the same reasons
                  // — and separate from it, because the two are usefully on at
                  // the same time (shared/workspace.ts's EntryMeta).
                  mediaSource={!!workspace.entries[p]?.mediaSource}
                  onToggleMediaSource={() =>
                    void run(async () =>
                      setWorkspace(
                        await window.api.updateEntry(p, {
                          mediaSource: !workspace.entries[p]?.mediaSource
                        })
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

      {notice && (
        <div className="notice">
          <span>{notice.text}</span>
          {notice.action && (
            <button
              type="button"
              className="notice-action"
              onClick={() => {
                notice.action?.run()
                setNotice(null)
              }}
            >
              {notice.action.label}
            </button>
          )}
        </div>
      )}

      {mediaConfirm && (
        <div
          className={'confirm-backdrop' + (confirmClosing ? ' closing' : '')}
          onClick={() => closeMediaConfirm(true)}
        >
          <div
            className={'prompt confirm' + (confirmClosing ? ' closing' : '')}
            role="dialog"
            aria-modal="true"
            aria-label="Delete media?"
            onClick={(e) => e.stopPropagation()}
            onAnimationEnd={() => {
              // Fires for the entrance too, hence the guard.
              if (!confirmClosing) return
              setMediaConfirm(null)
              setConfirmClosing(false)
              setKeepAsking(true)
            }}
          >
            <div className="prompt-title">Delete media?</div>
            <p className="mt-1 text-[12.5px] leading-relaxed text-ink-500">
              {mediaConfirm.file
                ? 'It goes to the bin, so you can still get it back.'
                : 'It comes out of this note. Nothing on your computer changes.'}
            </p>
            {/* The one thing the dialog could not say until the app kept an
                index of which notes hold which photos: this file is somebody
                else's picture too, and deleting it here breaks it there. It
                doesn't block the delete — the bin is right there — but it must
                not happen silently. */}
            {alsoUsedBy.length > 0 && (
              <p className="confirm-warn">
                {alsoUsedBy.length === 1
                  ? `It's also in ${titleOf(alsoUsedBy[0])}, which will lose its picture.`
                  : `It's also in ${alsoUsedBy.length} other notes, which will lose their picture.`}
              </p>
            )}
            {/* Same tick as Settings -> Spaces -> Delete space -> "and its saved
                look": an extra choice hanging off a destructive action, rather
                than the pill Switch, which is this app's vocabulary for a
                standing setting on a settings row.
                TWO of them, on one switch, because "never ask again" alone only
                shows the way OUT of being asked — the state you are actually in
                is left to be inferred from an empty box. Spelling out both sides
                is what makes it a choice rather than an opt-out. */}
            <div className="mt-3 flex flex-col items-start gap-0.5">
              <TickRow on={keepAsking} onClick={() => setKeepAsking(true)} label="Always ask" />
              <TickRow
                on={!keepAsking}
                onClick={() => setKeepAsking(false)}
                label="Never ask again"
              />
            </div>
            <div className="prompt-actions">
              {/* Focused on open, and the FIRST thing focused, for two reasons.
                  The editor still has focus at this point (selectEmbed called
                  view.focus()), and the backdrop only stops the mouse — so
                  without this, typing while the dialog is up lands in the note
                  behind it and moves the very offset Cancel restores to. And a
                  dialog that has to be answered should be answerable from the
                  keyboard, safe side first. */}
              {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
              <button autoFocus onClick={() => closeMediaConfirm(true)}>
                Cancel
              </button>
              <button className="danger" onClick={() => closeMediaConfirm(false)}>
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

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
      )}
    </>
  )
}
