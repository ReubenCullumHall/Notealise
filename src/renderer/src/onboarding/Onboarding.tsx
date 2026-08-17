import { useRef, useState } from 'react'
import type { ResolvedThemeId } from '../../../shared/settings'
import type { SectionId } from '../settings/Settings'
import { Icon } from '../icons'
import { STEPS, nextStep, prevStep, stepIndex, type StepId } from './model'
import { WelcomeStep } from './steps/WelcomeStep'
import { VaultStep } from './steps/VaultStep'
import { ImportStep } from './steps/ImportStep'
import { SpacesStep } from './steps/SpacesStep'
import { WriteStep } from './steps/WriteStep'
import { DiskProofStep } from './steps/DiskProofStep'
import { FontsStep } from './steps/FontsStep'
import { WalkthroughStep } from './steps/WalkthroughStep'

/** What the current step reports up, so the ONE shared Continue button (never
 *  a per-step button — "same box, same size, every time") knows what to do. */
export interface StepReadyState {
  ready: boolean
  /** run when Continue is clicked, before advancing (e.g. Write saves the note) */
  commit?: () => void | Promise<void>
  /** overrides "Continue" — only Walkthrough uses this, for "Start writing" */
  continueLabel?: string
}

export interface OnboardingStepProps {
  onReady: (state: StepReadyState) => void
}

interface Props {
  vault: string | null
  activeSpaceFolder: string
  theme: ResolvedThemeId
  animationsEnabled: boolean
  /** the active space's `font` — lifted so the Fonts step's pick survives
   *  stepping Back and Forward over it, and so it's a REAL setting write
   *  rather than a value onboarding holds and applies at the end */
  noteFont: string
  onPickVault: () => Promise<void>
  onOpenSpace: (folder: string) => Promise<void>
  onPickNoteFont: (id: string) => void
  onOpenSettingsSection: (id: SectionId) => void
  onFinished: () => void
}

/** The whole first-run flow: docs/onboarding-plan.md, extended 2026-08-17 with
 *  a Welcome screen and a closing Customisation/Walkthrough pair. Mounted by
 *  App.tsx as a full-screen overlay whenever `!hasOnboarded` — the real app
 *  shell mounts underneath it once a vault exists, the same "already loading
 *  behind it" pattern StartupSplash uses, so Walkthrough's Settings links (via
 *  `onOpenSettingsSection`) reach the real, already-mounted Settings window. */
export function Onboarding({
  vault,
  activeSpaceFolder,
  theme,
  animationsEnabled,
  noteFont,
  onPickVault,
  onOpenSpace,
  onPickNoteFont,
  onOpenSettingsSection,
  onFinished
}: Props): React.JSX.Element {
  const [step, setStep] = useState<StepId>('welcome')
  const [animKey, setAnimKey] = useState(0)
  const [dir, setDir] = useState<1 | -1>(1)
  const prevIdxRef = useRef(stepIndex('welcome'))
  const [ready, setReady] = useState<StepReadyState>({ ready: false })
  const [busy, setBusy] = useState(false)
  // The note Write writes and Disk-proof shows off — lifted here because both
  // steps need it, and re-reading it off disk would race the autosave.
  const [notePath, setNotePath] = useState<string | null>(null)
  const [noteText, setNoteText] = useState('')

  const idx = stepIndex(step)

  const goTo = (id: StepId): void => {
    const i = stepIndex(id)
    setDir(i >= prevIdxRef.current ? 1 : -1)
    prevIdxRef.current = i
    setStep(id)
    setAnimKey((k) => k + 1)
    setReady({ ready: false })
  }

  const onContinue = async (): Promise<void> => {
    if (!ready.ready || busy) return
    setBusy(true)
    try {
      await ready.commit?.()
    } finally {
      setBusy(false)
    }
    const next = nextStep(step)
    if (next) goTo(next)
    else onFinished()
  }

  const back = (): void => {
    const p = prevStep(step)
    if (p) goTo(p)
  }

  const stepProps: OnboardingStepProps = { onReady: setReady }

  return (
    // z-55, not higher: Settings (opened from Walkthrough's rows) is z-[60],
    // and it has to land ABOVE this overlay to be visible/clickable at all —
    // see Settings.tsx's portal. Still well above the plain app shell
    // underneath, which has no z-index of its own.
    <div className="fixed inset-0 z-[55] flex items-center justify-center bg-paper">
      <div className="relative flex h-full w-full max-w-[720px] flex-col items-center px-6 py-14">
        <button
          type="button"
          onClick={back}
          aria-hidden={step === 'welcome'}
          tabIndex={step === 'welcome' ? -1 : 0}
          className={
            'absolute left-4 top-10 flex h-9 w-9 items-center justify-center rounded-full text-ink-400 transition duration-150 hover:bg-brand-500/10 hover:text-ink-700 sm:left-6 ' +
            (step === 'welcome' ? 'pointer-events-none opacity-0' : 'opacity-100')
          }
        >
          <Icon name="chevron" className="h-4 w-4 rotate-180" />
        </button>

        <div className="flex w-full flex-1 flex-col items-center justify-center overflow-hidden">
          <div
            key={animKey}
            style={{ width: '100%' }}
            className={animationsEnabled ? (dir === 1 ? 'onboarding-in-fwd' : 'onboarding-in-back') : undefined}
          >
            {step === 'welcome' && <WelcomeStep {...stepProps} theme={theme} />}
            {step === 'vault' && <VaultStep {...stepProps} vault={vault} onPickVault={onPickVault} />}
            {step === 'import' && <ImportStep {...stepProps} onOpenSpace={onOpenSpace} />}
            {step === 'spaces' && (
              <SpacesStep {...stepProps} activeSpaceFolder={activeSpaceFolder} onOpenSpace={onOpenSpace} />
            )}
            {step === 'write' && (
              <WriteStep
                {...stepProps}
                spaceFolder={activeSpaceFolder}
                text={noteText}
                onTextChange={setNoteText}
                onSaved={setNotePath}
              />
            )}
            {step === 'diskProof' && <DiskProofStep {...stepProps} notePath={notePath} noteText={noteText} />}
            {step === 'fonts' && <FontsStep {...stepProps} value={noteFont} onPick={onPickNoteFont} />}
            {step === 'walkthrough' && (
              <WalkthroughStep {...stepProps} onOpenSettingsSection={onOpenSettingsSection} />
            )}
          </div>
        </div>

        <div className="flex w-full flex-col items-center gap-5 pb-2">
          <button
            type="button"
            disabled={!ready.ready || busy}
            onClick={() => void onContinue()}
            className="rounded-full bg-brand-600 px-7 py-2.5 text-[14px] font-medium text-paper transition duration-150 hover:bg-brand-700 disabled:cursor-default disabled:opacity-40 disabled:hover:bg-brand-600"
          >
            {busy ? 'One moment…' : (ready.continueLabel ?? 'Continue')}
          </button>
          <div className="flex items-center gap-2" aria-hidden="true">
            {STEPS.map((id, i) => (
              <span
                key={id}
                className={
                  'rounded-full transition-all duration-200 ' +
                  (i === idx ? 'h-1.5 w-4 bg-brand-500' : 'h-1.5 w-1.5 bg-ink-300/40')
                }
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
