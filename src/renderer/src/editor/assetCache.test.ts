import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearAssetCaches, createAssetCache } from './assetCache'
import { cachedUrl, loadImage } from './imageAssets'
import { cachedVideoUrl, loadVideo } from './videoAssets'

// The vault switch has to drop EVERY kind of cached asset, and this file exists
// because the failure it guards is invisible in the UI until two conditions
// coincide.
//
// Blob URLs are keyed by vault-RELATIVE path, so "Import/clip.mp4" names a
// different file in a different vault. The video cache started life as a
// hand-written copy of the image one, and its `clear` was never wired to the
// vault switch the image one had been wired to for months — so switching
// between two vaults that happened to share a relative path played the OLD
// vault's video. `createAssetCache` registering every cache it makes is what
// stops that recurring, and this test is what stops someone hand-writing a
// third cache and forgetting again.
//
// Deliberately asserted through the real `imageAssets`/`videoAssets` modules
// rather than two anonymous caches: the bug was never in the clearing, it was
// in a module not being wired to it, and only importing the actual modules can
// catch that.
describe('clearAssetCaches', () => {
  const made: string[] = []
  const revoked: string[] = []

  beforeEach(() => {
    let n = 0
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: () => {
        const url = `blob:test/${++n}`
        made.push(url)
        return url
      },
      revokeObjectURL: (u: string) => void revoked.push(u)
    })
    vi.stubGlobal('window', { api: { readAsset: async () => new Uint8Array([1, 2, 3]) } })
    made.length = 0
    revoked.length = 0
  })

  afterEach(() => {
    clearAssetCaches()
    vi.unstubAllGlobals()
  })

  it('drops the IMAGE cache', async () => {
    await loadImage('Import/photo.png')
    expect(cachedUrl('Import/photo.png')).toBeDefined()
    clearAssetCaches()
    expect(cachedUrl('Import/photo.png')).toBeUndefined()
  })

  // The half that was missing. If this passes and the one above fails, someone
  // has wired the caches up backwards; if this one alone fails, the video cache
  // has been unhooked again.
  it('drops the VIDEO cache too', async () => {
    await loadVideo('Import/clip.mp4')
    expect(cachedVideoUrl('Import/clip.mp4')).toBeDefined()
    clearAssetCaches()
    expect(cachedVideoUrl('Import/clip.mp4')).toBeUndefined()
  })

  it('clears both in one call, which is the whole point', async () => {
    await loadImage('Import/photo.png')
    await loadVideo('Import/clip.mp4')
    clearAssetCaches()
    expect(cachedUrl('Import/photo.png')).toBeUndefined()
    expect(cachedVideoUrl('Import/clip.mp4')).toBeUndefined()
  })

  // Not tidiness: a blob URL holds the whole file in memory until it is
  // revoked, and video is read whole. Dropping the map without revoking would
  // leave every video ever opened resident for the life of the app.
  it('revokes the URLs rather than just forgetting them', async () => {
    await loadImage('Import/photo.png')
    await loadVideo('Import/clip.mp4')
    clearAssetCaches()
    expect(revoked.sort()).toEqual(made.sort())
  })

  it('clears any cache the factory makes, not just the two named ones', async () => {
    const extra = createAssetCache()
    await extra.load('Import/other.png')
    expect(extra.cached('Import/other.png')).toBeDefined()
    clearAssetCaches()
    expect(extra.cached('Import/other.png')).toBeUndefined()
  })

  it('is safe to call when nothing has been loaded', () => {
    expect(() => clearAssetCaches()).not.toThrow()
  })
})
