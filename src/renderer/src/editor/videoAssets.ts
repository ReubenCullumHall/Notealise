// Turning a vault-relative video path into something a <video> can play.
//
// Nothing here is duplicated from the image side any more: the cache comes from
// assetCache.ts (which both call, and which is what makes a vault switch clear
// video as well as images), and `resolveVaultPath` is re-exported from
// imageAssets.ts, which owns that path arithmetic.

export { resolveVaultPath } from './imageAssets'

import { createAssetCache } from './assetCache'

const cache = createAssetCache()

/** The blob: URL for an already-loaded video, for a synchronous first paint. */
export const cachedVideoUrl = cache.cached

/** Read a video's bytes and mint a blob: URL for it (null if the read fails). */
export const loadVideo = cache.load

/** Drop the video blobs specifically. A vault switch should call
 *  `clearAssetCaches()` instead — it covers images too, and this cache being
 *  cleared separately (or, as it was, not at all) is exactly the bug that
 *  played the previous vault's video after a switch. */
export const clearVideoCache = cache.clear
