import { useEffect, useState } from 'react'
import { Icon } from '../../icons'
import { BlocksGuide } from './BlocksGuide'
import { ColoursGuide } from './ColoursGuide'
import { FormatGuide } from './FormatGuide'
import { GUIDES, AREAS, type GuideId } from './guides'
import { LinkingGuide } from './LinkingGuide'
import { TryItContext } from './tryIt'

// Settings → Tutorials. An index of guides, one click deep.
//
// A list rather than one long page, because there will be more of these (and a
// master guide to download) and a settings pane that scrolls for a minute is a
// pane nobody reads to the end of. One click in, one click back — the depth the
// rest of the settings window already uses for the Spaces disclosures.

// The list itself — titles, blurbs, which area each is under, and the words
// Settings search finds it by — is plain data in guides.ts. This pairs each id
// with the component that draws it; the type asks for one per id.
const BODIES: Record<GuideId, () => React.JSX.Element> = {
  linking: LinkingGuide,
  format: FormatGuide,
  colours: ColoursGuide,
  blocks: BlocksGuide
}

/** `openGuide`: a Settings search result for a guide opens that guide itself.
 *  `n` counts the asks, so searching the same guide twice (closed by hand in
 *  between) is still a new ask. `onTryIt`: what a card's Try it button does, told
 *  which guide it was pressed in (the guides themselves reach it through
 *  `TryItContext` and never need to know). Absent, no card shows the button. */
export function Tutorials({
  openGuide = null,
  onTryIt
}: {
  openGuide?: { id: GuideId; n: number } | null
  onTryIt?: (text: string, guide: GuideId) => void
}): React.JSX.Element {
  const [openId, setOpenId] = useState<GuideId | null>(openGuide?.id ?? null)
  useEffect(() => {
    if (openGuide) setOpenId(openGuide.id)
  }, [openGuide])
  const open = GUIDES.find((g) => g.id === openId)

  if (open) {
    const Body = BODIES[open.id]
    return (
      <>
        <button
          type="button"
          onClick={() => setOpenId(null)}
          className="flex w-fit items-center gap-1.5 rounded-lg border-none bg-transparent px-2 py-1 text-[12px] text-ink-500 outline-none transition duration-150 hover:bg-ink-300/15 hover:text-ink-900 focus-visible:ring-2 focus-visible:ring-brand-300"
        >
          <span aria-hidden="true" className="inline-flex rotate-180">
            <Icon name="chevron" className="h-3.5 w-3.5" />
          </span>
          All tutorials
        </button>
        <TryItContext.Provider value={onTryIt ? (text) => onTryIt(text, open.id) : null}>
          <Body />
        </TryItContext.Provider>
      </>
    )
  }

  return (
    <>
      <h3 className="accent-heading font-display text-[15px] font-semibold">Tutorials</h3>
      <p className="mt-0.5 text-[12px] leading-relaxed text-ink-500">
        How the parts of the app that aren&rsquo;t obvious from looking at them actually work.
      </p>

      <div className="mt-3 flex flex-col gap-4">
        {AREAS.map((area) => {
          const guides = GUIDES.filter((g) => g.area === area.id)
          if (guides.length === 0) return null
          return (
            <section key={area.id}>
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-400">
                {area.label}
              </p>
              <div className="flex flex-col gap-2">
                {guides.map((g) => (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => setOpenId(g.id)}
                    className="btn-edge flex items-start gap-3 rounded-xl border-none px-3 py-3 text-left outline-none ring-1 ring-ink-300/20 transition duration-200 hover:bg-ink-300/15 focus-visible:ring-2 focus-visible:ring-brand-300"
                  >
                    <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand-500/15 text-brand-600">
                      <Icon name={g.icon} className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-medium text-ink-800">{g.title}</span>
                      <span className="mt-0.5 block text-[11.5px] leading-relaxed text-ink-400">{g.blurb}</span>
                    </span>
                    <span aria-hidden="true" className="mt-1 shrink-0 text-ink-300">
                      <Icon name="chevron" className="h-3.5 w-3.5" />
                    </span>
                  </button>
                ))}
              </div>
            </section>
          )
        })}
      </div>
    </>
  )
}
