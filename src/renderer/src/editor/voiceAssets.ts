// A recording's bytes, as something the voice note block can play and draw.
//
// Same shape as videoAssets.ts: the blob: URL cache comes from assetCache.ts,
// which is what makes a vault switch clear recordings as well as pictures (the
// keys are vault-RELATIVE paths, so `memo.m4a` in another vault is another
// file). Two more things live here because they have to be cleared at exactly
// the same moment: each recording's waveform, and the players themselves.

import { createAssetCache } from './assetCache'
import { decodeWave, type Wave } from './voiceWave'

const cache = createAssetCache()

/** The blob: URL for an already-loaded recording, for a synchronous first paint. */
export const cachedVoiceUrl = cache.cached

/** Read a recording's bytes and mint a blob: URL for it (null if the read fails). */
export const loadVoice = cache.load

const waves = new Map<string, Promise<Wave | null>>()

/** A recording's waveform, decoded once per file and kept. `maxBytes` refuses a
 *  file larger than that (null) — for a recording whose length is unknown, the
 *  size is the only guard against decoding hours of audio (see voiceWave.ts).
 *
 *  The bytes are read again over IPC rather than fetched from the blob: URL —
 *  the renderer's CSP is `connect-src 'self'`, and Chromium refuses a fetch of
 *  a blob: URL under it. One extra read of a file the size of a voice note is
 *  cheap; widening the CSP is not. */
export function waveFor(rel: string, maxBytes = Infinity): Promise<Wave | null> {
  let wave = waves.get(rel)
  if (!wave) {
    wave = window.api.readAsset(rel).then(
      (bytes) => (bytes.byteLength > maxBytes ? null : decodeWave(bytes)),
      () => null
    )
    waves.set(rel, wave)
  }
  return wave
}

const resets: (() => void)[] = []

/** Run `fn` whenever the recording cache is cleared — the vault switch. The
 *  players register here (voicePlayer.ts): a voice note still playing from the
 *  previous vault must stop, and a player kept under its relative path would be
 *  picked up by a different file of the same name in the new one. */
export function onVoiceReset(fn: () => void): void {
  resets.push(fn)
}

// `clearAssetCaches()` (App's vault switch) clears every cache `createAssetCache`
// made by calling each one's `clear`. Wrapping THIS cache's `clear` is how the
// players, the waveforms and the blobs all go together, through the one call
// that already exists, rather than a second hook App would have to remember.
// Players first: they are playing the blob URLs the original `clear` revokes.
const clearBlobs = cache.clear
cache.clear = (): void => {
  for (const fn of resets) fn()
  waves.clear()
  clearBlobs()
}
