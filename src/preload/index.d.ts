import type { VaultApi } from '../shared/types'
import type { ThemeCache } from '../shared/settings'

// Makes `window.api` fully typed in the renderer. `mdnotesTheme` is the
// pre-paint cache (see preload/index.ts) — optional because it falls back to
// the static dark/cozy default in index.html if the sync IPC call ever fails.
declare global {
  interface Window {
    api: VaultApi
    mdnotesTheme?: ThemeCache
  }
}

export {}
