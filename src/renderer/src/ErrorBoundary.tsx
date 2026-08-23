import { Component, type ErrorInfo, type ReactNode } from 'react'

// The last thing between a renderer exception and a blank white window.
//
// React unmounts the WHOLE tree when a render throws, and with nothing to catch
// it the result is an empty window: no message, no reload, no hint that
// anything is wrong beyond the app having vanished. That happened for real —
// one IPC call returning a shape the renderer didn't expect took the entire
// interface out, and the only clue was in a dev console the user had no reason
// to have open.
//
// A class component because that is still the only way to catch a render error
// in React; there is no hook for it.
//
// Deliberately styled with inline styles off the app's own CSS custom
// properties rather than Tailwind classes: this renders precisely when
// something is already broken, and it must not depend on anything that might be
// part of what broke. The variables come from theme.css on <html>, which is
// applied before React mounts.

interface Props {
  children: ReactNode
}
interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // The component stack is the useful half and React only hands it here.
    console.error('The interface crashed:', error, info.componentStack)
  }

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div
        role="alert"
        style={{
          position: 'fixed',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
          background: 'rgb(var(--paper))',
          color: 'rgb(var(--ink-900))',
          font: '14px/1.6 system-ui, -apple-system, sans-serif'
        }}
      >
        <div style={{ maxWidth: 520 }}>
          <h1 style={{ margin: '0 0 10px', fontSize: 20, fontWeight: 600 }}>
            Something in the interface broke
          </h1>
          {/* The first thing to say, because it is the first thing anyone
              wants to know and it is true: notes are plain files, written
              within about half a second of being typed. */}
          <p style={{ margin: '0 0 14px', color: 'rgb(var(--ink-500))' }}>
            Your notes are safe. They&rsquo;re ordinary files on your disk and everything you typed
            up to a moment before this is already saved.
          </p>
          <pre
            style={{
              margin: '0 0 18px',
              padding: '10px 12px',
              overflowX: 'auto',
              borderRadius: 8,
              background: 'rgb(var(--wash) / 0.06)',
              color: 'rgb(var(--ink-700))',
              font: '12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace',
              whiteSpace: 'pre-wrap'
            }}
          >
            {error.message || String(error)}
          </pre>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              font: 'inherit',
              fontWeight: 600,
              padding: '9px 16px',
              borderRadius: 10,
              border: 'none',
              cursor: 'pointer',
              background: 'rgb(var(--brand-600))',
              color: 'rgb(var(--paper))'
            }}
          >
            Reload the app
          </button>
          <p style={{ margin: '14px 0 0', fontSize: 12.5, color: 'rgb(var(--ink-400))' }}>
            If it keeps happening, quit and reopen the app — and Settings &rarr; Help has a way to
            send this message on.
          </p>
        </div>
      </div>
    )
  }
}
