import { useState } from 'react'
import { Icon, type IconName } from '../../icons'
import { LinkingGuide } from './LinkingGuide'

// Settings → Tutorials. An index of guides, one click deep.
//
// A list rather than one long page, because there will be more of these (and a
// master guide to download) and a settings pane that scrolls for a minute is a
// pane nobody reads to the end of. One click in, one click back — the depth the
// rest of the settings window already uses for the Spaces disclosures.

interface Guide {
  id: string
  title: string
  blurb: string
  icon: IconName
  body: () => React.JSX.Element
}

const GUIDES: Guide[] = [
  {
    id: 'linking',
    title: 'Linking your notes',
    blurb: 'Every form a [[link]] can take, what an alias is for, and how links reach across spaces.',
    icon: 'noteLink',
    body: LinkingGuide
  }
]

export function Tutorials(): React.JSX.Element {
  const [openId, setOpenId] = useState<string | null>(null)
  const open = GUIDES.find((g) => g.id === openId)

  if (open) {
    const Body = open.body
    return (
      <>
        <button
          type="button"
          onClick={() => setOpenId(null)}
          className="flex w-fit items-center gap-1.5 rounded-lg border-none bg-transparent px-2 py-1 text-[12px] text-ink-500 outline-none transition duration-150 hover:bg-brand-500/10 hover:text-brand-600 focus-visible:ring-2 focus-visible:ring-brand-300"
        >
          <span aria-hidden="true" className="inline-flex rotate-180">
            <Icon name="chevron" className="h-3.5 w-3.5" />
          </span>
          All tutorials
        </button>
        <Body />
      </>
    )
  }

  return (
    <>
      <h3 className="font-display text-[15px] font-semibold text-ink-900">Tutorials</h3>
      <p className="mt-0.5 text-[12px] leading-relaxed text-ink-500">
        How the parts of the app that aren&rsquo;t obvious from looking at them actually work.
      </p>

      <div className="mt-3 flex flex-col gap-2">
        {GUIDES.map((g) => (
          <button
            key={g.id}
            type="button"
            onClick={() => setOpenId(g.id)}
            className="btn-edge flex items-start gap-3 rounded-xl border-none px-3 py-3 text-left outline-none ring-1 ring-ink-300/20 transition duration-200 hover:bg-brand-500/8 focus-visible:ring-2 focus-visible:ring-brand-300"
          >
            <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand-500/12 text-brand-600">
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

      {/* Deliberately says what ISN'T here. An empty-looking page reads as a
          broken one; a page that names what is coming reads as an early one. */}
      <div className="mt-4 rounded-xl px-3 py-3 ring-1 ring-dashed ring-ink-300/25">
        <p className="text-[12px] font-medium text-ink-600">More on the way</p>
        <p className="mt-0.5 text-[11.5px] leading-relaxed text-ink-400">
          Guides for spaces, the format bar and organising, plus one guide to the whole app you can
          download and keep.
        </p>
      </div>
    </>
  )
}
