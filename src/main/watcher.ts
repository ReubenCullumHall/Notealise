import chokidar, { type FSWatcher } from 'chokidar'
import path from 'node:path'
import type { VaultChange } from '../shared/types'
import { setWatcherRelease, wasRecentlyWritten } from './vault'

let watcher: FSWatcher | null = null
// What the watcher was started with, kept so it can be started again after a pause.
let current: { root: string; onChange: (change: VaultChange) => void } | null = null

// Watch the vault and push debounced external-change batches to the renderer.
// - ignores dotfiles/dot-folders (incl. .mdnotes/) and node_modules
// - ignores echoes of the app's own writes (recentWrites in vault.ts)
// - debounces ~100ms so a burst of fs events becomes one renderer update
export function startWatching(root: string, onChange: (change: VaultChange) => void): void {
  void closeWatcher()
  current = { root, onChange }

  const batch = new Set<string>()
  let timer: NodeJS.Timeout | null = null
  const flush = (): void => {
    timer = null
    const paths = [...batch]
    batch.clear()
    if (paths.length) onChange({ paths })
  }
  const schedule = (): void => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(flush, 100)
  }

  const toRel = (abs: string): string => path.relative(root, abs).split(path.sep).join('/')

  // Windows fires 'change' mid-write, which hands us a truncated file — wait for
  // the size to stabilise before emitting. Network drives (UNC paths) don't emit
  // reliable fs events, so fall back to polling there.
  const isUnc = root.startsWith('\\\\')
  watcher = chokidar.watch(root, {
    ignoreInitial: true,
    ignored: (p: string) => {
      const base = path.basename(p)
      return base.startsWith('.') || base === 'node_modules'
    },
    awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
    usePolling: isUnc,
    interval: isUnc ? 300 : undefined
  })

  watcher.on('all', (event, abs) => {
    // file events only matter for .md; dir add/remove always matter (tree shape)
    if (event === 'add' || event === 'change' || event === 'unlink') {
      if (!abs.toLowerCase().endsWith('.md')) return
    }
    if (wasRecentlyWritten(abs)) return // our own write — don't echo
    batch.add(toRel(abs))
    schedule()
  })
}

async function closeWatcher(): Promise<void> {
  const w = watcher
  watcher = null
  if (w) await w.close()
}

export async function stopWatching(): Promise<void> {
  current = null
  await closeWatcher()
}

// Windows refuses to rename or move a folder while anything holds a handle on a
// folder beneath it, and this watcher holds one on every folder in the vault. So
// a folder rename asks (vault.ts `renameWithRetry`, only after its first attempt
// has been refused) for the watcher to let go for the length of the rename, and
// to start again after. Never called for files, so ordinary saves don't pay for it.
setWatcherRelease(async () => {
  const cur = current
  if (!watcher || !cur) return () => {}
  await closeWatcher()
  return () => {
    // a vault switch or a quit in the meantime wins
    if (current === cur && !watcher) startWatching(cur.root, cur.onChange)
  }
})
