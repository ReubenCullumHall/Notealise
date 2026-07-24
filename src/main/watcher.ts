import chokidar, { type FSWatcher } from 'chokidar'
import path from 'node:path'
import type { VaultChange } from '../shared/types'
import { wasRecentlyWritten } from './vault'

let watcher: FSWatcher | null = null

// Watch the vault and push debounced external-change batches to the renderer.
// - ignores dotfiles/dot-folders (incl. .mdnotes/) and node_modules
// - ignores echoes of the app's own writes (recentWrites in vault.ts)
// - debounces ~100ms so a burst of fs events becomes one renderer update
export function startWatching(root: string, onChange: (change: VaultChange) => void): void {
  stopWatching()

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

export async function stopWatching(): Promise<void> {
  if (watcher) {
    await watcher.close()
    watcher = null
  }
}
