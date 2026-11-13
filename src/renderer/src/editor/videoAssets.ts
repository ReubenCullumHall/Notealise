// Turning a vault-relative video path into something a <video> can play.
//
// Nothing here is duplicated from the image side any more: the cache comes from
// assetCache.ts (which both call, and which is what makes a vault switch clear
// video as well as images), and `resolveVaultPath` is re-exported from
// imageAssets.ts, which owns that path arithmetic.

export { resolveVaultPath } from './imageAssets'

import { createAssetCache } from './assetCache'

const cache = createAssetCache()

/** The address of an already-asked-for video, for a synchronous first paint. */
export const cachedVideoUrl = cache.cached

/** Ask main for a video's address (null if the file isn't there). */
export const loadVideo = cache.load

