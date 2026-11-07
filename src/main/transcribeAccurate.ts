// "More accurate transcription — 550 MB" (docs/plans/transcribe.md, Reuben 2026-11-06: "pick 1,
// that's good balance"). Base is built into the app; this one-time download switches Transcribe to
// Whisper Turbo, which on real voices got ~1 word in 14 wrong against Base's ~1 in 3.5 (18 languages,
// FLEURS). Language checks keep using Base — they were right 100% of the time and Base is quicker.
//
// Rules, each with a reason:
// - Only on the user's click (Settings, or the line under a transcript). Nothing is fetched on its own.
// - The ONE address below, pinned, and the file checked against its SHA-256 before it is used: a
//   damaged or swapped file is thrown away, never run. Redirects are followed (Hugging Face hands the
//   file over from its own storage) — the fingerprint, not the host, is what makes it safe.
// - Into userData/whisper/, never the vault (rule 2: a property of this install, and 550 MB has no
//   business in a synced notes folder). Written to a .part file and renamed only once it checks out.
// - Free space is checked first (the file + 200 MB), so a full disk is a message, not a half-file.
// - Nothing about the user's recordings is sent: it is a plain GET of a public file.

import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { app, type WebContents } from 'electron'
import { CH } from '../shared/channels'
import type { AccurateDownload, AccurateStatus } from '../shared/types'

export const ACCURATE = {
  file: 'ggml-large-v3-turbo-q5_0.bin',
  url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin',
  sha256: '394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2',
  bytes: 574_041_195
} as const

/** No new bytes for this long and the download is given up as stalled. */
const STALL_MS = 30_000
/** Room to leave on the disk beyond the file itself. */
const SPARE_BYTES = 200 * 1024 * 1024

const dir = (): string => path.join(app.getPath('userData'), 'whisper')
export const accuratePath = (): string => path.join(dir(), ACCURATE.file)

let active: { controller: AbortController; received: number } | null = null

/** Is the Turbo file here and whole? (Size only — it was checked against its
 *  fingerprint before it was given its name, and nothing else writes there.) */
export async function accurateReady(): Promise<boolean> {
  const st = await fs.stat(accuratePath()).catch(() => null)
  return !!st?.isFile() && st.size === ACCURATE.bytes
}

export async function accurateStatus(): Promise<AccurateStatus> {
  if (active) return { state: 'downloading', received: active.received, total: ACCURATE.bytes }
  return { state: (await accurateReady()) ? 'ready' : 'none', received: 0, total: ACCURATE.bytes }
}

export async function accurateDownload(sender: WebContents): Promise<AccurateDownload> {
  if (active) return { ok: false, reason: 'busy' }
  if (await accurateReady()) return { ok: true }
  await fs.mkdir(dir(), { recursive: true })
  const stat = await fs.statfs(dir()).catch(() => null)
  if (stat && stat.bavail * stat.bsize < ACCURATE.bytes + SPARE_BYTES) return { ok: false, reason: 'no-space' }

  const controller = new AbortController()
  const job = { controller, received: 0 }
  active = job
  const part = `${accuratePath()}.part`
  let stall: NodeJS.Timeout = setTimeout(() => controller.abort(), STALL_MS)
  let lastSent = 0
  const send = (force = false): void => {
    const now = Date.now()
    if (!force && now - lastSent < 250) return
    lastSent = now
    if (!sender.isDestroyed()) sender.send(CH.accurateProgress, { received: job.received, total: ACCURATE.bytes })
  }
  const fh = await fs.open(part, 'w')
  try {
    const res = await fetch(ACCURATE.url, { signal: controller.signal, credentials: 'omit', redirect: 'follow' })
    if (!res.ok || !res.body) return { ok: false, reason: 'failed' }
    const declared = Number(res.headers.get('content-length') ?? ACCURATE.bytes)
    if (declared !== ACCURATE.bytes) return { ok: false, reason: 'damaged' }
    const hash = createHash('sha256')
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      job.received += chunk.byteLength
      if (job.received > ACCURATE.bytes) return { ok: false, reason: 'damaged' }
      hash.update(chunk)
      await fh.write(chunk)
      clearTimeout(stall)
      stall = setTimeout(() => controller.abort(), STALL_MS)
      send()
    }
    await fh.sync()
    await fh.close()
    if (job.received !== ACCURATE.bytes || hash.digest('hex') !== ACCURATE.sha256) return { ok: false, reason: 'damaged' }
    await fs.rename(part, accuratePath())
    send(true)
    return { ok: true }
  } catch {
    return { ok: false, reason: controller.signal.aborted && cancelled.has(controller) ? 'cancelled' : 'offline' }
  } finally {
    clearTimeout(stall)
    await fh.close().catch(() => {})
    await fs.rm(part, { force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {})
    cancelled.delete(controller)
    active = null
  }
}

const cancelled = new Set<AbortController>()

export function accurateCancel(): void {
  if (!active) return
  cancelled.add(active.controller)
  active.controller.abort()
}

/** Back to Base. Refused while a transcription might be reading the file (Windows
 *  will not delete a file that is open). */
export async function accurateRemove(busy: boolean): Promise<{ ok: boolean }> {
  if (busy || active) return { ok: false }
  await fs.rm(accuratePath(), { force: true, maxRetries: 5, retryDelay: 200 })
  return { ok: true }
}

/** Quitting mid-download: stop it (its .part file is removed on the way out). */
export function stopAccurateDownload(): void {
  accurateCancel()
}
