import { Icon, type IconName } from '../icons'

// Settings -> Your collection. The library the "Explore library" buttons on the
// Spaces page will open into: the page looks, fonts and tints you've collected,
// ready to assign to a space.
//
// A SHELL ONLY, on purpose. It invents no storage format — no collection.json,
// no fields beyond the three already on a Space — so it carries zero migration
// debt while the features behind it are built.

const SHELVES: { title: string; icon: IconName; hint: string; empty: string }[] = [
  {
    title: 'Page looks',
    icon: 'doc',
    hint: 'Backgrounds for the writing area — plain, lined, grid, paper.',
    empty: 'Page looks you collect will show up here, ready to put on a space.'
  },
  {
    title: 'Fonts',
    icon: 'text',
    hint: 'Typefaces for the editor, including faces chosen for easier reading.',
    empty: 'The app ships with three; more will be collectable here.'
  },
  {
    title: 'Tints',
    icon: 'sun',
    hint: 'Colour overlays that reduce visual stress and help with dyslexia.',
    empty: 'Tints you collect will show up here, ready to put on a space.'
  }
]

export function Collection(): React.JSX.Element {
  return (
    <>
      <section className="settings-group">
        <h3>Your collection</h3>
        <p className="hint">
          Everything you&apos;ve collected to make a space your own. Pick something here, then assign it
          to a space under Spaces.
        </p>
      </section>

      {SHELVES.map((s) => (
        <section key={s.title} className="settings-group">
          <h3>{s.title}</h3>
          <p className="hint">{s.hint}</p>
          {/* Dashed border + centred icon tile is the app's existing empty-state
              vocabulary (see the no-note-open screen in App.tsx), at a smaller
              scale so three of them stack without dominating the pane. */}
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
