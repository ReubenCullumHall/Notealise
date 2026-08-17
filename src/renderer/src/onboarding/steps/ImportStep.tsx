import { useEffect, useState } from 'react'
import { ImportPanel } from '../../import/ImportPanel'
import type { OnboardingStepProps } from '../Onboarding'

interface Props extends OnboardingStepProps {
  onOpenSpace: (folder: string) => Promise<void>
}

/** Wraps the real ImportPanel (built for the Settings modal — see
 *  docs/onboarding-plan.md's "Import embedding" note) rather than a copy of
 *  it, so the six formats and their platform gating never drift out of step.
 *  Skipping is its own state, not a step forward, so "Actually, let me
 *  import something" can undo it without losing the Continue readiness
 *  Onboarding already granted.
 *
 *  Continue is ready from the moment this screen mounts, not gated on
 *  skipped/imported: starting fresh with nothing imported is always a valid
 *  answer here, not a special case you have to opt into by finding the Skip
 *  link first — same "must not feel like a mistake" rule the spec states for
 *  Skip applies to leaving via Continue too. */
export function ImportStep({ onOpenSpace, onReady }: Props): React.JSX.Element {
  const [skipped, setSkipped] = useState(false)
  const [importedFolder, setImportedFolder] = useState<string | null>(null)

  useEffect(() => {
    onReady({ ready: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (skipped) {
    return (
      <div className="flex flex-col items-center gap-4 text-center">
        <h1 className="font-display text-[24px] font-semibold text-ink-900">Already have notes somewhere?</h1>
        <p className="text-[13.5px] text-ink-500">Starting fresh — you can bring notes in later from Settings.</p>
        <button
          type="button"
          onClick={() => setSkipped(false)}
          className="rounded border-none bg-transparent p-0 text-[12px] text-brand-600 underline-offset-2 hover:underline"
        >
          Actually, let me import something
        </button>
      </div>
    )
  }

  if (importedFolder) {
    return (
      <div className="flex flex-col items-center gap-4 text-center">
        <h1 className="font-display text-[22px] font-semibold text-ink-900">Notes brought in</h1>
        <p className="max-w-[420px] text-[13.5px] leading-relaxed text-ink-500">
          They&rsquo;re in a space called &ldquo;{importedFolder}&rdquo;. You can reorganise any of this
          later — nothing&rsquo;s locked in place.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center gap-5 text-center">
      <div>
        <h1 className="font-display text-[24px] font-semibold text-ink-900">Already have notes somewhere?</h1>
        <p className="mx-auto mt-3 max-w-[440px] text-[14px] leading-relaxed text-ink-500">
          Bring them in now, or do it later from Settings. Everything you import lands in its own space
          so it can&rsquo;t get mixed up with anything else.
        </p>
      </div>
      <div className="w-full max-w-[480px] rounded-2xl bg-surface/70 px-5 py-4 text-left shadow-card">
        <ImportPanel
          onOpenSpace={async (folder) => {
            await onOpenSpace(folder)
            setImportedFolder(folder)
          }}
          onClose={() => {}}
        />
      </div>
      <button
        type="button"
        onClick={() => setSkipped(true)}
        className="rounded border-none bg-transparent p-0 text-[12.5px] text-ink-400 underline-offset-2 hover:text-ink-600 hover:underline"
      >
        Skip — I&rsquo;m starting fresh
      </button>
    </div>
  )
}
