// The tab strip's skins, in one place because THREE things wear them now: a
// lone tab, a segment of a grouped tab (`TabStrip.tsx`), and the island and its
// chips (`Island.tsx`). They were constants inside TabStrip until the island
// was built; a second copy of the same class strings is exactly the drift rule 8
// warns about, and the island sits in the same row as the tabs, where any drift
// is immediately visible side by side.

// Active/inactive follow the sidebar's space switcher rather than inventing a
// second "selected" idiom: accent border + wash for the one you're on, a plain
// hairline for the rest. `btn-edge` opts the inactive ones into the
// button-definition setting; the active tab keeps its accent border, which is
// how you can see which one you're in (CLAUDE.md, Tailwind-vs-app.css note).
export const TAB_BASE =
  'press-row group relative flex shrink-0 cursor-pointer select-none items-center gap-1 rounded-lg border py-1 pl-3 pr-1 text-[13px] outline-none transition duration-200 focus-visible:ring-2 focus-visible:ring-brand-300 '
export const TAB_ON = 'border-brand-400/60 bg-brand-500/15 text-brand-600 '
export const TAB_OFF =
  'btn-edge border-ink-300/25 bg-transparent text-ink-500 hover:bg-ink-300/15 hover:text-ink-900 '

// A SEGMENT of a grouped tab. The group draws the one border round the lot, so
// a segment has none of its own — what separates two of them is the divider
// below, and what marks the focused one is the accent wash it shares with a
// lone active tab. TAB_SHOWN (a second, quieter "this is on screen" border)
// used to say what the grouping now says outright, and went with this change.
export const SEG_BASE =
  'press-row group/seg relative flex shrink-0 cursor-pointer select-none items-center gap-1 rounded-md py-0.5 pl-2.5 pr-1 text-[13px] outline-none transition duration-200 focus-visible:ring-2 focus-visible:ring-brand-300 '
export const SEG_ON = 'bg-brand-500/15 text-brand-600 '
export const SEG_OFF = 'text-ink-600 hover:bg-ink-300/15 hover:text-ink-900 '
