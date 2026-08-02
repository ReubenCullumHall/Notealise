import { HoverCard, type Anchor } from '../HoverCard'

// What the hover card says about a link — a chip in the links strip, or a
// `[[link]]` in the text. One component for both, so the two can't drift into
// saying different things about the same connection. Where the card GOES is
// HoverCard's business (see the note there about portalling).

/** What is being hovered, and where it is on screen. */
export interface Inspect {
  /** which way the connection runs, or what is wrong with it */
  kind: 'out' | 'back' | 'folder' | 'missing'
  title: string
  /** the note or folder it reaches, or null when nothing answers to it */
  path: string | null
  /** where clicking an unwritten link would create the note */
  suggestedPath: string
  /** the space it lives in, when that isn't the one you're reading */
  space: string
  emoji: string
  cross: boolean
  ambiguous: boolean
  /** the line the link sits in — the "why does that point here?" */
  context: string
  /** viewport rect of the hovered element */
  rect: Anchor
}

const HEADING: Record<Inspect['kind'], string> = {
  out: 'Outgoing',
  back: 'Backlink',
  folder: 'Folder',
  missing: 'Not written yet'
}

export function LinkInspector({ at }: { at: Inspect }): React.JSX.Element {
  const line =
    at.kind === 'missing'
      ? `Click to make ${at.suggestedPath}`
      : at.kind === 'folder'
        ? `Show ${at.path} in the sidebar`
        : at.kind === 'out'
          ? `This note links to ${at.path}`
          : `${at.path} links here`

  return (
    <HoverCard at={at.rect}>
      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-brand-600">
        {HEADING[at.kind]}
        {at.cross && (
          // Named, not just emoji'd: a space needn't have an emoji, and the
          // crossing is worth saying either way.
          <span className="ml-1.5 font-medium normal-case tracking-normal text-ink-400">
            in {at.emoji ? at.emoji + ' ' : ''}
            {at.space}
          </span>
        )}
      </p>
      <p className="mt-0.5 truncate text-[11.5px] text-ink-700">{line}</p>
      {at.context && (
        <p className="mt-1.5 line-clamp-3 border-l-2 border-ink-300/40 pl-2 text-[11px] italic leading-snug text-ink-500">
          {at.context}
        </p>
      )}
      {at.ambiguous && (
        <p className="mt-1.5 text-[11px] leading-snug text-ink-400">
          Several notes have this name — write <span className="font-medium">[[Folder/Note]]</span> to be
          sure which one.
        </p>
      )}
    </HoverCard>
  )
}
