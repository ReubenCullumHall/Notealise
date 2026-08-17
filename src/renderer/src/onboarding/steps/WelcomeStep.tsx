import { useEffect } from 'react'
import type { ResolvedThemeId } from '../../../../shared/settings'
import type { OnboardingStepProps } from '../Onboarding'
import inkSrc from '../../assets/promo/notealise-ink.webm'
import whiteSrc from '../../assets/promo/notealise-white.webm'

// Same canvas as StartupSplash.tsx (notes-app/promo/README.md) — pinning the
// ratio keeps the box stable before the clip's metadata has loaded.
const ASPECT = '2206 / 524'

interface Props extends OnboardingStepProps {
  theme: ResolvedThemeId
}

/** The only screen with no artefact of its own — pure orientation, kept short
 *  on purpose. Reuses the exact clip StartupSplash.tsx plays on every vault
 *  open; nothing here gates Continue on it finishing. */
export function WelcomeStep({ theme, onReady }: Props): React.JSX.Element {
  useEffect(() => {
    onReady({ ready: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const src = theme === 'light' ? inkSrc : whiteSrc

  return (
    <div className="flex flex-col items-center gap-8 text-center">
      <div>
        <h1 className="font-display text-[26px] font-semibold text-ink-900">Before you start writing</h1>
        <p className="mx-auto mt-3 max-w-[420px] text-[14px] leading-relaxed text-ink-500">
          A few short screens — where your notes live, what they&rsquo;re for, how the app works. Then
          you&rsquo;re writing.
        </p>
      </div>
      <video
        src={src}
        autoPlay
        muted
        playsInline
        style={{ width: '44vw', maxWidth: 440, aspectRatio: ASPECT }}
      />
    </div>
  )
}
