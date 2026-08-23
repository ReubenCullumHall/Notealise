import { kindForFilename } from '../../shared/attachments'
import type { IconName } from './icons'

/** Which icon a binned item deserves: the photo/video ones for media, null for
 *  everything else, so the caller keeps its own doc/folder icons.
 *
 *  Its own module, not part of MediaBadge.tsx, purely because a file that
 *  exports a component and a plain function breaks React Fast Refresh — the
 *  lint rule that says so is right, and one two-line file is cheaper than a
 *  disable comment. */
export function mediaIcon(name: string): Extract<IconName, 'image' | 'video'> | null {
  const kind = kindForFilename(name)
  return kind === 'image' ? 'image' : kind === 'video' ? 'video' : null
}
