import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { STARTUPS, type AppSettings } from './model'
import { Icon, type IconName } from '../icons'
import { Select, SettingRow } from './primitives'
import { Spaces, type SpaceActions } from './Spaces'
import { Collection } from './Collection'
import { MasterSettings } from './MasterSettings'
import { Tutorials } from './tutorials'
import { SourceFolder } from './SourceFolder'
import { DATE_FORMATS, NUMBER_FORMATS, formatDate, localZone, timezones } from '../intl'
import { isPrereleaseVersion, type UpdateStatus } from '../../../shared/update'

/** What a plain settings section needs. Kept free of `spaceActions` so General
 *  and Formatting don't have to carry a dependency only Spaces uses. */
interface Props {
  settings: AppSettings
  onChange: (partial: Partial<AppSettings>) => void
}

/** …plus the folder operations the Spaces page needs, which are owned by App,
 *  and the vault itself for the Source folder page. */
type ShellProps = Props & {
  spaceActions: SpaceActions
  vault: string | null
  onPickVault: () => void
}

type SectionId =
  | 'master'
  | 'spaces'
  | 'collection'
  | 'sourceFolder'
  | 'tutorials'
  | 'updates'
  | 'reportBug'

// Legacy's SECTIONS + SECTION_ICON (legacy/src/settings.js:35, legacy/src/App.jsx:1042).
// Appearance / Arranging / Shortcuts are NOT here: they belong to a space now,
// and live inside Spaces. Spaces, Your collection, Updates and Report a bug have
// no legacy counterpart.
// Master settings first, because it is the answer to "where do I change X" for
// everything except which folder you're in. Startup, dates and the clock are
// app-general; appearance, arranging, a note's chrome and the format-bar
// buttons belong to a space and this page sets them for ALL of them. One space
// at a time is Spaces → that space → its own settings, which is the same form.
const SECTIONS: { id: SectionId; label: string; icon: IconName }[] = [
  { id: 'master', label: 'Master settings', icon: 'sliders' },
  { id: 'spaces', label: 'Spaces', icon: 'spaces' },
  { id: 'collection', label: 'Your collection', icon: 'library' },
  { id: 'sourceFolder', label: 'Source folder', icon: 'folder' },
  { id: 'tutorials', label: 'Tutorials', icon: 'book' },
  { id: 'updates', label: 'Updates', icon: 'restore' },
  { id: 'reportBug', label: 'Report a bug', icon: 'flag' }
]

/** The gear. It lives in the sidebar's bottom-left strip, beside the bin, the
 *  way legacy pins it (legacy/src/App.jsx:997-1015) — hence the card styling and
 *  hover lift rather than a flat header button. */
export function SettingsButton({
  settings,
  onChange,
  spaceActions,
  vault,
  onPickVault
}: ShellProps): React.JSX.Element {
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
          'btn-edge pointer-events-auto flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-ink-300/30 shadow-card outline-none backdrop-blur transition duration-200 spring hover:-translate-y-0.5 hover:text-brand-600 focus-visible:ring-4 focus-visible:ring-brand-100 ' +
          (open ? 'bg-brand-500/15 text-brand-600' : 'bg-surface/90 text-ink-500')
        }
        data-tip="Settings"
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
              spaceActions={spaceActions}
              vault={vault}
              onPickVault={onPickVault}
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
  spaceActions,
  vault,
  onPickVault,
  onClose,
  armed,
  closing,
  onAnimationEnd
}: ShellProps & {
  winRef: React.RefObject<HTMLDivElement | null>
  onClose: () => void
  armed: boolean
  closing: boolean
  onAnimationEnd: (e: React.AnimationEvent) => void
}): React.JSX.Element {
  const [section, setSection] = useState<SectionId>(SECTIONS[0].id)

  return (
    <div
      ref={winRef}
      role="dialog"
      aria-modal="true"
      aria-label="Settings"
      onAnimationEnd={onAnimationEnd}
      className={
        // Sized off the WINDOW, with the caps only there to stop it sprawling on
        // a very large display. 720×600 was a fixed box that looked stranded in
        // the middle of a normal desktop window, and the settings pages have
        // grown enough to want the room.
        'genie relative flex h-[min(820px,84vh)] w-[min(1040px,80vw)] flex-col overflow-hidden border border-ink-300/25 bg-surface shadow-float ' +
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
          data-tip="Close (Esc)"
          aria-label="Close"
          className="rounded-lg border-none bg-transparent p-1.5 text-ink-400 outline-none transition duration-200 hover:bg-brand-500/10 hover:text-brand-600 focus-visible:ring-2 focus-visible:ring-brand-300"
        >
          <Icon name="x" className="h-4 w-4" />
        </button>
      </div>

      <div className="flex min-h-0 flex-1">
        <nav className="w-52 shrink-0 border-r border-ink-300/20 p-2">
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
          {section === 'master' && (
            <MasterSettings
              settings={settings}
              onChange={onChange}
              general={<General settings={settings} onChange={onChange} />}
              formatting={<Formatting settings={settings} onChange={onChange} />}
            />
          )}
          {section === 'sourceFolder' && <SourceFolder vault={vault} onPickVault={onPickVault} />}
          {section === 'tutorials' && <Tutorials />}
          {section === 'spaces' && (
            <Spaces settings={settings} onChange={onChange} actions={spaceActions} />
          )}
          {section === 'collection' && <Collection />}
          {section === 'updates' && <UpdatesSection />}
          {section === 'reportBug' && <ReportBug />}
        </div>
      </div>
    </div>
  )
}

function General({ settings, onChange }: Props): React.JSX.Element {
  return (
    <>
      <h3 className="font-display text-[15px] font-semibold text-ink-900">Startup</h3>
      <p className="mt-0.5 text-[12px] text-ink-500">What you see when the app opens.</p>
      <div className="mt-3 flex flex-col gap-1">
        {STARTUPS.map((s) => {
          const active = settings.startup === s.id
          return (
            <button
              key={s.id}
              onClick={() => onChange({ startup: s.id })}
              aria-pressed={active}
              className={
                'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left outline-none transition duration-200 focus-visible:ring-2 focus-visible:ring-brand-300 ' +
                (active ? 'bg-brand-500/12 ring-1 ring-brand-300/60' : 'ring-1 ring-transparent hover:bg-brand-500/8')
              }
            >
              <span className="min-w-0 flex-1">
                <span className={'block text-[13px] font-medium ' + (active ? 'text-brand-600' : 'text-ink-700')}>
                  {s.label}
                </span>
                <span className="block text-[11.5px] text-ink-400">{s.hint}</span>
              </span>
              <span className={'shrink-0 text-brand-600 transition-opacity ' + (active ? 'opacity-100' : 'opacity-0')}>
                <Icon name="check" className="h-4 w-4" />
              </span>
            </button>
          )
        })}
      </div>

    </>
  )
}

function Formatting({ settings, onChange }: Props): React.JSX.Element {
  const tz = settings.timezone
  const now = Date.now()
  const dateOpts = useMemo(
    () => DATE_FORMATS.map((f) => ({ ...f, example: formatDate(now, f.id, tz) })),
    [tz, now]
  )
  const zoneOpts = useMemo(
    () =>
      timezones().map((z) =>
        z === 'system'
          ? { id: 'system', label: 'System default', example: localZone() }
          : { id: z, label: z.replace(/_/g, ' ') }
      ),
    []
  )

  return (
    <>
      <SettingRow title="Date format" desc="Used for edit times and for the archive and bin.">
        <Select
          value={settings.dateFormat}
          options={dateOpts}
          onChange={(v) => onChange({ dateFormat: v as AppSettings['dateFormat'] })}
        />
      </SettingRow>
      <div className="border-t border-ink-300/15" />

      <SettingRow title="Time zone" desc="Which clock times are shown in. Hover a note's edit time to see it.">
        <Select value={tz} options={zoneOpts} filter onChange={(v) => onChange({ timezone: v })} />
      </SettingRow>
      <div className="border-t border-ink-300/15" />

      <SettingRow title="Number format" desc="Choose how numbers are formatted. Default uses your language setting.">
        <Select
          value={settings.numberFormat}
          options={NUMBER_FORMATS}
          onChange={(v) => onChange({ numberFormat: v as AppSettings['numberFormat'] })}
        />
      </SettingRow>

      <p className="mt-4 px-1 text-[11.5px] leading-relaxed text-ink-400">
        A note's header shows when it was last edited — {formatDate(now, settings.dateFormat, tz)} right now. Hover
        it for the exact time, and when the note was created.
      </p>
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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Sends via the OS default mail app (mailto:) opened by main — no account or
 *  API key needed here. The fixed destination lives in src/main/support.ts. */
function ReportBug(): React.JSX.Element {
  const [fromEmail, setFromEmail] = useState('')
  const [message, setMessage] = useState('')
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')

  const canSend = EMAIL_RE.test(fromEmail.trim()) && message.trim().length > 0

  const send = useCallback(async () => {
    setStatus('sending')
    const ok = await window.api.sendBugReport(fromEmail.trim(), message.trim())
    if (ok) {
      setMessage('')
      setStatus('sent')
    } else {
      setStatus('error')
    }
  }, [fromEmail, message])

  return (
    <>
      <h3 className="font-display text-[15px] font-semibold text-ink-900">Report a bug</h3>
      <p className="mt-0.5 text-[12px] text-ink-500">
        Opens your email app with this pre-filled, addressed to our support inbox.
      </p>

      <div className="mt-4 flex flex-col gap-1">
        <label htmlFor="bug-email" className="text-[12.5px] font-medium text-ink-700">
          Your email
        </label>
        <input
          id="bug-email"
          type="email"
          value={fromEmail}
          onChange={(e) => setFromEmail(e.target.value)}
          placeholder="you@example.com"
          className="w-full rounded-lg bg-brand-500/8 px-2.5 py-1.5 text-[12px] text-ink-900 outline-none placeholder:text-ink-400"
        />
      </div>

      <div className="mt-3 flex flex-col gap-1">
        <label htmlFor="bug-message" className="text-[12.5px] font-medium text-ink-700">
          Message
        </label>
        <textarea
          id="bug-message"
          rows={6}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="What happened, and what did you expect instead?"
          className="w-full resize-y rounded-lg bg-brand-500/8 px-2.5 py-2 text-[12.5px] text-ink-900 outline-none placeholder:text-ink-400"
        />
      </div>

      <div className="mt-3 flex items-center gap-2">
        <button className="mini" disabled={!canSend || status === 'sending'} onClick={() => void send()}>
          {status === 'sending' ? 'Opening…' : 'Send'}
        </button>
        {status === 'sent' && (
          <span className="text-[11.5px] text-ink-400">
            Your default mail app should now have this ready to send.
          </span>
        )}
        {status === 'error' && (
          <span className="text-[11.5px] text-ink-400">
            Couldn&apos;t open a mail app automatically — email us directly instead.
          </span>
        )}
      </div>
    </>
  )
}
