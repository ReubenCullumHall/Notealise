// Turning a vault-relative image path into something an <img> can show.
//
// Not a `file://` URL on purpose: in dev the renderer is served over http and
// the browser refuses to load one, so images would work in the packaged app and
// silently not in dev. The bytes come through the same IPC boundary as every
// other read instead, and become a blob: URL here.
//
// The caching itself lives in assetCache.ts, shared with video — read its
// header for why, and shared/attachments.ts now owns `resolveVaultPath` (it is
// the inverse of `encodeTarget` and belongs beside it). This file is down to
// image bytes: fetch, cache, hand back a blob: URL.

import { createAssetCache } from './assetCache'

const cache = createAssetCache()

/** The blob: URL for an already-loaded image, for a synchronous first paint. */
export const cachedUrl = cache.cached

/** Read an image's bytes and mint a blob: URL for it (null if the read fails). */
export const loadImage = cache.load

/** Drop the image blobs specifically. Prefer `clearAssetCaches()` for a vault
 *  switch, which covers video too — this is here for a caller that genuinely
 *  only wants the images gone. */
export const clearImageCache = cache.clear

// `resolveVaultPath` now lives in shared/attachments.ts, beside the
// `encodeTarget` it is the inverse of — the index of which notes hold which
// photos needs it too, and that is not an image-loading concern.
export { resolveVaultPath } from '../../../shared/attachments'
