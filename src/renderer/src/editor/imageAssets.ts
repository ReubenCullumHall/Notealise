// Turning a vault-relative image path into something an <img> can show.
//
// Not a `file://` URL on purpose: in dev the renderer is served over http and
// the browser refuses to load one, so images would work in the packaged app and
// silently not in dev. Main is asked — over the same IPC boundary as every other
// read — for the app's own address for the file (shared/mediaUrl.ts), and
// serves the picture from it; the bytes are never held here.
//
// The caching itself lives in assetCache.ts, shared with video — read its
// header for why, and shared/attachments.ts now owns `resolveVaultPath` (it is
// the inverse of `encodeTarget` and belongs beside it). This file is down to:
// ask, cache, hand back the address.

import { createAssetCache } from './assetCache'

const cache = createAssetCache()

/** The address of an already-asked-for image, for a synchronous first paint. */
export const cachedUrl = cache.cached

/** Ask main for an image's address (null if the file isn't there). */
export const loadImage = cache.load

// `resolveVaultPath` now lives in shared/attachments.ts, beside the
// `encodeTarget` it is the inverse of — the index of which notes hold which
// photos needs it too, and that is not an image-loading concern.
export { resolveVaultPath } from '../../../shared/attachments'
