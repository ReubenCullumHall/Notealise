import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearAssetCaches, createAssetCache } from './assetCache'
import { cachedUrl, loadImage } from './imageAssets'
import { cachedVideoUrl, loadVideo } from './videoAssets'

// The vault switch has to drop EVERY kind of cached asset, and this file exists
// because the failure it guards is invisible in the UI until two conditions
// coincide.
//
// Addresses are keyed by vault-RELATIVE path, so "Import/clip.mp4" names a
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
  /** every file whose BYTES the window asked for */
  const bytesAsked: string[] = []
  /** every blob the window made */
  let blobsMade = 0

  beforeEach(() => {
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: () => `blob:test/${++blobsMade}`,
      revokeObjectURL: () => {}
    })
    vi.stubGlobal('window', {
      api: {
        mediaUrl: async (p: string) => `notealise-media://test/?p=${encodeURIComponent(p)}&v=1`,
        readAsset: async (p: string) => {
          bytesAsked.push(p)
          return new Uint8Array([1, 2, 3])
        }
      }
    })
    bytesAsked.length = 0
    blobsMade = 0
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

  // The memory fix of 2026-11-11 (docs/app-check-2026-11-09.md item 2). A blob
  // holds the whole file in memory until it is revoked, and these were revoked
  // only on a vault switch — so every picture and video ever opened stayed for
  // the life of the app. What is kept now is an address main serves from; the
  // file's bytes must never be pulled into the window to show it.
  it('keeps an address, and never pulls the file into the window', async () => {
    const photo = await loadImage('Import/photo.png')
    const clip = await loadVideo('Import/clip.mp4')
    expect(photo).toMatch(/^notealise-media:/)
    expect(clip).toMatch(/^notealise-media:/)
    expect(bytesAsked).toEqual([])
    expect(blobsMade).toBe(0)
  })

  it('answers null for a file that is not there, after one more try', async () => {
    let asks = 0
    vi.stubGlobal('window', {
      api: {
        mediaUrl: async () => {
          asks++
          throw new Error('ENOENT')
        }
      }
    })
    expect(await loadImage('Import/gone.png')).toBeNull()
    expect(asks).toBe(2)
    expect(cachedUrl('Import/gone.png')).toBeUndefined()
  })

  // A big file pasted in is still being written when its widget first asks.
  it('finds a file that arrives a moment late', async () => {
    let asks = 0
    vi.stubGlobal('window', {
      api: {
        mediaUrl: async (p: string) => {
          if (++asks === 1) throw new Error('ENOENT')
          return `notealise-media://test/?p=${encodeURIComponent(p)}&v=1`
        }
      }
    })
    expect(await loadVideo('Import/late.mp4')).toMatch(/^notealise-media:/)
  })

  // A cache told to hold bytes (recordings — voiceAssets.ts) still frees every
  // one of them on the vault switch: dropping the map without revoking would
  // leave each file resident for the life of the app.
  it('revokes the blobs of a cache that holds bytes', async () => {
    const revoked: string[] = []
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: () => `blob:test/${++blobsMade}`,
      revokeObjectURL: (u: string) => void revoked.push(u)
    })
    const held = createAssetCache('bytes')
    const a = await held.load('Rec/a.m4a')
    const b = await held.load('Rec/b.m4a')
    expect(bytesAsked).toEqual(['Rec/a.m4a', 'Rec/b.m4a'])
    clearAssetCaches()
    expect(revoked.sort()).toEqual([a, b].sort())
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
