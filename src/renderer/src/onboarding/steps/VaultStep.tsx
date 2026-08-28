import { useEffect, useState } from 'react'
import type { TreeNode } from '../../../../shared/types'
import type { OnboardingStepProps } from '../Onboarding'

function countNotes(nodes: TreeNode[]): number {
  return nodes.reduce((n, x) => n + (x.type === 'file' ? 1 : countNotes(x.children ?? [])), 0)
}

interface Props extends OnboardingStepProps {
  vault: string | null
  onPickVault: () => Promise<void>
  /** whether to short-circuit the flow when the picked folder already has a
   *  Notealise setup — only true on a fresh run (see Onboarding.tsx) */
  recogniseExistingSetup: boolean
}

export function VaultStep({
  vault,
  onPickVault,
  onReady,
  recogniseExistingSetup
}: Props): React.JSX.Element {
  const [picking, setPicking] = useState(false)
  const [existingCount, setExistingCount] = useState<number | null>(null)
  // The picked folder already carries a `.mdnotes/settings.json` — it has been
  // set up with the app before (another machine, via a synced folder; or this
  // one, before an app-cleaner wiped its record). Continue then ends the flow
  // here rather than walking a returning user through Import → Spaces → Write.
  const [established, setEstablished] = useState(false)

  useEffect(() => {
    if (!vault) {
      setExistingCount(null)
      setEstablished(false)
      onReady({ ready: false })
      return
    }
    let cancelled = false
    // Not ready until the (fast, local) checks resolve: reporting `ready` the
    // instant a vault is set would let a click in that gap skip past the
    // "you've done this before" recognition and seed welcome notes over a real
    // vault's own notes.
    onReady({ ready: false })
    void Promise.all([window.api.listTree(), window.api.vaultEstablished()])
      .then(([tree, isSetUp]) => {
        if (cancelled) return
        const recognised = isSetUp && recogniseExistingSetup
        setExistingCount(countNotes(tree))
        setEstablished(recognised)
        onReady(
          recognised
            ? { ready: true, skipToFinish: true, continueLabel: 'Pick up where you left off' }
            : { ready: true }
        )
      })
      .catch(() => {
        // A failed check must not leave Continue disabled forever — fall through
        // to a normal first run.
        if (!cancelled) onReady({ ready: true })
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vault, recogniseExistingSetup])

  const choose = async (): Promise<void> => {
    setPicking(true)
    try {
      await onPickVault()
    } finally {
      setPicking(false)
    }
  }

  return (
    <div className="flex flex-col items-center gap-8 text-center">
      <div>
        <h1 className="font-display text-[24px] font-semibold text-ink-900">
          Everything here is a file on your computer
        </h1>
        <p className="mx-auto mt-3 max-w-[440px] text-[14px] leading-relaxed text-ink-500">
          Not a database. Not an account. Pick a folder and that&rsquo;s where your notes live — you can
          open them in anything, and if you delete this app tomorrow they&rsquo;re exactly where you left
          them.
        </p>
      </div>

      <div className="flex min-h-[130px] w-full max-w-[440px] flex-col items-center justify-center gap-3 rounded-2xl bg-surface/70 px-6 py-6 shadow-card">
        {vault ? (
          <>
            <span className="max-w-full truncate rounded-lg bg-brand-500/8 px-3 py-1.5 font-mono text-[12.5px] text-ink-800">
              {vault}
            </span>
            {established ? (
              <span className="text-[12px] leading-relaxed text-ink-500">
                You&rsquo;ve set this folder up with Notealise before — your look and layout are
                still in it. Continue to pick up where you left off.
              </span>
            ) : (
              <>
                <span className="text-[12px] text-ink-500">
                  This is yours. Nothing else goes in it.
                </span>
                {existingCount != null && existingCount > 0 && (
                  <span className="text-[11.5px] text-ink-400">
                    There are already {existingCount} {existingCount === 1 ? 'note' : 'notes'} in
                    here. They&rsquo;ll show up as they are.
                  </span>
                )}
              </>
            )}
            <button
              type="button"
              onClick={() => void choose()}
              className="mt-1 rounded border-none bg-transparent p-0 text-[11.5px] text-brand-600 underline-offset-2 hover:underline"
            >
              Change
            </button>
          </>
        ) : (
          <button
            type="button"
            disabled={picking}
            onClick={() => void choose()}
            className="rounded-full bg-brand-600 px-5 py-2 text-[13px] font-medium text-paper transition duration-150 hover:bg-brand-700 disabled:opacity-50"
          >
            {picking ? 'Choosing…' : 'Pick a folder for your notes'}
          </button>
        )}
      </div>
    </div>
  )
}
