import { useEffect } from 'react'
import type { OnboardingStepProps } from '../Onboarding'

interface Props extends OnboardingStepProps {
  notePath: string | null
  noteText: string
}

/** The spec's "emotional peak" — showing the real OS window is the proof, a
 *  mockup isn't, so the only thing this button does is call the real IPC. */
export function DiskProofStep({ notePath, noteText, onReady }: Props): React.JSX.Element {
  useEffect(() => {
    onReady({ ready: !!notePath })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notePath])

  const reveal = (): void => {
    if (notePath) void window.api.revealInFolder(notePath)
  }

  return (
    <div className="flex flex-col items-center gap-6 text-center">
      <div>
        <h1 className="font-display text-[24px] font-semibold text-ink-900">That note is already a file</h1>
        <p className="mx-auto mt-3 max-w-[460px] text-[14px] leading-relaxed text-ink-500">
          No saving, no exporting, no account. It&rsquo;s sitting in the folder you picked, and it&rsquo;ll
          open in any app that reads text.
        </p>
      </div>

      <div className="grid w-full max-w-[520px] grid-cols-2 gap-3 text-left">
        <div className="rounded-2xl bg-surface/70 px-4 py-3 shadow-card">
          <p className="mb-1.5 font-mono text-[9.5px] uppercase tracking-wide text-ink-400">what you wrote</p>
          <p className="whitespace-pre-wrap font-display text-[13px] leading-snug text-ink-800">{noteText}</p>
        </div>
        <div className="rounded-2xl bg-ink-900/[0.03] px-4 py-3 shadow-card ring-1 ring-ink-300/15">
          <p className="mb-1.5 truncate font-mono text-[9.5px] text-ink-400">{notePath}</p>
          <p className="whitespace-pre-wrap font-mono text-[11px] leading-snug text-ink-600">{noteText}</p>
        </div>
      </div>

      <button
        type="button"
        onClick={reveal}
        disabled={!notePath}
        className="rounded-full px-5 py-2 text-[13px] font-medium text-brand-700 ring-1 ring-brand-300 transition duration-150 hover:bg-brand-500/8 disabled:opacity-50"
      >
        Show me the file
      </button>

      <p className="max-w-[420px] text-[12px] text-ink-400">
        Nearly everything about how this looks and works can be changed — themes, colours, spacing,
        what&rsquo;s in the toolbar. It&rsquo;s all in Settings when you want it.
      </p>
    </div>
  )
}
