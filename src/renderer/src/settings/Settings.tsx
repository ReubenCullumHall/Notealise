import { useEffect, useState } from 'react'
import { ACCENT_MODES, ACCENTS, DENSITIES, THEMES, type AppSettings } from './model'
import { Icon } from '../icons'
import type { UpdateStatus } from '../../../shared/update'

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

          {/* Updates */}
          <UpdatesSection />
        </div>
      </div>
    </div>
  )
}

/** The Updates section: which version you're on, whether to update in the
 *  background, a manual check, and the live status. Self-contained — it talks to
 *  main directly rather than threading update state through the settings props,
 *  because it is the only place that needs the version and the preference. */
function UpdatesSection(): React.JSX.Element {
  const [version, setVersion] = useState('')
  const [status, setStatus] = useState<UpdateStatus>({ state: 'idle' })
  const [autoUpdate, setAuto] = useState(true)

  useEffect(() => {
    void (async () => {
      const s = await window.api.getUpdateState()
      setVersion(s.version)
      setStatus(s.status)
      setAuto(s.prefs.autoUpdate)
    })()
    return window.api.onUpdateStatus(setStatus)
  }, [])

  const blocked = status.state === 'unsupported'
  const busy = status.state === 'checking' || status.state === 'downloading'

  const line = ((): string => {
    switch (status.state) {
      case 'checking':
        return 'Checking…'
      case 'none':
        return "You're on the latest version."
      case 'available':
        return `Version ${status.version} is available.`
      case 'downloading':
        return `Downloading ${status.version}… ${status.percent ?? 0}%`
      case 'ready':
        return `Version ${status.version} is ready — restart to apply.`
      case 'error':
        return `Couldn't check: ${status.message ?? 'unknown error'}`
      case 'unsupported':
        return status.message ?? 'Updates are unavailable on this build.'
      default:
        return ''
    }
  })()

  return (
    <section className="settings-group">
      <h3>Updates</h3>
      <p className="hint">
        {version ? `You're running version ${version}.` : 'Checking your version…'}
      </p>

      <div className="mode-row">
        <button
          className={'mode-btn' + (autoUpdate && !blocked ? ' on' : '')}
          aria-pressed={autoUpdate && !blocked}
          disabled={blocked}
          onClick={() => {
            const next = !autoUpdate
            setAuto(next)
            void window.api.setAutoUpdate(next)
          }}
        >
          <span className="t">Update automatically</span>
          <span className="s">
            {blocked
              ? 'Not available on this build'
              : 'Downloads new versions quietly and applies them when you quit.'}
          </span>
        </button>
      </div>

      <div className="mode-row">
        <button
          className="mini"
          disabled={busy}
          onClick={() => {
            if (blocked) window.api.openReleases()
            else void window.api.checkForUpdate()
          }}
        >
          {blocked ? 'Open downloads page' : busy ? 'Checking…' : 'Check now'}
        </button>
        {status.state === 'ready' && (
          <button className="mini" onClick={() => window.api.installUpdate()}>
            Restart &amp; install
          </button>
        )}
        {status.state === 'available' && !blocked && (
          <button className="mini" onClick={() => void window.api.downloadUpdate()}>
            Download
          </button>
        )}
      </div>

      {line && <p className="hint">{line}</p>}
    </section>
  )
}
