import type { IconName } from '../../icons'

// The list of tutorials, as plain data — no React — so Settings search can read
// it too (search.ts makes one result per guide from this list, which is why a new
// tutorial can't be left out of the search). The guide's words themselves are the
// components in this folder; index.tsx pairs each id here with its component.
//
// To add a tutorial: add its id to `GuideId`, a row to `GUIDES` below, and its
// component to `BODIES` in index.tsx (the type checker asks for each in turn).
// The template is docs/tutorials.md.

export type GuideId = 'linking' | 'format' | 'colours' | 'blocks'

/** Which part of the app a guide is about — the heading it sits under in the
 *  Tutorials list, here and on the website (site/tutorials.html). */
export type AreaId = 'writing' | 'linking'

/** In the order they are shown. An area with no guide in it isn't shown. */
export const AREAS: { id: AreaId; label: string }[] = [
  { id: 'writing', label: 'Writing in a note' },
  { id: 'linking', label: 'Links between notes' }
]

export interface GuideInfo {
  id: GuideId
  title: string
  blurb: string
  icon: IconName
  area: AreaId
  /** What someone might type into Settings search when they're not sure where to
   *  look — the things the guide's cards are about, and the everyday words for
   *  them. Never shown. "tutorial guide" are on every one, so typing either lists
   *  them all. */
  words: string
}

export const GUIDES: GuideInfo[] = [
  {
    id: 'format',
    title: 'Format bar and / commands',
    blurb: 'The bar above a note, its keys, and the / list of commands.',
    icon: 'text',
    area: 'writing',
    words:
      'tutorial guide toolbar slash menu command commands bold italic underline strikethrough code heading headings title list lists bullet bulleted numbered checklist todo quote keys keyboard shortcut shortcuts buttons style styling formatting text type'
  },
  {
    id: 'colours',
    title: 'Colours',
    blurb: 'Highlights, text colours, colours of your own, and a colour for every heading.',
    icon: 'edit',
    area: 'writing',
    words:
      'tutorial guide highlight highlighter highlighting marker text colour red yellow green blue hex custom remove clear used recent heading headings bold links stand out'
  },
  {
    id: 'blocks',
    title: 'Maths, tables and toggles',
    blurb: 'Formulas, tables and toggle lists, and how to change each one.',
    icon: 'table',
    area: 'writing',
    words:
      'tutorial guide maths math formula formulas equation equations latex katex symbol table tables row rows column columns cell cells grid spreadsheet toggle toggles collapse collapsible expand fold dropdown accordion hide show text add insert delete remove'
  },
  {
    id: 'linking',
    title: 'Linking your notes',
    blurb: 'Every kind of [[link]], how to make each one, and how links reach across spaces.',
    icon: 'noteLink',
    area: 'linking',
    words:
      'tutorial guide link links linking wiki wikilink backlinks backlink connect connecting connection brackets reference jump heading paragraph block folder path rename'
  }
]
