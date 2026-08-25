import type { UpdateStatus } from '../../../shared/update'
import { Icon } from '../icons'

// The quiet strip above "Switch folder" in the sidebar footer. Deliberately
// small and non-modal: an update must never interrupt writing, so this is the
// only thing an available update does until you choose to restart.
//
// It borrows the same inline-hint styling used elsewhere in the sidebar
// (rounded, tinted strip) rather than introducing new CSS.

interface Props {
  status: UpdateStatus
  /** true when the app can't self-update (dev, or unsigned macOS) */
  canSelfUpdate: boolean
}

export function UpdateBanner({ status, canSelfUpdate }: Props): React.JSX.Element | null {
  // Idle / checking / none / error stay silent here — they're reported in
  // Settings, where the user went looking for them.
  if (status.state !== 'available' && status.state !== 'downloading' && status.state !== 'ready') {
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

  if (status.state === 'ready') {
    // macOS splits here. `ready` means "staged, restart to apply" on Windows
    // and "the .dmg is sitting in your Downloads" on a Mac — the same word for
    // two different promises, so the copy has to say which one it is. Offering
    // "Restart now" on a Mac would restart into the SAME version, which reads
    // as the update having silently failed.
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

  // available, but not downloading. Three cases, not two: Windows can fetch and
  // stage it; a Mac can fetch it but not apply it; anything else falls back to
  // the releases page. Naming the version is the point of the whole feature —
  // "Update available" with no number is what a stale build already looks like.
  const macManual = status.manual === true
  return (
    <div className="fade-in mb-2 flex items-center gap-2 rounded-lg bg-brand-50 px-3 py-1.5 text-[11px] leading-snug text-brand-600">
      <span className="flex-1">
        {status.version ? `${status.version} is out` : 'Update available'}
      </span>
      <button
        onClick={() =>
          canSelfUpdate || macManual
            ? void window.api.downloadUpdate()
            : window.api.openReleases()
        }
        className="rounded border-none bg-transparent px-1.5 py-0.5 font-medium text-brand-600 outline-none transition-colors hover:bg-transparent hover:underline"
      >
        {canSelfUpdate || macManual ? 'Download' : 'Get it'}
      </button>
    </div>
  )
}
