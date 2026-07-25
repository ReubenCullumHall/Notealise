import { useEffect, useState } from 'react'
import { ACCENT_MODES, ACCENTS, DENSITIES, THEMES, type AppSettings } from './model'
import { Icon } from '../icons'

interface Props {
  settings: AppSettings
  onChange: (partial: Partial<AppSettings>) => void
}

// Fixed swatch colours for the theme preview cards, so each card always shows
// its own theme regardless of the theme currently in effect.
const THEME_PREVIEW: Record<AppSettings['theme'], { side: string; main: string; line: string }> = {
  dark: { side: '#161616', main: '#000000', line: '#8f8f8f' },
  light: { side: '#ffffff', main: '#f7f7f6', line: '#a3a3a3' }
}

/** The gear. It lives in the sidebar's bottom-left strip, beside the bin, the
 *  way legacy pins it (legacy/src/App.jsx:997-1015) — hence the card styling and
 *  hover lift rather than a flat header button. */
export function SettingsButton({ settings, onChange }: Props): React.JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        className="pointer-events-auto flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-ink-300/30 bg-surface/90 text-ink-500 shadow-card outline-none backdrop-blur transition duration-200 spring hover:-translate-y-0.5 hover:bg-surface/90 hover:text-brand-600 focus-visible:ring-4 focus-visible:ring-brand-100"
        title="Settings"
        aria-label="Settings"
        onClick={() => setOpen(true)}
      >
        <Icon name="gear" className="h-4 w-4" />
      </button>
      {open && <SettingsModal settings={settings} onChange={onChange} onClose={() => setOpen(false)} />}
    </>
  )
}

function SettingsModal({
  settings,
  onChange,
  onClose
}: Props & { onClose: () => void }): React.JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  return (
    <div className="settings-backdrop" onMouseDown={onClose}>
      <div
        className="settings-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="settings-head">
          <span className="settings-title">Settings</span>
          <button className="icon" title="Close (Esc)" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="settings-body">
          {/* Theme */}
          <section className="settings-group">
            <h3>Theme</h3>
            <p className="hint">Applies to the whole app, editor included.</p>
            <div className="theme-cards">
              {THEMES.map((t) => {
                const p = THEME_PREVIEW[t.id]
                const on = settings.theme === t.id
                return (
                  <button
                    key={t.id}
                    className={'theme-card' + (on ? ' on' : '')}
                    aria-pressed={on}
                    onClick={() => onChange({ theme: t.id })}
                  >
                    <span className="preview" aria-hidden="true">
                      <span className="side" style={{ background: p.side }} />
                      <span className="main" style={{ background: p.main }} />
                    </span>
                    <span className="label-row">
                      {on ? '✓ ' : ''}
                      {t.label}
                    </span>
                  </button>
                )
              })}
            </div>
          </section>

          {/* Accent */}
          <section className="settings-group">
            <h3>Accent</h3>
            <p className="hint">Pick a colour, then choose how far it reaches. Works with either theme.</p>
            <div className="accent-dots">
              {ACCENTS.map((a) => {
                const on = settings.accent === a.id
                const bg =
                  a.hue == null
                    ? settings.theme === 'light'
                      ? '#1a1a1a'
                      : '#e8e8e8'
                    : `hsl(${a.hue} 50% 55%)`
                return (
                  <button
                    key={a.id}
                    className={'accent-dot' + (on ? ' on' : '')}
                    title={a.label}
                    aria-label={a.label}
                    aria-pressed={on}
                    style={{ background: bg }}
                    onClick={() => onChange({ accent: a.id })}
                  />
                )
              })}
            </div>
            <div className="mode-row">
              {ACCENT_MODES.map((m) => {
                const on = settings.accentMode === m.id
                return (
                  <button
                    key={m.id}
                    className={'mode-btn' + (on ? ' on' : '')}
                    aria-pressed={on}
                    onClick={() => onChange({ accentMode: m.id })}
                  >
                    <span className="t">{m.label}</span>
                    <span className="s">{m.hint}</span>
                  </button>
                )
              })}
            </div>
          </section>

          {/* Density */}
          <section className="settings-group">
            <h3>Density</h3>
            <p className="hint">How tightly notes and folders pack in the sidebar.</p>
            <div className="density-list">
              {DENSITIES.map((d) => {
                const on = settings.density === d.id
                return (
                  <button
                    key={d.id}
                    className={'density-row' + (on ? ' on' : '')}
                    aria-pressed={on}
                    onClick={() => onChange({ density: d.id })}
                  >
                    <span className="density-bars" style={{ gap: d.bar.gap }} aria-hidden="true">
                      {[0, 1, 2].map((i) => (
                        <span key={i} style={{ height: d.bar.h }} />
                      ))}
                    </span>
                    <span className="meta">
                      <span className="t">{d.label}</span>
                      <span className="s">{d.hint}</span>
                    </span>
                    {on ? <span aria-hidden="true">✓</span> : null}
                  </button>
                )
              })}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
