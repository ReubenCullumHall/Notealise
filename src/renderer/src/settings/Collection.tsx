import { Icon, type IconName } from '../icons'
import { CATEGORY_LABELS, DOWNLOADABLE_FONTS, FONTS, fontCssValue, type FontCategory } from './fonts'
import type { FontLibrary } from './useInstalledFonts'

// Settings -> Your collection -> Fonts. The "expandable page" a space's Fonts
// pickers (SpaceFonts.tsx) point at for anything beyond the four built in —
// browse the whole catalogue, preview a face BEFORE downloading it, then
// download it for real, or bring in a font of your own. `fontLibrary` (one
// instance, created in Settings.tsx and shared with the pickers) is what
// makes "downloaded here" and "selectable there" the same action rather than
// two things that need to agree.
//
// Page looks and Tints are still a SHELL ONLY, on purpose — no storage format
// invented ahead of the feature behind them.

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

const SHELVES: { title: string; icon: IconName; hint: string; empty: string }[] = [
  {
    title: 'Page looks',
    icon: 'doc',
    hint: 'Backgrounds for the writing area — plain, lined, grid, paper.',
    empty: 'Page looks you collect will show up here, ready to put on a space.'
  },
  {
    title: 'Tints',
    icon: 'sun',
    hint: 'Colour overlays that reduce visual stress and help with dyslexia.',
    empty: 'Tints you collect will show up here, ready to put on a space.'
  }
]

interface Props {
  onGoToSpaces: () => void
  fontLibrary: FontLibrary
}

function DownloadCard({
  id,
  fontLibrary
}: {
  id: string
  fontLibrary: FontLibrary
}): React.JSX.Element {
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

export function Collection({ onGoToSpaces, fontLibrary }: Props): React.JSX.Element {
  const bundled = FONTS.filter((f) => f.source === 'bundled')
  const custom = fontLibrary.installed.filter((f) => f.source === 'custom')

  return (
    <>
      <section className="settings-group">
        <h3>Your collection</h3>
        <p className="hint">
          Everything you&apos;ve collected to make a space your own. Pick something here, then assign it
          to a space under Spaces.
        </p>
      </section>

      <section className="settings-group">
        <h3>Fonts — built in</h3>
        <p className="hint">Always available, offline, from install — nothing to download.</p>
        <div className="font-grid">
          {bundled.map((f) => (
            <div key={f.id} className="font-card" data-tip={f.blurb}>
              <span className="preview" style={{ fontFamily: fontCssValue(f) }}>
                {f.family}
              </span>
              <span className="label">{f.family}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="settings-group">
        <h3>Fonts — download more</h3>
        <p className="hint">
          Preview shown is a snapshot — download to actually use one in the Fonts pickers on Spaces
          or Customisation. Needs a connection; downloaded fonts work offline afterwards.
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
        <h3>Fonts — your own</h3>
        <p className="hint">
          Plug in a .ttf, .otf, .woff or .woff2 from your own machine — it's copied in and shows up
          in the Fonts pickers alongside everything else.
        </p>
        {custom.length > 0 && (
          <div className="font-grid mb-3">
            {custom.map((f) => (
              <div key={f.id} className="font-card">
                <span className="preview" style={{ fontFamily: fontCssValue(f) }}>
                  {f.family}
                </span>
                <span className="label">{f.family}</span>
                <button className="mini mt-2 !text-red-400" onClick={() => fontLibrary.remove(f.id)}>
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
        <button className="mini" disabled={fontLibrary.importing} onClick={() => fontLibrary.importCustom()}>
          {fontLibrary.importing ? 'Adding…' : 'Add a font…'}
        </button>
      </section>

      <section className="settings-group">
        <button className="mini" onClick={onGoToSpaces}>
          Go to Spaces → Fonts
        </button>
      </section>

      {SHELVES.map((s) => (
        <section key={s.title} className="settings-group">
          <h3>{s.title}</h3>
          <p className="hint">{s.hint}</p>
          {/* Dashed border + centred icon tile is the app's existing empty-state
              vocabulary (see the no-note-open screen in App.tsx), at a smaller
              scale so it doesn't dominate the pane. */}
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-ink-300/30 px-4 py-7 text-center">
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-surface/70 text-brand-300 shadow-card">
              <Icon name={s.icon} className="h-5 w-5" />
            </span>
            <span className="text-[12.5px] font-medium text-ink-700">Nothing here yet</span>
            <span className="max-w-[320px] text-[11.5px] leading-relaxed text-ink-400">{s.empty}</span>
            <button className="mini mt-1" disabled data-tip="Coming soon">
              Browse
            </button>
          </div>
        </section>
      ))}
    </>
  )
}
