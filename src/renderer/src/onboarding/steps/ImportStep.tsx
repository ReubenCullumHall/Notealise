import { useEffect, useState } from 'react'
import { ImportPanel } from '../../import/ImportPanel'
import type { OnboardingStepProps } from '../Onboarding'

interface Props extends OnboardingStepProps {
  onOpenSpace: (folder: string) => Promise<void>
  /** Called once, right after a real import finishes, with the path of a new
   *  note seeded in the imported space to explain how it's organised. Lifted
   *  to Onboarding so it can hand the path to App at the very end of the flow
   *  — that's the only place a note can actually be opened in the real pane. */
  onImported: (notePath: string) => void
}

// Placeholder copy — Reuben wants to rewrite this once the sequence itself
// works (docs/onboarding-plan.md's per-format organise popup is still just
// one generic message; this is that message, as a note instead of a popup).
const ORGANISE_NOTE_TEXT = `# How this import is organised

Everything you just brought in landed in this space, on its own, so it can't get mixed up with anything else.

Feel free to reorganise it however you like — move notes, make folders, rename things. Nothing here is locked in place.
`

/** Wraps the real ImportPanel (built for the Settings modal — see
 *  docs/onboarding-plan.md's "Import embedding" note) rather than a copy of
 *  it, so the six formats and their platform gating never drift out of step.
 *
 *  Continue is ready from the moment this screen mounts: starting fresh with
 *  nothing imported is always a valid answer here, not a special case you
 *  have to opt into. Skip therefore just advances immediately (`onAdvance`)
 *  rather than routing through a second "are you sure" screen — that screen
 *  used to exist and only re-showed the same already-enabled Continue button,
 *  which was a confirmation step with no decision left to make. Changing
 *  your mind is still one Back click away, same as any other step. */
export function ImportStep({ onOpenSpace, onImported, onReady, onAdvance }: Props): React.JSX.Element {
  const [importedFolder, setImportedFolder] = useState<string | null>(null)

  useEffect(() => {
    onReady({ ready: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
            // Routed through the same createNote/writeNote path every other
            // onboarding artefact uses (never a bespoke fs write) — see
            // main/vault.ts's createNote, which auto-suffixes on collision.
            const notePath = await window.api.createNote(folder, 'How this import is organised')
            await window.api.writeNote(notePath, ORGANISE_NOTE_TEXT)
            onImported(notePath)
            setImportedFolder(folder)
          }}
          onClose={() => {}}
        />
      </div>
      <button
        type="button"
        onClick={onAdvance}
        className="rounded border-none bg-transparent p-0 text-[12.5px] text-ink-400 underline-offset-2 hover:text-ink-600 hover:underline"
      >
        Skip — I&rsquo;m starting fresh
      </button>
    </div>
  )
}
