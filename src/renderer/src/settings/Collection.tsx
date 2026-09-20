import { Icon } from '../icons'
import { LookTile } from './LookTile'
import { spacesWearing, spacesWearingFont, withoutFont, withoutPageLook, withoutTint } from './library'
import { findFont, FONTS, fontCssValue } from './fonts'
import type { ExploreTab } from './Explore'
import type { FontLibrary } from './useInstalledFonts'
import { findPageLook, parseTint, PAGE_LOOKS, tintName } from '../../../shared/looks'
import { activeSpace, type AppSettings } from '../../../shared/settings'

// Settings → **Your collection**. What you HAVE, and nothing else.
//
// That is the whole rule of this page, and it changed 2026-08-30. It used to
// be both halves at once — your fonts, then the sixteen you could download,
// then two empty shelves advertising features that didn't exist. So the page
// you went to in order to see what you owned was mostly things you didn't, and
// the one thing it promised ("pick something here, then assign it to a space")
// was buried under a catalogue.
//
// Now: every shelf lists exactly what the pickers on a space will offer you,
// and every shelf ends in the same door — **Explore and install more**
// (Explore.tsx), opening on that shelf's own tab. Three doors, one room. What
// you can acquire is one page deeper, never mixed into what you have.
//
// "Built in" means it needs nothing to be usable: bundled font files, the two
// page looks that ship on, our seven tints. They can't be removed, and they
// are not stored in settings.json for the same reason — see shared/looks.ts.

interface Props {
  settings: AppSettings
  onChange: (partial: Partial<AppSettings>) => void
  onGoToSpaces: () => void
  onExplore: (tab: ExploreTab) => void
  fontLibrary: FontLibrary
}

/** The door at the foot of every shelf. Identical on all three on purpose:
 *  one place to go, whichever shelf sent you. */
function ExploreButton({ label, onClick }: { label: string; onClick: () => void }): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      className="btn-edge mt-3 flex w-full items-center gap-2.5 rounded-xl border border-ink-300/30 bg-ink-300/10 px-3.5 py-2.5 text-left outline-none transition duration-200 hover:border-ink-300/60 focus-visible:ring-2 focus-visible:ring-brand-300"
    >
      <Icon name="plus" className="h-4 w-4 shrink-0 text-brand-500" />
      <span className="min-w-0 flex-1">
        <span className="block text-[12.5px] font-medium text-ink-700">Explore and install more</span>
        <span className="block text-[11.5px] leading-relaxed text-ink-400">{label}</span>
      </span>
      <Icon name="chevron" className="h-4 w-4 shrink-0 text-ink-300" />
    </button>
  )
}

/** Removing a font is two writes, like removing a look or a tint: the file
 *  goes, AND every space still naming it is cleared. Both kinds go through
 *  the same `fontLibrary.remove`, which main routes by id — a downloaded font
 *  and a custom import are the same act to whoever clicked the button. */
function RemoveFont({
  f,
  settings,
  onChange,
  fontLibrary
}: {
  f: { id: string; family: string }
  settings: AppSettings
  onChange: (partial: Partial<AppSettings>) => void
  fontLibrary: FontLibrary
}): React.JSX.Element {
  const inUse = spacesWearingFont(settings, f.id)
  return (
    <button
      className="mini mt-2 !text-red-400"
      data-tip={
        inUse > 0
          ? `Also takes it off ${inUse} ${inUse === 1 ? 'space' : 'spaces'} using it`
          : `Deletes ${f.family} from this computer`
      }
      onClick={() => {
        if (inUse > 0) onChange(withoutFont(settings, f.id))
        void fontLibrary.remove(f.id)
      }}
    >
      Remove
    </button>
  )
}

/** A collection card you can actually act on: the tile is the button (click to
 *  put it on the space you were last in, click again to take it off), with
 *  Remove as a separate control beside it rather than nested inside — a button
 *  inside a button is invalid HTML and, in practice, a Remove click that also
 *  applies the thing you were removing. */
function UseCard({
  on,
  label,
  sub,
  inUse,
  spaceLabel,
  tip,
  tile,
  onUse,
  onRemove
}: {
  on: boolean
  label: string
  sub: string
  inUse: number
  spaceLabel: string
  tip?: string
  tile: React.ReactNode
  onUse: () => void
  onRemove?: () => void
}): React.JSX.Element {
  return (
    <div className="look-card">
      <button
        className="block w-full border-none bg-transparent p-0 text-left outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
        aria-pressed={on}
        data-tip={on ? `Take it off ${spaceLabel}` : `Put it on ${spaceLabel}` + (tip ? ` — ${tip}` : '')}
        onClick={onUse}
      >
        {tile}
        <span className={'mt-2 block text-[12.5px] font-medium ' + (on ? 'text-brand-600' : 'text-ink-700')}>
          {on ? '✓ ' : ''}
          {label}
        </span>
        <span className="mt-0.5 block text-[11px] text-ink-400">
          {on ? `On ${spaceLabel}` : sub}
          {!on && inUse > 0 && ` · on ${inUse} ${inUse === 1 ? 'space' : 'spaces'}`}
        </span>
      </button>
      {onRemove && (
        <button
          className="mini mt-2 !text-red-400"
          data-tip={inUse > 0 ? 'Also takes it off the spaces using it' : 'Takes it out of your collection'}
          onClick={onRemove}
        >
          Remove
        </button>
      )}
    </div>
  )
}

function Shelf({
  title,
  count,
  hint,
  children
}: {
  title: string
  count: number
  hint: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section className="settings-group">
      <h3>
        {title}{' '}
        <span className="ml-0.5 align-middle text-[11px] font-medium text-ink-400">{count}</span>
      </h3>
      <p className="hint">{hint}</p>
      {children}
    </section>
  )
}

export function Collection({
  settings,
  onChange,
  onGoToSpaces,
  onExplore,
  fontLibrary
}: Props): React.JSX.Element {
  const bundledFonts = FONTS.filter((f) => f.source === 'bundled')
  const downloaded = fontLibrary.installed.filter((f) => f.source !== 'custom')
  const custom = fontLibrary.installed.filter((f) => f.source === 'custom')

  const collectedLooks = settings.pageLookLibrary.map(findPageLook).filter((l) => !!l)
  const bundledLooks = PAGE_LOOKS.filter((l) => l.source === 'bundled')

  // WHY THESE CARDS ARE CLICKABLE AT ALL. They were plain divs — a shelf of
  // what you own, with the assigning done one page over on Spaces. Reuben,
  // 2026-08-30, on the built page: "I can't click on them so idk if they
  // work". He is right, and the fault is not that the picker was broken (it
  // wasn't — the Spaces one works) but that this page shows big preview tiles
  // that look exactly like a picker and answer to nothing. An inert control
  // that LOOKS live is the same bug as a live control that does nothing.
  //
  // So a click here puts it on the space you were last in, which is the one
  // you are almost certainly thinking about. Anything more deliberate —
  // another space, or all of them — is still Spaces and Customisation, and
  // the header says so.
  const here = activeSpace(settings)
  const spaceLabel = here.folder || 'this vault'
  const setLook = (id: string): void =>
    onChange({ spaces: settings.spaces.map((sp) => (sp.folder === here.folder ? { ...sp, pageLook: id } : sp)) })
  const setTint = (token: string): void =>
    onChange({ spaces: settings.spaces.map((sp) => (sp.folder === here.folder ? { ...sp, tint: token } : sp)) })

  return (
    <>
      <section className="settings-group">
        <h3>Your collection</h3>
        <p className="hint">
          Everything you have to make a space its own. <strong className="font-medium text-ink-600">
          Click a page look or a tint to put it on {spaceLabel}</strong> — the space you were last in.
          For a different space, or for all of them at once, use Spaces or Customisation.
        </p>
      </section>

      <Shelf
        title="Fonts"
        count={bundledFonts.length + fontLibrary.installed.length}
        hint="Typefaces for the interface, for your notes, and for easier reading. Built-in ones work offline from install; downloaded ones do too, once they're here."
      >
        <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-400">
          Built in
        </p>
        <div className="font-grid">
          {bundledFonts.map((f) => (
            <div key={f.id} className="font-card" data-tip={f.blurb}>
              <span className="preview" style={{ fontFamily: fontCssValue(f) }}>
                {f.family}
              </span>
              <span className="label">{f.family}</span>
            </div>
          ))}
        </div>

        {downloaded.length > 0 && (
          <>
            <p className="mb-1.5 mt-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-400">
              Downloaded
            </p>
            <div className="font-grid">
              {downloaded.map((f) => (
                <div key={f.id} className="font-card" data-tip={findFont(f.id)?.blurb}>
                  <span className="preview" style={{ fontFamily: fontCssValue(f) }}>
                    {f.family}
                  </span>
                  <span className="label">{f.family}</span>
                  <RemoveFont f={f} settings={settings} onChange={onChange} fontLibrary={fontLibrary} />
                </div>
              ))}
            </div>
          </>
        )}

        {custom.length > 0 && (
          <>
            <p className="mb-1.5 mt-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-400">
              Your own
            </p>
            <div className="font-grid">
              {custom.map((f) => (
                <div key={f.id} className="font-card">
                  <span className="preview" style={{ fontFamily: fontCssValue(f) }}>
                    {f.family}
                  </span>
                  <span className="label">{f.family}</span>
                  <RemoveFont f={f} settings={settings} onChange={onChange} fontLibrary={fontLibrary} />
                </div>
              ))}
            </div>
          </>
        )}

        <ExploreButton
          label="Sixteen more faces to download, or bring in a font file of your own."
          onClick={() => onExplore('fonts')}
        />
      </Shelf>

      <Shelf
        title="Page looks"
        count={bundledLooks.length + collectedLooks.length}
        hint="A pattern drawn behind your writing — ruled, squared, dotted — spaced to the editor's own lines. Shown here at the size it's actually drawn."
      >
        <div className="look-grid">
          {[...bundledLooks, ...collectedLooks].map((look) => {
            const bundled = look.source === 'bundled'
            const on = here.pageLook === look.id
            const inUse = spacesWearing(settings, 'pageLook', look.id)
            return (
              <UseCard
                key={look.id}
                on={on}
                label={look.name}
                sub={bundled ? 'Built in' : 'Collected'}
                inUse={inUse}
                spaceLabel={spaceLabel}
                tip={look.blurb}
                tile={<LookTile look={look.id} tint={here.tint} lines={2} on={on} className="h-[76px] w-full" />}
                onUse={() => setLook(on ? '' : look.id)}
                onRemove={bundled ? undefined : () => onChange(withoutPageLook(settings, look.id))}
              />
            )
          })}
        </div>
        <ExploreButton
          label="Five more of ours to add — or ask us to make the one you want."
          onClick={() => onExplore('pageLooks')}
        />
      </Shelf>

      <Shelf
        title="Tints"
        count={settings.tintLibrary.length}
        hint="A colour washed under your words, behind the text rather than over it, so nothing loses contrast. Every one is one you made — none ship with the app."
      >
        {settings.tintLibrary.length === 0 ? (
          <p className="rounded-xl border border-dashed border-ink-300/30 px-4 py-5 text-center text-[11.5px] leading-relaxed text-ink-400">
            You haven&apos;t made one yet. We don&apos;t ship any: which colours and strengths
            actually help is a researched question, and a swatch here would be this app guessing at
            the answer. Make your own below — any hex colour, any strength.
          </p>
        ) : (
          <div className="look-grid">
            {settings.tintLibrary.map((token) => {
              const on = here.tint === token
              const inUse = spacesWearing(settings, 'tint', token)
              return (
                <UseCard
                  key={token}
                  on={on}
                  label={tintName(token)}
                  sub={`${parseTint(token)?.opacity}% wash`}
                  inUse={inUse}
                  spaceLabel={spaceLabel}
                  tile={<LookTile look={here.pageLook} tint={token} lines={2} on={on} className="h-[76px] w-full" />}
                  onUse={() => setTint(on ? '' : token)}
                  onRemove={() => onChange(withoutTint(settings, token))}
                />
              )
            })}
          </div>
        )}
        <ExploreButton
          label="Make your own from any hex colour, at a strength you set."
          onClick={() => onExplore('tints')}
        />
      </Shelf>

      <section className="settings-group">
        <button className="mini" onClick={onGoToSpaces}>
          Go to Spaces → put these on a space
        </button>
      </section>
    </>
  )
}
