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

  const v = status.version ? `v${status.version}` : 'A new version'

  if (status.state === 'downloading') {
    return (
      <div className="fade-in mb-2 rounded-lg bg-brand-50 px-3 py-1.5 text-[11px] leading-snug text-brand-600">
        <span className="flex items-center gap-1.5">
          <Icon name="restore" className="h-3.5 w-3.5" />
          Downloading {v}
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
    return (
      <div className="fade-in mb-2 flex items-center gap-2 rounded-lg bg-brand-50 px-3 py-1.5 text-[11px] leading-snug text-brand-600">
        <span className="flex-1">{v} is ready</span>
        <button
          onClick={() => window.api.installUpdate()}
          className="rounded border-none bg-transparent px-1.5 py-0.5 font-medium text-brand-600 outline-none transition-colors hover:bg-transparent hover:underline"
        >
          Restart now
        </button>
      </div>
    )
  }

  // available, but not downloading — either auto-download is off, or this
  // platform can't self-update and the only route is the releases page.
  return (
    <div className="fade-in mb-2 flex items-center gap-2 rounded-lg bg-brand-50 px-3 py-1.5 text-[11px] leading-snug text-brand-600">
      <span className="flex-1">{v} available</span>
      <button
        onClick={() => (canSelfUpdate ? void window.api.downloadUpdate() : window.api.openReleases())}
        className="rounded border-none bg-transparent px-1.5 py-0.5 font-medium text-brand-600 outline-none transition-colors hover:bg-transparent hover:underline"
      >
        {canSelfUpdate ? 'Download' : 'Get it'}
      </button>
    </div>
  )
}
