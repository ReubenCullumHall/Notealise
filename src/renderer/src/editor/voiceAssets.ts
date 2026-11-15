// A recording's bytes, as something the voice note block can play and draw.
//
// Same shape as videoAssets.ts: the URL cache comes from assetCache.ts, which is
// what makes a vault switch clear recordings as well as pictures (the keys are
// vault-RELATIVE paths, so `memo.m4a` in another vault is another file). Two
// more things live here because they have to be cleared at exactly the same
// moment: each recording's waveform, and the players themselves.
//
// A recording is the one kind still held WHOLE in the window (`'bytes'`), where
// pictures and videos are served a piece at a time since 2026-11-11. Two
// measured reasons. The tape keeps a recording playing after its note has been
// closed, renamed, moved or binned — with the bytes in hand it plays to the end,
// while one served by address stopped as soon as it ran past what was already
// loaded (about three minutes in, for an hour-long recording whose folder was
// renamed). And the mixer hears it through Web Audio, which plays silence for a
// sound from another origin. What changed for recordings is WHEN they go: a
// player that is let go frees its recording (`forgetVoice`), where before every
// one ever played stayed until the vault switched.

import { createAssetCache } from './assetCache'
import { decodeWave, type Wave } from './voiceWave'

const cache = createAssetCache('bytes')

/** The blob: URL for an already-loaded recording, for a synchronous first paint. */
export const cachedVoiceUrl = cache.cached

/** Read a recording's bytes and mint a blob: URL for it (null if the read fails). */
export const loadVoice = cache.load

/** Free a recording's bytes — its player has been let go (voicePlayer.ts
 *  `release`), so nothing is playing or showing it. */
export const forgetVoice = cache.forget

interface WaveJob {
  wave: Promise<Wave | null>
  /** its turn has come: the file is being read or decoded, or is done */
  started: boolean
  /** let go before its turn (`dropWave`, the vault switch): it reads nothing */
  dropped: boolean
}

const waves = new Map<string, WaveJob>()

/** The last waveform asked for; the next one waits for it. */
let queue: Promise<unknown> = Promise.resolve()

/** A recording's waveform, decoded once per file and kept. `maxBytes` refuses a
 *  file larger than that (null) — for a recording whose length is unknown, the
 *  size is the only guard against decoding hours of audio (see voiceWave.ts).
 *
 *  ONE AT A TIME (2026-11-14). The browser's decoder holds the whole recording
 *  at its own rate while it works — measured ~3 GB for a 59-minute .m4a, for
 *  about four seconds, whatever rate it is asked for — and gives it back when it
 *  is done. Five long recordings in one note decoded side by side took the app
 *  past 5 GB, and one of the five got no waveform at all. In turn, the most held
 *  is one recording's worth. The file is read only when its turn comes, so the
 *  bytes of the ones still waiting are not held either.
 *
 *  The bytes are read again over IPC rather than fetched from the blob: URL —
 *  the renderer's CSP is `connect-src 'self'`, and Chromium refuses a fetch of
 *  a blob: URL under it. One extra read of a file the size of a voice note is
 *  cheap; widening the CSP is not. */
export function waveFor(rel: string, maxBytes = Infinity): Promise<Wave | null> {
  const known = waves.get(rel)
  if (known) return known.wave
  const job: WaveJob = { wave: Promise.resolve(null), started: false, dropped: false }
  job.wave = queue
    .then(async () => {
      if (job.dropped) return null
      job.started = true
      const bytes = await window.api.readAsset(rel)
      return bytes.byteLength > maxBytes ? null : decodeWave(bytes)
    })
    .catch(() => null)
  queue = job.wave
  waves.set(rel, job)
  return job.wave
}

/** Nothing wants this recording's waveform any more — its player has been let
 *  go (a note left before its waveforms were all drawn). One still waiting for
 *  its turn is skipped, so leaving a note of long recordings stops the decoding
 *  rather than working through the rest; one already decoded is kept, as before. */
export function dropWave(rel: string): void {
  const job = waves.get(rel)
  if (!job || job.started) return
  job.dropped = true
  waves.delete(rel)
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
  for (const job of waves.values()) job.dropped = true // a waiting one would read the NEW vault's file of that name
  waves.clear()
  clearBlobs()
}
