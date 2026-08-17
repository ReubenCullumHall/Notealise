import { useEffect } from 'react'
import { Icon, type IconName } from '../../icons'
import type { SectionId } from '../../settings/Settings'
import type { OnboardingStepProps } from '../Onboarding'

interface Row {
  section: SectionId
  icon: IconName
  label: string
  blurb: string
}

const ROWS: Row[] = [
  { section: 'tutorials', icon: 'book', label: 'Tutorials', blurb: 'Short guides for what isn’t obvious from looking.' },
  { section: 'reportBug', icon: 'flag', label: 'Report a bug', blurb: 'Tell us what broke.' },
  { section: 'requestFeature', icon: 'star', label: 'Request a feature', blurb: 'Suggest something the app doesn’t do yet.' }
]

interface Props extends OnboardingStepProps {
  onOpenSettingsSection: (id: SectionId) => void
}

/** The closing screen — no new artefact (same exception as Welcome), and it
 *  holds the "Start writing" button that used to sit on Disk-proof in the
 *  original spec. Each row jumps straight to the real Settings section
 *  (Sidebar's SettingsButton via App's settingsJumpTo — the same mechanism
 *  the File-menu's "Import notes…" command already uses) rather than
 *  reimplementing tutorials or the bug/feature-request mail forms here. */
export function WalkthroughStep({ onOpenSettingsSection, onReady }: Props): React.JSX.Element {
  useEffect(() => {
    onReady({ ready: true, continueLabel: 'Start writing' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="flex flex-col items-center gap-6 text-center">
      <div>
        <h1 className="font-display text-[24px] font-semibold text-ink-900">Three things worth knowing</h1>
        <p className="mx-auto mt-3 max-w-[420px] text-[14px] leading-relaxed text-ink-500">
          Not required reading — just where to find them when you need them.
        </p>
      </div>

      <div className="flex w-full max-w-[440px] flex-col gap-2">
        {ROWS.map((row) => (
          <button
            key={row.section}
            type="button"
            onClick={() => onOpenSettingsSection(row.section)}
            className="btn-edge flex items-center gap-3 rounded-xl border-none px-3.5 py-3 text-left outline-none ring-1 ring-ink-300/20 transition duration-150 hover:bg-brand-500/8 focus-visible:ring-2 focus-visible:ring-brand-300"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-500/12 text-brand-600">
              <Icon name={row.icon} className="h-4 w-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-medium text-ink-800">{row.label}</span>
              <span className="mt-0.5 block text-[11.5px] leading-relaxed text-ink-400">{row.blurb}</span>
            </span>
            <span aria-hidden="true" className="shrink-0 text-ink-300">
              <Icon name="chevron" className="h-3.5 w-3.5" />
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
