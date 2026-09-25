import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ImportPanel } from '../../import/ImportPanel'
import { Icon } from '../../icons'
import { tiltFromPointer } from '../press3d'
import type { OnboardingStepProps } from '../Onboarding'

interface Props extends OnboardingStepProps {
  onOpenSpace: (folder: string) => Promise<void>
  /** Called once, right after a real import finishes, with the path of a new
   *  note seeded in the imported space to explain how it's organised. Lifted
   *  to Onboarding so it can hand the path to App at the very end of the flow
   *  — that's the only place a note can actually be opened in the real pane. */
  onImported: (notePath: string) => void
  /** the app's own animations switch — off means the choice swaps instantly */
  animationsEnabled: boolean
}

// Keep in step with `.onboarding-morph` in app.css (the height) and with
// `.onboarding-fade-out` (the choice cards leaving).
const MORPH_MS = 300
const LEAVE_MS = 150
// How long everything around the chosen card takes to fade (`aside` and
// `.onboarding-recede` in app.css) before the card itself goes with the step.
const RECEDE_MS = 200
// Most a pressed card tips towards the pointer — "a slight 3d effect".
const TILT_DEG = 3.5

type Picked = 'import' | 'fresh'

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
 *  Opens on two big choices, not the panel (Reuben, 2026-09-23): most people
 *  have nothing to import, and a format dropdown, a file chooser, a name field
 *  and an Import button is a lot to show someone just to have them skip it.
 *  "Start fresh" advances; "Import notes" opens the panel in place. The box
 *  under the heading animates its height between the two so the heading glides
 *  up instead of jumping — and keeps following the panel afterwards, when its
 *  preview and warnings grow it.
 *
 *  Continue is ready from the moment this screen mounts: starting fresh with
 *  nothing imported is always a valid answer here, not a special case you
 *  have to opt into. "Start fresh" therefore just advances immediately
 *  (`onAdvance`) rather than routing through a second "are you sure" screen —
 *  that screen used to exist and only re-showed the same already-enabled
 *  Continue button, which was a confirmation step with no decision left to
 *  make. Changing your mind is still one Back click away, same as any other
 *  step. Once the panel is open, Continue is the way out without importing:
 *  the "Skip — I'm starting fresh" link that used to sit under it said the
 *  same thing as Continue, and at the default window size it sat half-hidden
 *  behind it (removed at Reuben's call, 2026-09-25). */
export function ImportStep({
  onOpenSpace,
  onImported,
  onReady,
  onAdvance,
  animationsEnabled
}: Props): React.JSX.Element {
  const [importedFolder, setImportedFolder] = useState<string | null>(null)
  const [mode, setMode] = useState<'choose' | 'import'>('choose')
  const [leaving, setLeaving] = useState(false)
  const [picked, setPicked] = useState<Picked | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  // Every delayed step of a pick, cleared on unmount — so a Continue or Back
  // click that leaves this step mid-pick can't have the pick's own onAdvance
  // fire a moment later on whichever step replaced it.
  const timers = useRef<number[]>([])
  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), [])
  const later = (fn: () => void, ms: number): void => {
    timers.current.push(window.setTimeout(fn, ms))
  }

  useEffect(() => {
    onReady({ ready: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The box's height is always set to its content's, so `.onboarding-morph`'s
  // transition animates every change. Clipped only while it moves: the
  // panel's format dropdown is absolutely positioned and has to be free to
  // hang out of it the rest of the time.
  useLayoutEffect(() => {
    const b = box.current
    const c = content.current
    if (!b || !c) return
    let unclip = 0
    b.style.height = `${c.offsetHeight}px` // auto -> px does not animate: no slide on mount
    const ro = new ResizeObserver(() => {
      const h = `${c.offsetHeight}px`
      if (b.style.height === h) return
      b.style.overflow = 'hidden'
      b.style.height = h
      window.clearTimeout(unclip)
      unclip = window.setTimeout(() => (b.style.overflow = ''), MORPH_MS + 40)
    })
    ro.observe(c)
    return () => {
      ro.disconnect()
      window.clearTimeout(unclip)
    }
  }, [])

  // A pick fades the page out from around the pressed card before the card
  // itself goes: the other card is set aside and (for Start fresh) the
  // heading recedes, while the chosen card holds its pressed pose; then the
  // step moves on and the card leaves last. With animations off it acts at
  // once, exactly as before.
  const pick = (which: Picked): void => {
    if (picked) return
    const act = (): void => {
      if (which === 'fresh') {
        onAdvance()
        return
      }
      if (!animationsEnabled) {
        setMode('import')
        return
      }
      setLeaving(true)
      later(() => {
        setMode('import')
        setLeaving(false)
      }, LEAVE_MS)
    }
    if (!animationsEnabled) {
      act()
      return
    }
    setPicked(which)
    later(act, RECEDE_MS)
  }
  const stateOf = (which: Picked): ChoiceState =>
    picked == null ? 'idle' : picked === which ? 'chosen' : 'aside'

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
      {/* Recedes only for Start fresh — the next page is a different one. An
          import stays on this page, under this same heading. */}
      <div className={picked === 'fresh' ? 'onboarding-recede' : undefined}>
        <h1 className="font-display text-[24px] font-semibold text-ink-900">Already have notes somewhere?</h1>
        <p className="mx-auto mt-3 max-w-[440px] text-[14px] leading-relaxed text-ink-500">
          Bring them in now, or do it later from Settings. Everything you import lands in its own space
          so it can&rsquo;t get mixed up with anything else.
        </p>
      </div>
      <div ref={box} className={'w-full max-w-[480px]' + (animationsEnabled ? ' onboarding-morph' : '')}>
        <div ref={content} className="flex flex-col items-center gap-5 pb-1">
          {mode === 'choose' ? (
            <div
              className={
                'flex w-full gap-3' +
                (animationsEnabled && leaving ? ' onboarding-fade-out' : '')
              }
            >
              <Choice
                icon="import"
                title="Import notes"
                hint="From Notion, Word, Markdown and more"
                state={stateOf('import')}
                onClick={() => pick('import')}
              />
              <Choice
                icon="edit"
                title="Start fresh"
                hint="Nothing to bring in"
                state={stateOf('fresh')}
                onClick={() => pick('fresh')}
              />
            </div>
          ) : (
            <div
              className={
                'w-full rounded-2xl bg-surface/70 px-5 py-4 text-left shadow-card' +
                (animationsEnabled ? ' onboarding-fade-in' : '')
              }
            >
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
                variant="onboarding"
              />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

type ChoiceState = 'idle' | 'chosen' | 'aside'

/** One of the two big buttons. Hover moves the ring, never the card — see
 *  CLAUDE.md's motion rule; pressing sinks and tips it (`.press-3d` in
 *  app.css), and the chosen card holds that pose while the page fades. Top-aligned, not centred: the two hints wrap to different
 *  line counts, and centring put the two titles 14px apart. */
function Choice({
  icon,
  title,
  hint,
  state,
  onClick
}: {
  icon: 'import' | 'edit'
  title: string
  hint: string
  state: ChoiceState
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      onPointerDown={(e) => tiltFromPointer(e, TILT_DEG)}
      data-state={state}
      data-pressed={state === 'chosen' ? '' : undefined}
      // A picked pair is spent: the chosen one is on its way, the other is
      // fading out. Neither should take a second click or keyboard focus.
      tabIndex={state === 'idle' ? 0 : -1}
      className="onboarding-choice press-3d flex min-h-[150px] min-w-0 flex-1 flex-col items-center justify-start gap-2 rounded-2xl border-none bg-surface/70 px-5 py-6 text-center shadow-card outline-none ring-1 ring-ink-300/25 transition duration-150 hover:ring-ink-400/40 focus-visible:ring-2 focus-visible:ring-brand-300"
    >
      <Icon name={icon} className="h-6 w-6 text-ink-500" />
      <span className="mt-1 text-[15px] font-medium text-ink-900">{title}</span>
      <span className="text-[12px] leading-snug text-ink-400">{hint}</span>
    </button>
  )
}
