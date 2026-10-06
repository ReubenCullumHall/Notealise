import { Icon, type IconName } from '../../icons'

// The pieces every tutorial is built from, so a new one reads like the last
// (Reuben, 2026-10-04: a fixed layout to generate new tutorials from). The
// template itself — what goes in a tutorial and in what order — is written down
// in docs/tutorials.md; the website's Tutorials pages use the same shapes.
//
//   <Heading first>Linking notes</Heading>
//   <Text>One or two sentences: what it is and how to start.</Text>
//   <Heading>The six forms</Heading>
//   <Cards>
//     <Card title="By name" type="[[Waves]]" shows={<Chip>Waves</Chip>}>
//       How to make it, in a line or two.
//     </Card>
//   </Cards>
//
// A card that isn't a link draws what you see with `Sample` (FormatGuide.tsx),
// and `Code` marks a key or some typing inside a paragraph.

/** A tutorial's title, or one of its section headings. */
export function Heading({ first = false, children }: { first?: boolean; children: React.ReactNode }): React.JSX.Element {
  return (
    <h3 className={(first ? '' : 'mt-7 ') + 'accent-heading font-display text-[15px] font-semibold'}>{children}</h3>
  )
}

/** A short paragraph under a heading. */
export function Text({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <p className="mt-0.5 text-[12px] leading-relaxed text-ink-500">{children}</p>
}

/** A stack of cards. */
export function Cards({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <div className="mt-3 flex flex-col gap-2">{children}</div>
}

/** One thing to learn: what you type, what you see, and how to make it. */
export function Card({
  title,
  type,
  shows,
  children
}: {
  title: string
  type: string
  shows: React.ReactNode
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="rounded-xl px-3 py-3 ring-1 ring-ink-300/20">
      <p className="text-[13px] font-medium text-ink-800">{title}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <code className="rounded-md bg-wash/[0.07] px-2 py-1 font-mono text-[12px] text-ink-700">{type}</code>
        <span aria-hidden="true" className="text-ink-300">
          →
        </span>
        <span className="text-[12.5px] text-ink-600">{shows}</span>
      </div>
      <p className="mt-2 text-[11.5px] leading-relaxed text-ink-400">{children}</p>
    </div>
  )
}

/** A bit of typing or a key inside a paragraph. Takes the paragraph's colour
 *  unless given one (`Text` paragraphs pass `text-ink-700`; card lines don't). */
export function Code({ children, className = '' }: { children: React.ReactNode; className?: string }): React.JSX.Element {
  return <code className={'font-mono ' + className}>{children}</code>
}

/** What a card shows when it isn't a link: the result drawn small, in the same
 *  tinted box as `Chip`. Draw it from the app's own pieces — a command's glyph
 *  from the registry, a palette token — never an invented look. */
export function Sample({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-[5px] bg-wash/[0.08] px-2 py-1 text-ink-800">
      {children}
    </span>
  )
}

/** How a link looks in the note, so the page shows the real thing. */
export function Chip({ children, icon = 'doc' }: { children: React.ReactNode; icon?: IconName }): React.JSX.Element {
  return (
    <span className="inline-flex items-center gap-1 rounded-[5px] bg-wash/[0.08] px-1.5 py-0.5 text-ink-800">
      <Icon name={icon} className="h-3 w-3 opacity-60" />
      {children}
    </span>
  )
}
