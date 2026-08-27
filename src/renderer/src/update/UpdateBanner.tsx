import type { UpdateStatus } from '../../../shared/update'
import { Icon } from '../icons'

// The quiet strip above "Switch folder" in the sidebar footer.
//
// **It no longer announces that an update exists** (changed 2026-08-27). That
// job moved to UpdateToast, because this strip was too easy to miss and being
// missed was the whole problem — see docs/feature-updates.md. What is left here
// is deliberately the half a toast cannot do: the toast is dismissible, so once
// it is gone a download in flight, or a finished one waiting for a restart,
// would have nowhere to show until Settings was opened. This is that somewhere.
//
// So: silent for `available` (the toast has it), visible for `downloading` and
// `ready`. Still small and non-modal — an update must never interrupt writing.
//
// It borrows the same inline-hint styling used elsewhere in the sidebar
// (rounded, tinted strip) rather than introducing new CSS.

interface Props {
  status: UpdateStatus
}

// `canSelfUpdate` used to be a second prop here; it was only ever read by the
// `available` branch (to choose between downloading and opening the releases
// page), so it went with it. `ready` distinguishes the two platforms from
// `status.manual`, which the status itself carries. Removed rather than left
// unused — see CLAUDE.md rule 9.
export function UpdateBanner({ status }: Props): React.JSX.Element | null {
  // Everything else — including `available` — stays silent here. It is either
  // the toast's job now, or reported in Settings where the user went looking.
  if (status.state !== 'downloading' && status.state !== 'ready') {
    return null
  }

  if (status.state === 'downloading') {
    return (
      <div className="fade-in mb-2 rounded-lg bg-brand-50 px-3 py-1.5 text-[11px] leading-snug text-brand-600">
        <span className="flex items-center gap-1.5">
          <Icon name="restore" className="h-3.5 w-3.5" />
          Downloading update
          {typeof status.percent === 'number' ? ` · ${status.percent}%` : '…'}
        </span>
        {/* a hairline progress track, so a 100 MB download doesn't look stalled */}
        <span className="mt-1 block h-0.5 w-full overflow-hidden rounded-full bg-brand-500/20">
          <span
            className="block h-full rounded-full bg-brand-500 transition-all duration-300"
            style={{ width: `${status.percent ?? 0}%` }}
          />
        </span>
      </div>
    )
  }

  // `ready` is all that is left. macOS splits here: `ready` means "staged,
  // restart to apply" on Windows and "the .dmg is sitting in your Downloads" on
  // a Mac — the same word for two different promises, so the copy has to say
  // which one it is. Offering "Restart now" on a Mac would restart into the
  // SAME version, which reads as the update having silently failed.
  if (status.manual) {
    return (
      <div className="fade-in mb-2 flex items-center gap-2 rounded-lg bg-brand-50 px-3 py-1.5 text-[11px] leading-snug text-brand-600">
        <span className="flex-1">
          {status.version ? `${status.version} downloaded` : 'Downloaded'}
        </span>
        <button
          onClick={() => void window.api.revealUpdate()}
          className="rounded border-none bg-transparent px-1.5 py-0.5 font-medium text-brand-600 outline-none transition-colors hover:bg-transparent hover:underline"
        >
          Show me
        </button>
      </div>
    )
  }
  return (
    <div className="fade-in mb-2 flex items-center gap-2 rounded-lg bg-brand-50 px-3 py-1.5 text-[11px] leading-snug text-brand-600">
      <span className="flex-1">Update ready</span>
      <button
        onClick={() => window.api.installUpdate()}
        className="rounded border-none bg-transparent px-1.5 py-0.5 font-medium text-brand-600 outline-none transition-colors hover:bg-transparent hover:underline"
      >
        Restart now
      </button>
    </div>
  )
}
