// Pure step-sequence arithmetic, kept separate from the React shell the same
// way tabs/model.ts holds pane arithmetic apart from NotePane.tsx.
//
// Resume-at-this-exact-step IS persisted (main/config.ts's onboardingStep,
// written on every step change and read at boot alongside hasOnboarded) —
// quitting mid-flow and relaunching resumes on the same step, with 'vault'
// auto-skipping past the picker if a folder was already chosen. Steps that
// already ran (a space created, a note written) aren't undone; re-running
// 'spaces' with the same chip picked again just lands on "<name> (2)" rather
// than colliding.

export type StepId = 'welcome' | 'vault' | 'import' | 'spaces' | 'write' | 'diskProof' | 'fonts'

export const STEPS: readonly StepId[] = [
  'welcome',
  'vault',
  'import',
  'spaces',
  'write',
  'diskProof',
  'fonts'
]

export function stepIndex(id: StepId): number {
  return STEPS.indexOf(id)
}

export function nextStep(id: StepId): StepId | null {
  const i = stepIndex(id)
  return i >= 0 && i < STEPS.length - 1 ? STEPS[i + 1] : null
}

export function prevStep(id: StepId): StepId | null {
  const i = stepIndex(id)
  return i > 0 ? STEPS[i - 1] : null
}
