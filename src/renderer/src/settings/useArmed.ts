import { useEffect, useRef, useState } from 'react'

/** How long an armed destructive button stays armed. ONE number, so the two
 *  buttons that use it can't drift apart — it was written out as a literal
 *  `5000` in both Spaces.tsx and Recovery.tsx before this existed. */
const ARM_MS = 5000

/** The app's arm-then-confirm idiom for a destructive button: one click arms it,
 *  a second within `ARM_MS` commits, and it disarms itself if left alone.
 *
 *  Deliberately not a confirm dialog — there isn't one anywhere in the app, and
 *  `window.confirm` blocks the Electron renderer and looks foreign.
 *
 *  A hook rather than a component because the two places using it need different
 *  markup around the same behaviour: Spaces' "Delete space" grows an extra "and
 *  its saved look" tick while armed, and Recovery's renders either a text pill or
 *  an icon-only trash button. What they must NOT each keep is their own copy of
 *  the timer. In its own file rather than primitives.tsx for the reason
 *  useInstalledFonts.ts is: a module that exports components AND a hook trips
 *  fast refresh.
 *
 *  `reset` is for extra armed-only state the caller owns (that tick), cleared on
 *  the same disarm. */
export function useArmed(reset?: () => void): {
  armed: boolean
  /** call from onClick: arms on the first press, returns true on the second */
  press: () => boolean
  disarm: () => void
} {
  const [armed, setArmed] = useState(false)
  // Via a ref so a caller passing an inline arrow (which every caller does)
  // doesn't restart the disarm timer on every render.
  const resetRef = useRef(reset)
  resetRef.current = reset

  const disarm = (): void => {
    setArmed(false)
    resetRef.current?.()
  }

  useEffect(() => {
    if (!armed) return
    const t = setTimeout(() => {
      setArmed(false)
      resetRef.current?.()
    }, ARM_MS)
    return () => clearTimeout(t)
  }, [armed])

  return {
    armed,
    press: () => {
      if (armed) {
        disarm()
        return true
      }
      setArmed(true)
      return false
    },
    disarm
  }
}
