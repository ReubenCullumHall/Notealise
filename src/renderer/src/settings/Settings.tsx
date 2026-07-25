import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ACCENT_MODES, ACCENTS, DENSITIES, THEMES, type AppSettings } from './model'
import { Icon, type IconName } from '../icons'
import { isPrereleaseVersion, type UpdateStatus } from '../../../shared/update'

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

type SectionId = 'appearance' | 'updates'

// Legacy's SECTIONS (legacy/src/settings.js:35), minus the two whose settings
// this app doesn't persist yet — General (startup) and Formatting (date/number
// locale). An empty tab is worse than an absent one; they arrive with the
// settings behind them.
const SECTIONS: { id: SectionId; label: string; icon: IconName }[] = [
  { id: 'appearance', label: 'Appearance', icon: 'sliders' },
  { id: 'updates', label: 'Updates', icon: 'restore' }
]

/** The gear. It lives in the sidebar's bottom-left strip, beside the bin, the
 *  way legacy pins it (legacy/src/App.jsx:997-1015) — hence the card styling and
 *  hover lift rather than a flat header button. */
export function SettingsButton({ settings, onChange }: Props): React.JSX.Element {
  const [mounted, setMounted] = useState(false) // in the DOM, including while closing
  const [armed, setArmed] = useState(false) // laid out, safe to animate
  const [closing, setClosing] = useState(false)
  const btn = useRef<HTMLButtonElement>(null)
  const win = useRef<HTMLDivElement>(null)

  // Closing before the animation is armed (Escape hammered within a frame or two
  // of opening) would wait forever for an animationend that never comes, so that
  // case unmounts outright.
  const armedRef = useRef(false)
  const close = useCallback(() => {
    if (armedRef.current) setClosing(true)
    else {
      setMounted(false)
      setClosing(false)
    }
  }, [])

  // Safety net. Unmounting normally happens on animationend, but this modal
  // covers the whole window, so if that event is ever missed the app is left
  // unclickable. Nothing that severe should hang on a single event arriving.
  useEffect(() => {
    if (!closing) return
    const t = setTimeout(() => {
      setMounted(false)
      setClosing(false)
    }, 600)
    return () => clearTimeout(t)
  }, [closing])

  // Aim the genie at the gear. Measured before paint so the first animation
  // frame already collapses toward the right point.
  useLayoutEffect(() => {
    if (!mounted) {
      armedRef.current = false
      setArmed(false)
      return
    }
    if (!win.current || !btn.current) return
    const g = btn.current.getBoundingClientRect()
    const w = win.current.offsetWidth
    const h = win.current.offsetHeight
    const left = (window.innerWidth - w) / 2
    const top = (window.innerHeight - h) / 2
    win.current.style.transformOrigin = `${g.left + g.width / 2 - left}px ${g.top + g.height / 2 - top}px`

    // Hold the animation back a full frame: mounting costs a layout and paint of
    // the whole settings UI, and a dropped first frame is what a stutter is. Two
    // rAFs, because the first still runs inside the frame being painted.
    let inner = 0
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => {
        armedRef.current = true
        setArmed(true)
      })
    })
    return () => {
      cancelAnimationFrame(outer)
      cancelAnimationFrame(inner)
    }
  }, [mounted])

  useEffect(() => {
    if (!mounted) return
    // capture, so Escape closes this before the sidebar clears its selection
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        close()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [mounted, close])

  const open = mounted && !closing

  return (
    <>
      <button
        ref={btn}
        className={
          'pointer-events-auto flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-ink-300/30 shadow-card outline-none backdrop-blur transition duration-200 spring hover:-translate-y-0.5 hover:text-brand-600 focus-visible:ring-4 focus-visible:ring-brand-100 ' +
          (open ? 'bg-brand-500/15 text-brand-600' : 'bg-surface/90 text-ink-500')
        }
        title="Settings"
        aria-label="Settings"
        aria-expanded={open}
        onClick={() => (open ? close() : (setClosing(false), setMounted(true)))}
      >
        <span
          className={'inline-flex transition-transform duration-500 ' + (open ? 'rotate-180 scale-90' : '')}
        >
          <Icon name="gear" className="h-4 w-4" />
        </span>
      </button>

      {/* PORTAL, and not optional. The sidebar <aside> carries `backdrop-blur`,
          and backdrop-filter makes an element a containing block for fixed-
          position descendants — so rendering in place pinned this to the 288px
          sidebar instead of the viewport. The strip is also pointer-events-none,
          which the modal would inherit. document.body escapes both. */}
      {mounted &&
        createPortal(
          <div className="fixed inset-0 z-[60] flex items-center justify-center">
            <div
              onClick={close}
              aria-hidden="true"
              className={'genie-backdrop absolute inset-0 bg-paper/50 backdrop-blur-[5px] ' + (closing ? 'closing' : '')}
            />
            <SettingsWindow
              winRef={win}
              settings={settings}
              onChange={onChange}
              onClose={close}
              armed={armed}
              closing={closing}
              onAnimationEnd={(e) => {
                if (closing && e.target === win.current) {
                  setMounted(false)
                  setClosing(false)
                }
              }}
            />
          </div>,
          document.body
        )}
    </>
  )
}

function SettingsWindow({
  winRef,
  settings,
  onChange,
  onClose,
  armed,
  closing,
  onAnimationEnd
}: Props & {
  winRef: React.RefObject<HTMLDivElement | null>
  onClose: () => void
  armed: boolean
  closing: boolean
  onAnimationEnd: (e: React.AnimationEvent) => void
}): React.JSX.Element {
  const [section, setSection] = useState<SectionId>('appearance')

  return (
    <div
      ref={winRef}
      role="dialog"
      aria-modal="true"
      aria-label="Settings"
      onAnimationEnd={onAnimationEnd}
      className={
        'genie relative flex h-[min(600px,88vh)] w-[min(720px,92vw)] flex-col overflow-hidden border border-ink-300/25 bg-surface shadow-float ' +
        (armed ? 'run ' : '') +
        (closing ? 'closing' : '')
      }
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-ink-300/20 px-4 py-3">
        <span className="text-brand-500">
          <Icon name="gear" className="h-4 w-4" />
        </span>
        <p className="flex-1 font-display text-[15px] font-semibold text-ink-900">Settings</p>
        <button
          onClick={onClose}
          title="Close (Esc)"
          aria-label="Close"
          className="rounded-lg border-none bg-transparent p-1.5 text-ink-400 outline-none transition duration-200 hover:bg-brand-500/10 hover:text-brand-600 focus-visible:ring-2 focus-visible:ring-brand-300"
        >
          <Icon name="x" className="h-4 w-4" />
        </button>
      </div>

      <div className="flex min-h-0 flex-1">
        <nav className="w-44 shrink-0 border-r border-ink-300/20 p-2">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              onClick={() => setSection(s.id)}
              aria-current={section === s.id}
              className={
                'flex w-full items-center gap-2 rounded-xl border-none px-2.5 py-2 text-left text-[13px] font-medium outline-none transition duration-200 focus-visible:ring-2 focus-visible:ring-brand-300 ' +
                (section === s.id
                  ? 'bg-brand-500/12 text-brand-600'
                  : 'bg-transparent text-ink-500 hover:bg-brand-500/8 hover:text-brand-600')
              }
            >
              <Icon name={s.icon} className="h-4 w-4" />
              <span>{s.label}</span>
            </button>
          ))}
        </nav>

        {/* The scroll container. `min-h-0` on the row above is what lets it
            actually scroll instead of stretching the window past its height. */}
        <div className="flex min-w-0 flex-1 flex-col gap-6 overflow-y-auto px-6 py-5">
          {section === 'appearance' && <Appearance settings={settings} onChange={onChange} />}
          {section === 'updates' && <UpdatesSection />}
        </div>
      </div>
    </div>
  )
}

function Appearance({ settings, onChange }: Props): React.JSX.Element {
  return (
    <>
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
    </>
  )
}

/** Which version you're on, whether to update in the background, a manual check,
 *  and the live status. Self-contained — it talks to main directly rather than
 *  threading update state through the settings props, because it is the only
 *  place that needs the version and the preference. */
function UpdatesSection(): React.JSX.Element {
  const [version, setVersion] = useState('')
  const [status, setStatus] = useState<UpdateStatus>({ state: 'idle' })
  const [autoUpdate, setAuto] = useState(true)
  const [beta, setBeta] = useState(false)

  useEffect(() => {
    void (async () => {
      const s = await window.api.getUpdateState()
      setVersion(s.version)
      setStatus(s.status)
      setAuto(s.prefs.autoUpdate)
      setBeta(s.prefs.betaChannel)
    })()
    return window.api.onUpdateStatus(setStatus)
  }, [])

  const blocked = status.state === 'unsupported'
  const busy = status.state === 'checking' || status.state === 'downloading'
  const isBeta = isPrereleaseVersion(version)

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
        {version
          ? `You're running version ${version}${isBeta ? ' — a test build.' : '.'}`
          : 'Checking your version…'}
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

      {/* Only a build that is ALREADY a test build offers this, so an ordinary
          download has no route onto the beta channel. It's kept here (rather
          than removed) so a tester can turn it off and come back to stable.
          Main enforces the same rule — this is presentation, not the gate. */}
      {isBeta && (
        <div className="mode-row">
          <button
            className={'mode-btn' + (beta && !blocked ? ' on' : '')}
            aria-pressed={beta && !blocked}
            disabled={blocked}
            onClick={() => {
              const next = !beta
              setBeta(next)
              void window.api.setBetaChannel(next)
            }}
          >
            <span className="t">Receive test builds</span>
            <span className="s">
              {blocked
                ? 'Not available on this build'
                : 'Early versions, for helping test. They can be rough — turn this off to go back to the stable release.'}
            </span>
          </button>
        </div>
      )}

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
