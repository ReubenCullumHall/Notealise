import { LookTile } from './LookTile'
import {
  BUNDLED_PAGE_LOOKS,
  findPageLook,
  parseTint,
  tintName,
  type PageLook
} from '../../../shared/looks'
import { Icon } from '../icons'
import type { SpaceProps } from './Spaces'

// Settings → **Page**. Rendered inside SpaceForm, so — like Fonts and Colour
// beside it — it appears in both scopes with no second copy: in Spaces → this
// space it sets that space's paper, in Customisation it writes to every space
// at once.
//
// Two independent axes, deliberately not one grid of combinations: a look is a
// pattern and a tint is a colour, they stack, and offering "lined + cream" as
// a single named thing would multiply the catalogue by the palette and still
// not contain the one you wanted.
//
// **Only what's in your collection.** Same rule as SpaceFonts.tsx: you cannot
// pick something you don't have. Everything else lives one page over, in Your
// collection → Explore, which is where these lists grow. That rule is the
// whole reason the collection exists — without it this picker is a catalogue
// with a preview, and a space's settings become the place you go shopping.
//
// **With exactly one exception, and it is not a compromise: whatever this
// space is ALREADY WEARING is always offered, collected or not.** A preset
// carries a whole look (shared/presets.ts) — page look and tint included — so
// pouring one onto a space can set a value nothing added to your collection.
// A hand-edited settings.json can too, and so can a vault synced from a
// machine that collected more than this one. In every such case the paper is
// really painted, so a picker that omitted it would show nothing selected and
// offer no way to take it off: a control that lies about the state it is
// controlling. It is marked "from a preset" and behaves like any other card;
// selecting something else is all it takes to lose it.
//
// Each card previews the OTHER axis as it is currently set — the page-look
// cards wear this space's tint, the tint cards wear its look — because the two
// are only ever seen together, and a look judged on white when your page is
// cream is a look you haven't actually seen.

/** What's collected, from AppSettings, without this component needing the
 *  whole of it. Built ids/tokens only: the bundled ones are added here. */
export interface CollectedLooks {
  pageLooks: string[]
  tints: string[]
}

interface Props extends SpaceProps {
  collection: CollectedLooks
}

function Card({
  on,
  label,
  sub,
  tip,
  look,
  tint,
  onClick
}: {
  on: boolean
  label: string
  sub: string
  tip?: string
  look: string
  tint: string
  onClick: () => void
}): React.JSX.Element {
  return (
    <button className="look-card" aria-pressed={on} data-tip={tip} onClick={onClick}>
      <LookTile look={look} tint={tint} lines={2} on={on} className="h-[76px] w-full" />
      <span className={'mt-2 block text-[12.5px] font-medium ' + (on ? 'text-brand-600' : 'text-ink-700')}>
        {on ? '✓ ' : ''}
        {label}
      </span>
      <span className="mt-0.5 block text-[11px] text-ink-400">{sub}</span>
    </button>
  )
}

export function SpacePage({ space, onChange, collection }: Props): React.JSX.Element {
  const looks: PageLook[] = [
    ...BUNDLED_PAGE_LOOKS,
    ...collection.pageLooks.map(findPageLook).filter((l): l is PageLook => !!l)
  ]
  // The exception in the header. Appended rather than sorted in, so an
  // uncollected value reads as the odd one out that it is.
  const worn = findPageLook(space.pageLook)
  const uncollectedLook = worn && !looks.some((l) => l.id === worn.id) ? worn : null

  const tints = collection.tints
  const uncollectedTint = parseTint(space.tint) && !tints.includes(space.tint) ? space.tint : null

  const look = findPageLook(space.pageLook)
  const tint = parseTint(space.tint)

  return (
    <>
      {/* THE PAGE ITSELF, at full width, before either picker.
          Every control here changes something you cannot see while you are
          looking at it: the writing area is behind the settings window. The
          cards are miniatures of one option each; this is the one that says
          what you have actually GOT. SpaceColour.tsx makes the same move with
          its two sidebar rows, for the same reason, and Reuben hit exactly
          this on the first build — "I can't click on them so idk if they
          work" was half inert cards and half no visible result. */}
      <section className="settings-group">
        <h3>Your page</h3>
        <p className="hint">
          {look ? look.name : 'Plain'}
          {tint ? `, tinted ${tint.hex} at ${tint.opacity}%` : ', no tint'} — drawn here exactly as
          the editor draws it, so you can see a change without closing this window.
        </p>
        <LookTile look={space.pageLook} tint={space.tint} lines={4} className="h-[168px] w-full" />
        {(space.pageLook || space.tint) && (
          <button
            className="mini mt-2 inline-flex items-center gap-1.5"
            onClick={() => onChange({ pageLook: '', tint: '' })}
          >
            <Icon name="x" className="h-3 w-3" />
            Back to a plain page
          </button>
        )}
      </section>

      <section className="settings-group">
        <h3>Page look</h3>
        <p className="hint">
          A pattern behind your writing, ruled to the editor&apos;s own line spacing. It scrolls
          with the words rather than sitting still behind them, and it&apos;s drawn in your
          theme&apos;s ink, so one look works on light and dark alike. More in Your collection →
          Explore.
        </p>
        <div className="look-grid">
          <Card
            on={!space.pageLook}
            label="Plain"
            sub="No pattern"
            tip="The app’s own page — nothing drawn behind your writing."
            look=""
            tint={space.tint}
            onClick={() => onChange({ pageLook: '' })}
          />
          {looks.map((l) => (
            <Card
              key={l.id}
              on={space.pageLook === l.id}
              label={l.name}
              sub={l.source === 'bundled' ? 'Built in' : 'Collected'}
              tip={l.blurb}
              look={l.id}
              tint={space.tint}
              onClick={() => onChange({ pageLook: l.id })}
            />
          ))}
          {uncollectedLook && (
            <Card
              on
              label={uncollectedLook.name}
              sub="From a preset"
              tip="On this space, but not in your collection — add it under Your collection → Explore to keep it."
              look={uncollectedLook.id}
              tint={space.tint}
              onClick={() => onChange({ pageLook: uncollectedLook.id })}
            />
          )}
        </div>
      </section>

      <section className="settings-group">
        <h3>Tint</h3>
        <p className="hint">
          A colour washed under the words — behind the text, never over it, so the ink and anything
          you&apos;ve highlighted keep their contrast. Every one is one you made: none ship with
          the app. Make them in Your collection → Explore.
        </p>
        {tints.length === 0 && !uncollectedTint && (
          <p className="mb-2 rounded-xl border border-dashed border-ink-300/30 px-4 py-4 text-center text-[11.5px] leading-relaxed text-ink-400">
            No tints yet — none ship with the app. Make one in Your collection → Explore → Tints,
            from any hex colour at any strength.
          </p>
        )}
        <div className="look-grid">
          <Card
            on={!parseTint(space.tint)}
            label="None"
            sub="Your theme’s own paper"
            look={space.pageLook}
            tint=""
            onClick={() => onChange({ tint: '' })}
          />
          {tints.map((t) => (
            <Card
              key={t}
              on={space.tint === t}
              label={tintName(t)}
              sub={`${parseTint(t)?.opacity}% wash`}
              look={space.pageLook}
              tint={t}
              onClick={() => onChange({ tint: t })}
            />
          ))}
          {uncollectedTint && (
            <Card
              on
              label={tintName(uncollectedTint)}
              sub={`${parseTint(uncollectedTint)?.opacity}% wash · from a preset`}
              tip="On this space, but not in your collection — remake it under Your collection → Explore to keep it."
              look={space.pageLook}
              tint={uncollectedTint}
              onClick={() => onChange({ tint: uncollectedTint })}
            />
          )}
        </div>
      </section>
    </>
  )
}
