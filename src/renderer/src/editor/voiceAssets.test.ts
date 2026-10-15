import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearAssetCaches } from './assetCache'
import { cachedVoiceUrl, loadVoice, onVoiceReset, waveFor } from './voiceAssets'

// The vault switch has to drop recordings with everything else — assetCache.test.ts
// explains why (the keys are vault-RELATIVE, so `memo.m4a` is another vault's
// file after a switch) and how the video cache once missed it. Asserted through
// the real module for the same reason: the risk is a module not being wired up,
// not the clearing itself. Two things are voice-note-only: the players have to
// stop BEFORE the blobs they are playing are revoked, and each recording's
// waveform has to go too.
describe('the vault switch and voice notes', () => {
  const revoked: string[] = []

  beforeEach(() => {
    let n = 0
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: () => `blob:test/${++n}`,
      revokeObjectURL: (u: string) => void revoked.push(u)
    })
    vi.stubGlobal('window', { api: { readAsset: async () => new Uint8Array([1, 2, 3]) } })
    revoked.length = 0
  })

  afterEach(() => {
    clearAssetCaches()
    vi.unstubAllGlobals()
  })

  it('drops recordings with every other cached asset', async () => {
    await loadVoice('Rec/memo.m4a')
    expect(cachedVoiceUrl('Rec/memo.m4a')).toBeDefined()
    clearAssetCaches()
    expect(cachedVoiceUrl('Rec/memo.m4a')).toBeUndefined()
  })

  it('stops the players first, while the blobs they play still exist', async () => {
    await loadVoice('Rec/memo.m4a')
    const seen: number[] = []
    onVoiceReset(() => seen.push(revoked.length))
    clearAssetCaches()
    expect(seen).toEqual([0])
    expect(revoked).toHaveLength(1)
  })

  it('forgets each recording’s waveform too', () => {
    const first = waveFor('Rec/memo.m4a')
    expect(waveFor('Rec/memo.m4a')).toBe(first) // decoded once, then kept
    clearAssetCaches()
    expect(waveFor('Rec/memo.m4a')).not.toBe(first)
  })

  it('refuses to decode a file over the size it was given', async () => {
    expect(await waveFor('Rec/big.m4a', 2)).toBeNull()
  })
})
