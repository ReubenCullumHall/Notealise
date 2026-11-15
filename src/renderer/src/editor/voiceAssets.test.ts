import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearAssetCaches } from './assetCache'
import { cachedVoiceUrl, dropWave, forgetVoice, loadVoice, onVoiceReset, waveFor } from './voiceAssets'

// The vault switch has to drop recordings with everything else — assetCache.test.ts
// explains why (the keys are vault-RELATIVE, so `memo.m4a` is another vault's
// file after a switch) and how the video cache once missed it. Asserted through
// the real module for the same reason: the risk is a module not being wired up,
// not the clearing itself. Two things are voice-note-only: the players have to
// stop BEFORE the blobs they are playing are revoked, and each recording's
// waveform has to go too.
describe('the vault switch and voice notes', () => {
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

  // The memory fix of 2026-11-11 (docs/app-check-2026-11-09.md item 2), the
  // recordings' half. A recording is held whole so the tape can play it to the
  // end whatever happens to its file — but it used to be held until the vault
  // switched, i.e. every recording ever played, for as long as the app was open.
  // A player that is let go now frees its own.
  it('frees one recording when its player lets go, and leaves the others', async () => {
    const memo = await loadVoice('Rec/memo.m4a')
    const talk = await loadVoice('Rec/talk.m4a')
    forgetVoice('Rec/memo.m4a')
    expect(revoked).toEqual([memo])
    expect(cachedVoiceUrl('Rec/memo.m4a')).toBeUndefined()
    expect(cachedVoiceUrl('Rec/talk.m4a')).toBe(talk)
  })

  it('reads a recording again after it was let go', async () => {
    const first = await loadVoice('Rec/memo.m4a')
    forgetVoice('Rec/memo.m4a')
    const second = await loadVoice('Rec/memo.m4a')
    expect(second).not.toBe(first)
    expect(cachedVoiceUrl('Rec/memo.m4a')).toBe(second)
  })

  // The player was let go before its recording had finished loading (a note
  // opened and closed at once). Nobody is left to free a blob that lands late.
  it('frees a recording that lands after its player has gone', async () => {
    let release: (b: Uint8Array) => void = () => {}
    vi.stubGlobal('window', {
      api: { readAsset: () => new Promise<Uint8Array>((r) => (release = r)) }
    })
    const loading = loadVoice('Rec/slow.m4a')
    forgetVoice('Rec/slow.m4a')
    release(new Uint8Array([1, 2, 3]))
    expect(await loading).toBeNull()
    expect(made).toHaveLength(1)
    expect(revoked).toEqual(made)
    expect(cachedVoiceUrl('Rec/slow.m4a')).toBeUndefined()
  })

  // ...and a second ask made meanwhile must get its OWN read, not the abandoned one.
  it('gives a fresh read to whoever asks again while the abandoned one is still out', async () => {
    const waiting: ((b: Uint8Array) => void)[] = []
    vi.stubGlobal('window', {
      api: { readAsset: () => new Promise<Uint8Array>((r) => waiting.push(r)) }
    })
    const first = loadVoice('Rec/slow.m4a')
    forgetVoice('Rec/slow.m4a')
    const second = loadVoice('Rec/slow.m4a')
    expect(second).not.toBe(first)
    await vi.waitFor(() => expect(waiting).toHaveLength(2))
    waiting[1](new Uint8Array([4]))
    const url = await second
    expect(url).toMatch(/^blob:/)
    waiting[0](new Uint8Array([1]))
    expect(await first).toBeNull()
    expect(cachedVoiceUrl('Rec/slow.m4a')).toBe(url)
    expect(revoked).not.toContain(url)
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

  // 2026-11-14 (docs/app-check-2026-11-09.md, "Seen while fixing item 2"): the
  // browser's decoder holds ~3 GB for a 59-minute recording while it works, so
  // five long recordings in one note decoded side by side took the app past
  // 5 GB. They take turns now, and a file is not even read until its turn.
  describe('waveforms take turns', () => {
    const asked: string[] = []
    const waiting = new Map<string, (b: Uint8Array) => void>()
    beforeEach(() => {
      asked.length = 0
      waiting.clear()
      vi.stubGlobal('window', {
        api: {
          readAsset: (rel: string) => {
            asked.push(rel)
            return new Promise<Uint8Array>((r) => waiting.set(rel, r))
          }
        }
      })
    })
    const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

    it('reads (and decodes) the next recording only once the one before is done', async () => {
      const a = waveFor('Rec/a.m4a')
      const b = waveFor('Rec/b.m4a')
      await settle()
      expect(asked).toEqual(['Rec/a.m4a'])
      waiting.get('Rec/a.m4a')!(new Uint8Array([1]))
      await a
      await settle()
      expect(asked).toEqual(['Rec/a.m4a', 'Rec/b.m4a'])
      waiting.get('Rec/b.m4a')!(new Uint8Array([2]))
      await b
    })

    it('skips one whose player was let go before its turn, and asks afresh after', async () => {
      const a = waveFor('Rec/a.m4a')
      const b = waveFor('Rec/b.m4a')
      dropWave('Rec/b.m4a')
      await settle()
      waiting.get('Rec/a.m4a')!(new Uint8Array([1]))
      await a
      expect(await b).toBeNull()
      expect(asked).toEqual(['Rec/a.m4a']) // b was never read
      const again = waveFor('Rec/b.m4a')
      expect(again).not.toBe(b)
      await settle()
      expect(asked).toEqual(['Rec/a.m4a', 'Rec/b.m4a'])
      waiting.get('Rec/b.m4a')!(new Uint8Array([2]))
      await again
    })

    it('keeps one already being worked out when its player lets go', async () => {
      const a = waveFor('Rec/a.m4a')
      await settle()
      dropWave('Rec/a.m4a')
      expect(waveFor('Rec/a.m4a')).toBe(a)
      waiting.get('Rec/a.m4a')!(new Uint8Array([1]))
      await a
    })

    it('reads nothing that was still waiting when the vault switched', async () => {
      const a = waveFor('Rec/a.m4a')
      const b = waveFor('Rec/b.m4a')
      await settle()
      clearAssetCaches()
      waiting.get('Rec/a.m4a')!(new Uint8Array([1]))
      await a
      expect(await b).toBeNull()
      expect(asked).toEqual(['Rec/a.m4a'])
    })
  })
})
