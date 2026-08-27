import type { UpdateStatus } from '../../../shared/update'
import { Icon } from '../icons'

// The corner card that says a new version exists.
//
// Why this exists at all: before it, the ONLY announcement was `UpdateBanner`,
// a small strip in the sidebar footer, and the launch check was gated on the
// "Update automatically" preference. Turn that off and the app never asked
// GitHub anything — an install months behind looked exactly like a current one.
// The check now always runs (main/updater.ts's initUpdater); this is the part
// the user actually notices.
//
// Deliberately NOT a modal and NOT auto-dismissing. It must not interrupt
// writing — the same rule UpdateBanner was built to — but an update the user
// has not seen is precisely the thing that must not quietly time out either.
// So: bottom-right, out of the text's way, until the × is clicked.
//
// Dismissal is session-only (React state in App, not persisted). The next
// launch checks again and shows it again while the version is still behind,
// which is the point — "I'll do it later" should not mean "never tell me
// again". See docs/feature-updates.md.
//
// Positioned `fixed` at the App root rather than portalled, matching `.notice`,
// which sits in the same place and works. The portal rule in CLAUDE.md is about
// escaping the SIDEBAR (its backdrop-filter makes it a containing block for
// fixed children); nothing here is inside it.

interface Props {
  status: UpdateStatus
  /** false on the unsigned macOS build, which cannot replace its own binary */
  selfInstall: boolean
  /** macOS: open Settings → Updates, where the download button lives */
  onOpenUpdates: () => void
  onDismiss: () => void
}

export function UpdateToast({
  status,
  selfInstall,
  onOpenUpdates,
  onDismiss
}: Props): React.JSX.Element | null {
  // The three states that mean "a newer version exists". `available` alone is
  // not enough: with auto-download on, electron-updater starts fetching
  // immediately and updater.ts reports `downloading` from the first event, so a
  // toast keyed only on `available` would never appear for the majority of
  // Windows users — the ones who changed no settings at all.
  const showing =
    status.state === 'available' || status.state === 'downloading' || status.state === 'ready'
  if (!showing) return null

  const name = status.version ? `Notealise ${status.version}` : 'A new version'

  // MAC_UNSIGNED_WORKAROUND — the whole branch. macOS cannot apply an update
  // (Squirrel.Mac refuses an unsigned one), so the toast's job there is to hand
  // the user off to Settings → Updates, which owns the download and the "here is
  // how to get past Gatekeeper" follow-up. Goes when the app is signed.
  if (!selfInstall) {
    const downloaded = status.state === 'ready'
    return (
      <Toast onDismiss={onDismiss} title={`${name} is ${downloaded ? 'downloaded' : 'available'}`}>
        <p className="mt-0.5 text-[11.5px] leading-snug text-ink-500">
          {downloaded
            ? 'It is in your Downloads folder, waiting to replace this copy.'
            : 'Updating on a Mac takes a couple of steps.'}
        </p>
        <button type="button" className="update-toast-go" onClick={onOpenUpdates}>
          {downloaded ? 'Show me how' : 'Get it'}
        </button>
      </Toast>
    )
  }

  if (status.state === 'downloading') {
    return (
      <Toast onDismiss={onDismiss} title={`${name} is downloading`}>
        <p className="mt-0.5 text-[11.5px] leading-snug text-ink-500">
          It installs when you next quit. Nothing to do.
        </p>
        {/* A hairline track, for the same reason UpdateBanner has one: 100 MB
            with no feedback reads as stalled. */}
        <span className="mt-2 block h-0.5 w-full overflow-hidden rounded-full bg-brand-500/20">
          <span
            className="block h-full rounded-full bg-brand-500 transition-all duration-300"
            style={{ width: `${status.percent ?? 0}%` }}
          />
        </span>
      </Toast>
    )
  }

  if (status.state === 'ready') {
    return (
      <Toast onDismiss={onDismiss} title={`${name} is ready`}>
        <p className="mt-0.5 text-[11.5px] leading-snug text-ink-500">
          It installs when you quit, or restart now.
        </p>
        <button
          type="button"
          className="update-toast-go"
          onClick={() => window.api.installUpdate()}
        >
          Restart now
        </button>
      </Toast>
    )
  }

  // available, and auto-download is off — the only case where the user has to
  // ask for the download themselves.
  return (
    <Toast onDismiss={onDismiss} title={`${name} is available`}>
      <p className="mt-0.5 text-[11.5px] leading-snug text-ink-500">
        You are on {status.version ? 'an older version' : 'an older build'}.
      </p>
      <button
        type="button"
        className="update-toast-go"
        onClick={() => void window.api.downloadUpdate()}
      >
        Download it
      </button>
    </Toast>
  )
}

/** The shell: card, title row, dismiss. Kept local — nothing else in the app
 *  wants a persistent corner card, and pulling it out now would be a component
 *  with one caller and a name to argue about. */
function Toast({
  title,
  children,
  onDismiss
}: {
  title: string
  children: React.ReactNode
  onDismiss: () => void
}): React.JSX.Element {
  return (
    <div className="update-toast fade-in" role="status" aria-live="polite">
      <div className="flex items-start gap-2">
        <span className="min-w-0 flex-1 text-[12.5px] font-semibold leading-snug text-ink-800">
          {title}
        </span>
        <button
          type="button"
          className="update-toast-x"
          aria-label="Dismiss"
          data-tip="Dismiss · you'll be told again next time you open Notealise"
          onClick={onDismiss}
        >
          <Icon name="x" className="h-3.5 w-3.5" />
        </button>
      </div>
      {children}
    </div>
  )
}
