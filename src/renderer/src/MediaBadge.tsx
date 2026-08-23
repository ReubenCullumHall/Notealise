import { Icon } from './icons'

// The bin and Settings → Recovery both list whatever was deleted, and until now
// a photo appeared there as a document icon and a filename — indistinguishable
// from a note, and giving no hint that restoring it does something different.
// It does: a photo goes back INTO the note it illustrated, not just back onto
// the disk. This is the pair of marks that says so, shared by both lists so the
// two can't drift apart.

/** The word "Media" plus an ⓘ that explains what restoring one actually does.
 *
 *  The explanation is on hover rather than written out in the row because it is
 *  the same sentence on every media row in both lists — printed, it would be
 *  noise by the third item; absent, the behaviour is a surprise. `data-tip` is
 *  the app's own tooltip (Tooltip.tsx), the same one the Restore button uses. */
export function MediaTag({ hasOrigin }: { hasOrigin: boolean }): React.JSX.Element {
  return (
    <span className="flex shrink-0 items-center gap-1">
      <span className="rounded bg-brand-500/12 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-brand-600">
        Media
      </span>
      <span
        data-tip={
          hasOrigin
            ? 'The recovered media goes back to its original place in the note. To go to it, click Navigate after restoring.'
            : 'This one was binned outside a note, so restoring it puts the file back in your vault and nothing else.'
        }
        aria-label="What happens when this is restored"
        className="flex h-3.5 w-3.5 items-center justify-center text-ink-300 transition-colors hover:text-brand-600"
      >
        <Icon name="info" className="h-3.5 w-3.5" />
      </span>
    </span>
  )
}
