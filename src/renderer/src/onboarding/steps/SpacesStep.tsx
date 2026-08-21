import { useEffect, useRef, useState } from 'react'
import { SPACE_CAP } from '../../../../shared/settings'
import type { OnboardingStepProps } from '../Onboarding'

const PRESETS = ['School', 'Work', 'Journal', 'Projects', 'Ideas', 'Revision', 'Personal', 'Reading']
const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten']

interface Props extends OnboardingStepProps {
  activeSpaceFolder: string
  onOpenSpace: (folder: string) => Promise<void>
}

export function SpacesStep({ onOpenSpace, onReady }: Props): React.JSX.Element {
  const [chosen, setChosen] = useState<string[]>([])
  const [addingCustom, setAddingCustom] = useState(false)
  const [customValue, setCustomValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  // Trying to pick an 11th chip used to just silently do nothing — reads as
  // broken rather than intentional. Flashes the cap explanation into the
  // summary line below for a couple of seconds, then reverts to whatever it
  // would normally show.
  const [atCap, setAtCap] = useState(false)
  const capTimer = useRef<number | null>(null)
  useEffect(() => () => {
    if (capTimer.current != null) window.clearTimeout(capTimer.current)
  }, [])
  const flashAtCap = (): void => {
    setAtCap(true)
    if (capTimer.current != null) window.clearTimeout(capTimer.current)
    capTimer.current = window.setTimeout(() => setAtCap(false), 2200)
  }

  const toggle = (name: string): void => {
    setChosen((c) => {
      if (c.includes(name)) return c.filter((x) => x !== name)
      if (c.length >= SPACE_CAP) {
        flashAtCap()
        return c
      }
      return [...c, name]
    })
  }

  const addCustom = (): void => {
    const v = customValue.trim()
    setCustomValue('')
    setAddingCustom(false)
    if (!v || chosen.includes(v)) return
    if (chosen.length >= SPACE_CAP) {
      flashAtCap()
      return
    }
    setChosen((c) => [...c, v])
  }

  useEffect(() => {
    onReady({
      ready: chosen.length > 0,
      commit:
        chosen.length > 0
          ? async () => {
              const actual: string[] = []
              // Sequential, not Promise.all: createFolder's own auto-suffix
              // ("(2)") depends on seeing the folders this same loop already
              // made, so two calls racing each other could both land on the
              // same free name.
              for (const name of chosen) {
                actual.push(await window.api.createFolder('', name))
              }
              await onOpenSpace(actual[0])
            }
          : undefined
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chosen])

  return (
    <div className="flex flex-col items-center gap-6 text-center">
      <div>
        <h1 className="font-display text-[24px] font-semibold text-ink-900">What do you take notes for?</h1>
        <p className="mx-auto mt-3 max-w-[440px] text-[14px] leading-relaxed text-ink-500">
          Pick as many as you like. Each one becomes a space — its own section of the app, which you can
          make look and work however you want.
        </p>
      </div>

      <div className="grid w-full max-w-[440px] grid-cols-2 gap-2 sm:grid-cols-4">
        {PRESETS.map((name) => {
          const on = chosen.includes(name)
          return (
            <button
              key={name}
              type="button"
              onClick={() => toggle(name)}
              className={
                'rounded-full px-3 py-2 text-[12.5px] font-medium transition duration-150 ' +
                (on
                  ? 'bg-brand-500/12 text-brand-700 ring-2 ring-brand-400'
                  : 'bg-surface/70 text-ink-600 ring-1 ring-ink-300/25 hover:bg-brand-500/8')
              }
            >
              {name}
            </button>
          )
        })}
        {chosen
          .filter((c) => !PRESETS.includes(c))
          .map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => toggle(name)}
              className="col-span-2 rounded-full bg-brand-500/12 px-3 py-2 text-[12.5px] font-medium text-brand-700 ring-2 ring-brand-400 sm:col-span-4"
            >
              {name}
            </button>
          ))}
        {addingCustom ? (
          <input
            ref={inputRef}
            autoFocus
            value={customValue}
            onChange={(e) => setCustomValue(e.target.value)}
            onBlur={addCustom}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addCustom()
              if (e.key === 'Escape') {
                setCustomValue('')
                setAddingCustom(false)
              }
            }}
            placeholder="Name it…"
            className="col-span-2 rounded-full bg-surface/70 px-3 py-2 text-center text-[12.5px] text-ink-800 outline-none ring-1 ring-brand-300 sm:col-span-4"
          />
        ) : (
          <button
            type="button"
            onClick={() => setAddingCustom(true)}
            className="col-span-2 rounded-full bg-surface/40 px-3 py-2 text-[12.5px] text-ink-400 ring-1 ring-dashed ring-ink-300/30 hover:text-ink-600 sm:col-span-4"
          >
            + something else
          </button>
        )}
      </div>

      <p className="min-h-[16px] font-mono text-[12px] text-ink-500">
        {atCap
          ? `That's as many as you can start with here — ${NUMBER_WORDS[SPACE_CAP] ?? SPACE_CAP}. You can add more later from Settings.`
          : chosen.length > 0 &&
            `You'll start with ${NUMBER_WORDS[chosen.length] ?? chosen.length} ${
              chosen.length === 1 ? 'space' : 'spaces'
            }: ${chosen.join(', ')}.`}
      </p>
    </div>
  )
}
