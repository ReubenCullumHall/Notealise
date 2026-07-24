import type { VaultApi } from '../shared/types'

// Makes `window.api` fully typed in the renderer.
declare global {
  interface Window {
    api: VaultApi
  }
}

export {}
