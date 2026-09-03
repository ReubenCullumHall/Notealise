import { useState } from 'react'
import { Icon, type IconName } from '../icons'
import { ColorField } from '../color/Picker'
import { useDragTrack } from '../color/dragTrack'
import { LookTile } from './LookTile'
import { RequestForm } from './RequestForm'
import { spacesWearing, withoutPageLook, withoutTint } from './library'
import { CATEGORY_LABELS, DOWNLOADABLE_FONTS, FONTS, fontCssValue, type FontCategory } from './fonts'
import type { FontLibrary } from './useInstalledFonts'
import { rgbChannels } from '../../../shared/color'
import {
  CATALOGUE_PAGE_LOOKS,
  BUNDLED_PAGE_LOOKS,
  parseTint,
  TINT_MAX,
  TINT_MIN,
  tintToken
} from '../../../shared/looks'
import { activeSpace, type AppSettings } from '../../../shared/settings'

// Settings → Your collection → **Explore and install more**. One page for all
// three collectable things, reached from any of the three shelves on
// Collection.tsx and opening on whichever one you came from.
//
// WHY ONE PAGE AND NOT THREE. Collection.tsx is now strictly "what you have":
// the pickers on a space offer exactly what is on that page, and nothing on it
// is an advert for something you don't own yet. Everything that is a *choice
// to acquire* moved here, together, because it is one activity — you come
// looking to change how a space looks, not specifically to browse fonts. The
// three tabs are how you narrow it once you're here, not three separate
// errands.
//
// The three are genuinely different acquisitions, and the page says so rather
// than pretending they're one mechanism:
//
//   Fonts       a real download (or a file off your own disk). Can fail, needs
//               a connection, and is the only one with "import your own" —
//               there is no equivalent for the other two.
//   Page looks  already in the app. "Adding" is curation, and the copy says
//               that outright; the only way to get one that doesn't exist is
//               to ask us for it, so the tab ends in a request form.
//   Tints       not a catalogue at all — a colour and a strength, made here
//               with the wheel. Ours are starting points, not the offer.

export type ExploreTab = 'fonts' | 'pageLooks' | 'tints'

const TABS: { id: ExploreTab; label: string; icon: IconName }[] = [
  { id: 'fonts', label: 'Fonts', icon: 'text' },
  { id: 'pageLooks', label: 'Page looks', icon: 'doc' },
  { id: 'tints', label: 'Tints', icon: 'sun' }
]

const SHELF_ORDER: FontCategory[] = ['default', 'dyslexia', 'code', 'eloquent']
const SHELF_LABEL: Record<FontCategory, string> = { ...CATEGORY_LABELS, dyslexia: 'Dyslexia-friendly' }

// Pre-rendered specimens for every downloadable font, so a face can be seen
// BEFORE it's fetched — the whole point of "preview first" (a live @font-face
// render is impossible for something not on disk yet). Generated once from
// the same files these fonts download from; ~1KB each, ~14KB for all 16.
const PREVIEWS = import.meta.glob('../assets/font-previews/*.png', { eager: true, import: 'default' }) as Record<
  string,
  string
>
function previewUrl(id: string): string | undefined {
  const match = Object.entries(PREVIEWS).find(([path]) => path.endsWith(`/${id}.png`))
  return match?.[1]
}

function DownloadCard({ id, fontLibrary }: { id: string; fontLibrary: FontLibrary }): React.JSX.Element {
  const entry = FONTS.find((f) => f.id === id)!
  const installed = fontLibrary.installed.find((f) => f.id === id)
  const downloading = fontLibrary.downloading.has(id)
  const error = fontLibrary.errors[id]
  const preview = previewUrl(id)

  return (
    <div className="font-card" data-tip={entry.blurb}>
      {installed ? (
        <span className="preview" style={{ fontFamily: fontCssValue(installed) }}>
          {entry.family}
        </span>
      ) : preview ? (
        <img src={preview} alt={`${entry.family} preview`} className="mb-1 block h-7 w-auto" />
      ) : (
        <span className="preview">{entry.family}</span>
      )}
      <span className="label">{entry.family}</span>
      <div className="mt-2">
        {installed ? (
          <span className="mini pointer-events-none inline-flex items-center gap-1 !text-brand-600">
            <Icon name="check" className="h-3 w-3" /> Installed
          </span>
        ) : (
          <button className="mini" disabled={downloading} onClick={() => fontLibrary.download(id)}>
            {downloading ? 'Downloading…' : 'Download'}
          </button>
        )}
        {error && <p className="mt-1 text-[10.5px] text-red-400">{error}</p>}
      </div>
    </div>
  )
}

function Fonts({ fontLibrary }: { fontLibrary: FontLibrary }): React.JSX.Element {
  return (
    <>
      <section className="settings-group">
        <h3>Download more</h3>
        <p className="hint">
          The preview shown is a snapshot — download a face to actually use it in the Fonts pickers
          on Spaces or Customisation. Needs a connection; downloaded fonts work offline afterwards.
        </p>
        {SHELF_ORDER.map((cat) => (
          <div key={cat} className="mt-3 first:mt-0">
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-400">
              {SHELF_LABEL[cat]}
            </p>
            <div className="font-grid">
              {DOWNLOADABLE_FONTS.filter((f) => f.category === cat).map((f) => (
                <DownloadCard key={f.id} id={f.id} fontLibrary={fontLibrary} />
              ))}
            </div>
          </div>
        ))}
      </section>

      <section className="settings-group">
        <h3>Import your own</h3>
        <p className="hint">
          Plug in a .ttf, .otf, .woff or .woff2 from your own machine — it&apos;s copied in and shows
          up in the Fonts pickers alongside everything else. Fonts are the only one of the three
          you can bring from outside: a page look is code and a tint is made right here.
        </p>
        <button
          className="mini"
          disabled={fontLibrary.importing}
          onClick={() => void fontLibrary.importCustom()}
        >
          {fontLibrary.importing ? 'Adding…' : 'Add a font…'}
        </button>
      </section>
    </>
  )
}

interface LookProps {
  settings: AppSettings
  onChange: (partial: Partial<AppSettings>) => void
}

function PageLooks({ settings, onChange }: LookProps): React.JSX.Element {
  const library = settings.pageLookLibrary

  const add = (id: string): void => onChange({ pageLookLibrary: [...library, id] })
  const remove = (id: string): void => onChange(withoutPageLook(settings, id))
  const wearing = (id: string): number => spacesWearing(settings, 'pageLook', id)

  return (
    <>
      <section className="settings-group">
        <h3>Made by us</h3>
        <p className="hint">
          A pattern drawn behind your writing, at the editor&apos;s own line spacing. All of these
          ship inside the app — there is nothing to download, so adding one only puts it in your
          collection, which is what keeps the picker on a space short instead of listing every look
          forever.
        </p>
        <div className="look-grid">
          {[...BUNDLED_PAGE_LOOKS, ...CATALOGUE_PAGE_LOOKS].map((look) => {
            const bundled = look.source === 'bundled'
            const owned = bundled || library.includes(look.id)
            const inUse = wearing(look.id)
            return (
              <div key={look.id} className="look-card">
                <LookTile look={look.id} lines={2} className="h-[76px] w-full" />
                <span className="mt-2 block text-[12.5px] font-medium text-ink-700">{look.name}</span>
                <span className="mt-0.5 block text-[11px] leading-relaxed text-ink-400">{look.blurb}</span>
                <div className="mt-2">
                  {bundled ? (
                    <span className="mini pointer-events-none inline-flex items-center gap-1 !text-brand-600">
                      <Icon name="check" className="h-3 w-3" /> Built in
                    </span>
                  ) : owned ? (
                    <button
                      className="mini !text-red-400"
                      data-tip={
                        inUse
                          ? `Also takes it off ${inUse} ${inUse === 1 ? 'space' : 'spaces'} using it`
                          : 'Takes it out of your collection'
                      }
                      onClick={() => remove(look.id)}
                    >
                      Remove
                    </button>
                  ) : (
                    <button className="mini" onClick={() => add(look.id)}>
                      Add to collection
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </section>

      <section className="settings-group">
        <h3>Ask us for one</h3>
        <RequestForm
          idPrefix="page-look"
          hint="Page looks are drawn in code, so they can only come from us — there's no file to import. Tell us what you'd write on and we'll look at building it."
          messageLabel="What look would you like?"
          placeholder="e.g. music manuscript staves, isometric grid, a warmer paper texture…"
          send={(email, message) => window.api.sendFeatureRequest(email, `Page look request\n\n${message}`)}
        />
      </section>
    </>
  )
}

function Tints({ settings, onChange }: LookProps): React.JSX.Element {
  const library = settings.tintLibrary
  // A warm cream, as somewhere to start rather than a blank white page. Not a
  // recommendation — see shared/looks.ts on why nothing here is named.
  const [hex, setHex] = useState('#f5e9d0')
  const [opacity, setOpacity] = useState(14)

  const token = tintToken(hex, opacity)
  const owned = library.includes(token)

  const strength = useDragTrack((x) =>
    setOpacity(Math.min(TINT_MAX, Math.max(TINT_MIN, Math.round(x * TINT_MAX))))
  )
  const nudge = (e: React.KeyboardEvent): void => {
    const step = e.shiftKey ? 5 : 1
    const d: Record<string, number> = { ArrowLeft: -step, ArrowRight: step, ArrowDown: -step, ArrowUp: step }
    const hit = d[e.key]
    if (hit === undefined) return
    e.preventDefault()
    setOpacity((o) => Math.min(TINT_MAX, Math.max(TINT_MIN, o + hit)))
  }

  const add = (): void => onChange({ tintLibrary: [...library, token] })
  const remove = (t: string): void => onChange(withoutTint(settings, t))

  const seed = (t: string): void => {
    const parsed = parseTint(t)
    if (!parsed) return
    setHex(parsed.hex)
    setOpacity(parsed.opacity)
  }

  return (
    <>
      <section className="settings-group">
        <h3>Make a tint</h3>
        <p className="hint">
          A colour washed under your words — every hex colour, at a strength you set. It sits
          BEHIND the text, not over it, so the ink keeps its contrast and nothing you&apos;ve
          highlighted changes colour. Some people find a warm or coloured page easier to read on
          for long stretches; the evidence that a particular colour helps dyslexia specifically is
          thin, so treat these as comfort, not treatment.
        </p>

        <div className="mt-1 flex flex-wrap items-start gap-4">
          <div className="w-[236px] shrink-0">
            <ColorField value={hex} onChange={setHex} />

            <label className="mt-3 block text-[11.5px] font-medium text-ink-700" htmlFor="tint-strength">
              Strength — {opacity}%
            </label>
            <div
              {...strength}
              id="tint-strength"
              role="slider"
              tabIndex={0}
              aria-label="Tint strength"
              aria-valuemin={TINT_MIN}
              aria-valuemax={TINT_MAX}
              aria-valuenow={opacity}
              aria-valuetext={`${opacity} percent`}
              onKeyDown={nudge}
              className="tint-alpha mt-1.5"
              style={
                {
                  '--tuner-rgb': rgbChannels(hex),
                  '--tuner-max': TINT_MAX / 100
                } as React.CSSProperties
              }
            >
              <span
                className="color-handle"
                style={
                  {
                    left: `${((opacity - TINT_MIN) / (TINT_MAX - TINT_MIN)) * 100}%`,
                    top: '50%',
                    '--handle-rgb': rgbChannels(hex)
                  } as React.CSSProperties
                }
              />
            </div>
            <p className="mt-1.5 text-[11px] leading-relaxed text-ink-400">
              Stops at {TINT_MAX}%. Past that a tint stops being a wash and becomes a background
              colour the theme&apos;s ink was never picked for.
            </p>
          </div>

          <div className="min-w-[200px] flex-1">
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-400">
              On the page
            </p>
            {/* Shown over the page look this space is already wearing, not over
                a blank rectangle: the two stack in the real editor, and a tint
                judged on its own is judged against something you'll never see. */}
            <LookTile
              look={activeSpace(settings).pageLook}
              tint={token}
              lines={4}
              className="h-[150px] w-full"
            />
            <div className="mt-2 flex items-center gap-2">
              <button className="mini" disabled={owned} onClick={add}>
                {owned ? 'Already in your collection' : 'Add to collection'}
              </button>
              <span className="font-mono text-[11px] text-ink-400">{token}</span>
            </div>
          </div>
        </div>
      </section>

      <section className="settings-group">
        <h3>Yours</h3>
        <p className="hint">
          Every tint you&apos;ve made. Removing one also takes it off any space wearing it. We
          don&apos;t ship any of our own — which colours and strengths actually help is a
          researched question, and this app isn&apos;t going to guess at the answer in a swatch.
        </p>
        {library.length === 0 ? (
          <p className="rounded-xl border border-dashed border-ink-300/30 px-4 py-5 text-center text-[11.5px] leading-relaxed text-ink-400">
            Nothing yet. Pick a colour and a strength above, then Add to collection — it&apos;ll
            show up here and in the Tint picker on a space.
          </p>
        ) : (
          <div className="look-grid">
            {library.map((t) => (
              <div key={t} className="look-card">
                <LookTile tint={t} lines={2} className="h-[76px] w-full" />
                <span className="mt-2 block font-mono text-[11.5px] text-ink-700">{parseTint(t)?.hex}</span>
                <span className="mt-0.5 block text-[11px] text-ink-400">{parseTint(t)?.opacity}% wash</span>
                <div className="mt-2 flex items-center gap-1.5">
                  <button className="mini" onClick={() => seed(t)}>
                    Edit
                  </button>
                  <button className="mini !text-red-400" onClick={() => remove(t)}>
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  )
}

interface Props {
  tab: ExploreTab
  onTab: (tab: ExploreTab) => void
  onBack: () => void
  settings: AppSettings
  onChange: (partial: Partial<AppSettings>) => void
  fontLibrary: FontLibrary
}

export function Explore({ tab, onTab, onBack, settings, onChange, fontLibrary }: Props): React.JSX.Element {
  return (
    <>
      <div>
        <button
          onClick={onBack}
          className="mb-3 inline-flex items-center gap-1.5 rounded-lg border-none bg-transparent p-0 text-[12px] font-medium text-ink-400 outline-none transition-colors hover:bg-transparent hover:text-brand-600 focus-visible:ring-2 focus-visible:ring-brand-300"
        >
          <Icon name="chevron" className="h-3.5 w-3.5 rotate-180" />
          Your collection
        </button>
        <h3 className="font-display text-[15px] font-semibold text-ink-900">Explore and install more</h3>
        <p className="mt-0.5 text-[12px] leading-relaxed text-ink-500">
          Everything you don&apos;t have yet, in one place. Whatever you take from here lands in
          Your collection, and from there you put it on a space.
        </p>

        <div className="explore-tabs mt-3">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => onTab(t.id)}
              aria-pressed={tab === t.id}
              className={'explore-tab' + (tab === t.id ? ' on' : '')}
            >
              <Icon name={t.icon} className="h-3.5 w-3.5" />
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'fonts' && <Fonts fontLibrary={fontLibrary} />}
      {tab === 'pageLooks' && <PageLooks settings={settings} onChange={onChange} />}
      {tab === 'tints' && <Tints settings={settings} onChange={onChange} />}
    </>
  )
}
