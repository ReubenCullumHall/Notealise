import { Icon } from '../icons'
import { MediaTag } from '../MediaBadge'
import { mediaIcon } from '../mediaKind'
import { useArmed } from './useArmed'
import { onDate } from '../organise/model'
import { heldPath, RECOVERY_DIR, RECOVERY_TTL_MS, type RecoveryItem } from '../../../shared/workspace'

// Settings → Recovery. The second-stage safety net beneath the bin: see the
// "recovery" block in main/vault.ts and shared/workspace.ts's RecoveryItem.
// Deliberately not in the sidebar's bin view — reaching this list means
// "delete this" was already said once (into the bin) and once more
// (emptying it, or force-deleting one item). It is reachable here so nothing
// deleted through the app is ever more than a Settings visit away from
// coming back, for 7 days.

interface Props {
  items: RecoveryItem[]
  onRestore: (ids: string[]) => void
  onPurge: (ids?: string[]) => void
}

const DAY_MS = 24 * 60 * 60 * 1000

function daysLeft(purgedAt: number): number {
  return Math.max(0, Math.ceil((purgedAt + RECOVERY_TTL_MS - Date.now()) / DAY_MS))
}

export function Recovery({ items, onRestore, onPurge }: Props): React.JSX.Element {
  return (
    <>
      <h3 className="font-display text-[15px] font-semibold text-ink-900">Recovery</h3>
      <p className="mt-0.5 text-[12px] leading-relaxed text-ink-500">
        A second safety net beneath the bin. Deleting something forever from the bin — one item, or
        the whole &ldquo;Empty recycle bin&rdquo; — lands it here instead, where it waits 7 days
        before the app removes it for good. It doesn&rsquo;t show up in the sidebar on purpose:
        by the time something reaches here, delete has already been confirmed twice.
      </p>

      {items.length === 0 ? (
        <div className="mt-6 px-4 py-8 text-center">
          <p className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-surface/70 text-ink-400">
            <Icon name="trash" className="h-4 w-4" />
          </p>
          <p className="text-sm text-ink-500">Nothing waiting here.</p>
          <p className="mt-1 text-xs leading-relaxed text-ink-300">
            Items only arrive after being deleted forever from the bin.
          </p>
        </div>
      ) : (
        <>
          <div className="mt-4 flex flex-col gap-1.5">
            {items.map((item) => (
              <RecoveryRow
                key={item.id}
                item={item}
                onRestore={() => onRestore([item.id])}
                onPurge={() => onPurge([item.id])}
              />
            ))}
          </div>

          <div className="mt-4 flex justify-end">
            <TwoStepButton label="Delete all now" armedLabel="Click again to delete all" onConfirm={() => onPurge()} />
          </div>
        </>
      )}
    </>
  )
}

function RecoveryRow({
  item,
  onRestore,
  onPurge
}: {
  item: RecoveryItem
  onRestore: () => void
  onPurge: () => void
}): React.JSX.Element {
  const left = daysLeft(item.purgedAt)
  // Same treatment as the sidebar's bin, deliberately: this is the same item one
  // stage further down, and a photo's restore does the same unusual thing here.
  const media = item.type === 'file' ? mediaIcon(item.name) : null
  return (
    <div className="flex items-center gap-2 rounded-xl px-3 py-2.5 ring-1 ring-ink-300/20">
      <span className="shrink-0 text-ink-300">
        <Icon name={media ?? (item.type === 'dir' ? 'folder' : 'doc')} className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-ink-900">
          {media ? item.name : item.name.replace(/\.md$/i, '')}
        </span>
        <span className="block truncate text-[11.5px] text-ink-400">
          From {item.from || '(vault root)'} · deleted {onDate(item.purgedAt)} ·{' '}
          {left === 0 ? 'gone within a day' : `${left} day${left === 1 ? '' : 's'} left`}
        </span>
      </span>
      {media && <MediaTag hasOrigin={!!item.media} />}
      {/* Same reasoning as the bin's copy: `.mdnotes/recovery/` is inside a
          hidden dot-folder, so this is the only way to actually see the file. */}
      <button
        onClick={() => void window.api.revealInFolder(heldPath(RECOVERY_DIR, item.id, item.name))}
        data-tip="Show me this file on my computer"
        className="shrink-0 rounded-lg border-none bg-transparent p-1.5 text-ink-400 outline-none transition duration-200 hover:bg-brand-500/10 hover:text-brand-600"
      >
        <Icon name="folder" className="h-4 w-4" />
      </button>
      <button
        onClick={onRestore}
        data-tip="Put back"
        className="shrink-0 rounded-lg border-none bg-transparent p-1.5 text-ink-400 outline-none transition duration-200 hover:bg-brand-500/10 hover:text-brand-600"
      >
        <Icon name="restore" className="h-4 w-4" />
      </button>
      <TwoStepButton
        icon
        label="Delete now, permanently"
        armedLabel="Click again to delete permanently"
        onConfirm={onPurge}
      />
    </div>
  )
}

/** The arm-then-confirm behaviour is `useArmed` in primitives.tsx, shared with
 *  Spaces.tsx's DeleteSpace — the two used to be the same timer written twice.
 *  What stays here is this button's own two shapes (a text pill, or the
 *  icon-only trash button a row shows). This IS the real, unrecoverable delete,
 *  so unlike the bin's own per-item purge, arming is required every time. */
function TwoStepButton({
  label,
  armedLabel,
  onConfirm,
  icon
}: {
  label: string
  armedLabel: string
  onConfirm: () => void
  /** render as an icon-only trash button (row context) instead of a text pill */
  icon?: boolean
}): React.JSX.Element {
  const { armed, press } = useArmed()
  const onClick = (): void => {
    if (press()) onConfirm()
  }

  if (icon) {
    return (
      <button
        onClick={onClick}
        data-tip={armed ? armedLabel : label}
        className={
          'shrink-0 rounded-lg border-none bg-transparent p-1.5 outline-none transition duration-200 ' +
          (armed
            ? 'text-[#e5484d] hover:bg-[#e5484d]/10' // same literal .mini.danger / .menu-item.danger use
            : 'text-ink-400 hover:bg-brand-500/10 hover:text-brand-600')
        }
      >
        <Icon name="trash" className="h-4 w-4" />
      </button>
    )
  }

  return (
    <button className={'mini' + (armed ? ' danger' : '')} onClick={onClick}>
      {armed ? armedLabel : label}
    </button>
  )
}
