import { useRef, useState } from 'react'
import type { ResolvedThemeId } from '../../../shared/settings'
import { Icon } from '../icons'
import { STEPS, nextStep, prevStep, stepIndex, type StepId } from './model'
import { WelcomeStep } from './steps/WelcomeStep'
import { VaultStep } from './steps/VaultStep'
import { ImportStep } from './steps/ImportStep'
import { SpacesStep } from './steps/SpacesStep'
import { WriteStep } from './steps/WriteStep'
import { DiskProofStep } from './steps/DiskProofStep'
import { FontsStep } from './steps/FontsStep'

/** What the current step reports up, so the ONE shared Continue button (never
 *  a per-step button — "same box, same size, every time") knows what to do. */
export interface StepReadyState {
  ready: boolean
  /** run when Continue is clicked, before advancing (e.g. Write saves the note) */
  commit?: () => void | Promise<void>
  /** overrides "Continue" — Fonts uses it for "Start writing" (the last step
   *  since Walkthrough was cut, 2026-08-20); Vault uses it for "Pick up where
   *  you left off" when it recognises an already-set-up folder */
  continueLabel?: string
  /** Vault step only: the picked folder already has a Notealise setup in it, so
   *  Continue ends the flow here instead of walking through Import → Spaces →
   *  Write → Disk-proof → Fonts. `onFinished` is told not to seed welcome notes
   *  over the top of the folder's real ones. */
  skipToFinish?: boolean
}

export interface OnboardingStepProps {
  onReady: (state: StepReadyState) => void
  /** Advance immediately, as if Continue had been clicked — for a step's own
   *  "skip this" action, where showing a second confirmation screen just to
   *  re-enable the same Continue button that was already enabled is friction
   *  with no payoff. Runs the current `commit` (if any) then moves on, same
   *  as a real Continue click — it does NOT bypass readiness. */
  onAdvance: () => void
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
  /** same reasoning as noteFont, for the accent swatch added 2026-08-20 */
  accent: string
  /** Which step to render first — App.tsx reads this from
   *  `userData/config.json` (main/config.ts's onboardingStep) before ever
   *  mounting this component, so a quit-and-relaunch mid-flow resumes here
   *  instead of always restarting at 'welcome'. */
  initialStep: StepId
  onPickVault: () => Promise<void>
  onOpenSpace: (folder: string) => Promise<void>
  onPickNoteFont: (id: string) => void
  onPickAccent: (id: string) => void
  /** Called once, at the very end of the flow — awaited, and NOT what
   *  unmounts this component (see onDismissed). Does the real finishing work
   *  (seeding the welcome notes, opening one) while onboarding is still
   *  fully on screen; `importNotePath` is set only when a real import ran
   *  this session, and opens the "how this import is organised" note
   *  instead of the welcome note every other first run opens on. */
  onFinished: (
    importNotePath: string | null,
    opts?: { established?: boolean }
  ) => Promise<void>
  /** Called after onFinished resolves AND the closing fade has played —
   *  THIS is what App.tsx uses to flip `hasOnboarded` and unmount Onboarding.
   *  Split from onFinished so the real app underneath is already showing its
   *  finished state (welcome note open, sidebar populated) by the time the
   *  overlay actually goes away — a reveal, not a fade to blank followed by
   *  things popping in a moment later. */
  onDismissed: () => void
}

/** The whole first-run flow: docs/onboarding-plan.md, extended 2026-08-17 with
 *  a Welcome screen and a closing Customisation pair, then again 2026-08-20
 *  when the closing Walkthrough screen was cut — its pointers (Tutorials,
 *  Report a bug, Request a feature) moved into the welcome note App.tsx seeds
 *  and opens on finish, so landing in the real app carries the ending instead
 *  of a settings-links screen coming right after Disk-reveal's peak. Mounted
 *  by App.tsx as a full-screen overlay whenever `!hasOnboarded` — the real app
 *  shell mounts underneath it once a vault exists, the same "already loading
 *  behind it" pattern StartupSplash uses.
 *
 *  2026-08-21: between-step motion is a plain crossfade (was a left/right
 *  slide), and finishing plays its own longer dismiss-fade on the whole
 *  overlay — see `exiting`/`closing` below and onFinished/onDismissed above. */
export function Onboarding({
  vault,
  activeSpaceFolder,
  theme,
  animationsEnabled,
  noteFont,
  accent,
  initialStep,
  onPickVault,
  onOpenSpace,
  onPickNoteFont,
  onPickAccent,
  onFinished,
  onDismissed
}: Props): React.JSX.Element {
  const [step, setStep] = useState<StepId>(initialStep)
  const [animKey, setAnimKey] = useState(0)
  // True for the brief window between clicking Continue/Back and the step
  // actually swapping — the CURRENT step's content fades OUT first, then
  // swaps to the next step which fades IN (`onboarding-fade-in`). Without
  // this the outgoing step just vanished on the same frame the incoming one
  // appeared — no exit motion at all, which read as an instant cut rather
  // than a crossfade. Sequential rather than a true simultaneous overlap on
  // purpose: the incoming step is a fresh mount (as it should be — a step is
  // meant to start from its own initial state), but the OUTGOING step is the
  // SAME instance animated via a class swap, not a clone — cloning it to
  // overlap would remount it and show its blank initial state (no chips
  // picked, no imported-space summary) fading away instead of what was
  // actually on screen. No direction to track any more (2026-08-21: dropped
  // the earlier left/right slide at Reuben's request) — a fade reads the
  // same going forward or back.
  const [exiting, setExiting] = useState(false)
  // True once the LAST step's Continue has run its real finishing work and
  // the whole overlay is fading out for the hand-off into the real app — see
  // onDismissed above. Distinct from `exiting`: that's a between-step fade on
  // the inner content; this is the once-ever fade on the outer overlay itself.
  const [closing, setClosing] = useState(false)
  const [ready, setReady] = useState<StepReadyState>({ ready: false })
  const [busy, setBusy] = useState(false)
  // THE authoritative "a navigation is already in flight" guard, and the reason
  // it's a ref rather than the `busy`/`exiting` state beside it: those two only
  // reach this closure (and the button's `disabled`) on the NEXT render, so two
  // clicks landing in the same tick both read the stale `false` and both run.
  // Every commit in this wizard is a filesystem write, so a double-fire means a
  // duplicate note on disk, not a harmless no-op — and a Back click arriving
  // while a slow commit is still running would otherwise navigate immediately,
  // only for the in-flight `onContinue` to finish and `goTo(next)` over the top
  // of it, silently throwing the user forward again. A ref updates
  // synchronously, which is what actually closes both windows; `busy` stays
  // purely for what it renders (the button's label and disabled state).
  const navLock = useRef(false)
  // The note Write writes and Disk-proof shows off — lifted here because both
  // steps need it, and re-reading it off disk would race the autosave.
  const [notePath, setNotePath] = useState<string | null>(null)
  const [noteText, setNoteText] = useState('')
  // Set once, by Import, only if a real import actually ran this session —
  // handed to onFinished so App can open the workspace on it. Not reset by
  // going Back into Import and skipping instead: re-importing overwrites it
  // via ImportStep's own onImported call, same "last write wins" as notePath.
  const [importNotePath, setImportNotePath] = useState<string | null>(null)
  // Has the flow gone past the Vault step at any point this session? Once it
  // has, a folder that "looks set up" is that progress talking (the Spaces step
  // wrote settings.json), not a prior completed setup — so the Vault step's
  // "pick up where you left off" short-circuit is withdrawn. A ref, not state:
  // it only needs to be right by the time `goTo` re-renders VaultStep, which it
  // always does (the step subtree is keyed on `animKey`).
  const advancedPastVault = useRef(stepIndex(initialStep) > stepIndex('vault'))

  const idx = stepIndex(step)

  // How long the outgoing step gets to fade out before the incoming one
  // (still `onboarding-fade-in`'s own 260ms) takes over. Kept short — this
  // is an 8-screen forced sequence, not a place to feel slow — but non-zero,
  // which is the entire fix: zero was the bug.
  const EXIT_MS = 150
  // The whole-overlay dismiss fade, once — longer than a between-step one on
  // purpose, since this is the single moment that ends the flow rather than
  // one screen replacing another (matching `.onboarding-dismiss` in app.css).
  const CLOSE_MS = 320

  const goTo = (id: StepId): void => {
    navLock.current = true // held across the exit animation, released by swap

    const swap = (): void => {
      if (stepIndex(id) > stepIndex('vault')) advancedPastVault.current = true
      setStep(id)
      setAnimKey((k) => k + 1)
      setReady({ ready: false })
      setExiting(false)
      navLock.current = false
      // Fire-and-forget: worth persisting so a quit mid-flow resumes here, but
      // nothing in this flow should ever block on the write completing.
      void window.api.setOnboardingStep(id)
    }

    if (!animationsEnabled) {
      swap()
      return
    }
    setExiting(true)
    window.setTimeout(swap, EXIT_MS)
  }

  const onContinue = async (): Promise<void> => {
    // navLock covers both windows the old `busy || exiting` state pair missed:
    // a second click in the same tick as the first, and a click inside the
    // EXIT_MS gap goTo opens (where `ready` still belongs to the step we're
    // leaving, so a re-run would commit it twice).
    if (!ready.ready || navLock.current) return
    // Captured before commit/goTo can touch `ready`: the Vault step sets this
    // when the folder it was handed already has a Notealise setup, and it means
    // "end the flow here" no matter which step we're on.
    const finishNow = ready.skipToFinish === true
    navLock.current = true
    setBusy(true)
    try {
      await ready.commit?.()
    } finally {
      // Released unconditionally: a commit that throws must leave the wizard
      // usable so the user can fix whatever failed and click Continue again,
      // not wedge it. goTo/the closing branch below re-take the lock for
      // their own animation windows.
      navLock.current = false
      setBusy(false)
    }
    const next = finishNow ? null : nextStep(step)
    if (next) {
      goTo(next)
      return
    }
    // Last step (or the Vault step recognised an existing setup). Do the real
    // finishing work (seed the welcome notes, open one) while onboarding is
    // STILL fully visible — the app shell underneath updates invisibly behind
    // this overlay, so by the time the dismiss fade below reveals it, it's
    // already showing the finished state rather than a blank pane that then
    // pops. onDismissed (not onFinished) is what actually unmounts this
    // component. When `finishNow`, there's a real vault behind the overlay
    // already — pass `established` so onFinished doesn't seed welcome notes
    // over the top of the folder's own.
    navLock.current = true
    setBusy(true)
    try {
      await onFinished(finishNow ? null : importNotePath, finishNow ? { established: true } : undefined)
    } finally {
      navLock.current = false
      setBusy(false)
    }
    if (!animationsEnabled) {
      onDismissed()
      return
    }
    navLock.current = true
    setClosing(true)
    window.setTimeout(onDismissed, CLOSE_MS)
  }

  const back = (): void => {
    // Same lock as Continue, and for a reason Back specifically needs: it used
    // to check only `exiting`, so it could fire mid-commit and be overridden a
    // moment later by the still-running onContinue's own goTo.
    if (navLock.current) return
    const p = prevStep(step)
    if (p) goTo(p)
  }

  const stepProps: OnboardingStepProps = { onReady: setReady, onAdvance: () => void onContinue() }

  return (
    // z-55, not higher: Settings is z-[60] and has to land ABOVE this overlay
    // to be visible/clickable at all, should anything inside onboarding ever
    // open it again — see Settings.tsx's portal. Still well above the plain
    // app shell underneath, which has no z-index of its own.
    <div
      className={
        'fixed inset-0 z-[55] flex items-center justify-center bg-paper' +
        (animationsEnabled && closing ? ' onboarding-dismiss' : '')
      }
    >
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
            className={
              !animationsEnabled ? undefined : exiting ? 'onboarding-fade-out' : 'onboarding-fade-in'
            }
          >
            {step === 'welcome' && <WelcomeStep {...stepProps} theme={theme} />}
            {step === 'vault' && (
              <VaultStep
                {...stepProps}
                vault={vault}
                onPickVault={onPickVault}
                // Only a run that hasn't gone past Vault gets the "you've set
                // this folder up before" short-circuit. Once it has (resumed
                // from a later step, or advanced and stepped Back), a folder
                // that looks established is this session's own Spaces step
                // writing settings.json, not a prior completed setup.
                recogniseExistingSetup={!advancedPastVault.current}
              />
            )}
            {step === 'import' && (
              <ImportStep {...stepProps} onOpenSpace={onOpenSpace} onImported={setImportNotePath} />
            )}
            {step === 'spaces' && (
              <SpacesStep {...stepProps} activeSpaceFolder={activeSpaceFolder} onOpenSpace={onOpenSpace} />
            )}
            {step === 'write' && (
              <WriteStep
                {...stepProps}
                spaceFolder={activeSpaceFolder}
                text={noteText}
                onTextChange={setNoteText}
                savedPath={notePath}
                onSaved={setNotePath}
              />
            )}
            {step === 'diskProof' && <DiskProofStep {...stepProps} notePath={notePath} noteText={noteText} />}
            {step === 'fonts' && (
              <FontsStep
                {...stepProps}
                theme={theme}
                value={noteFont}
                onPick={onPickNoteFont}
                accent={accent}
                onPickAccent={onPickAccent}
              />
            )}
          </div>
        </div>

        <div className="flex w-full flex-col items-center gap-5 pb-2">
          <button
            type="button"
            disabled={!ready.ready || busy || exiting || closing}
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
