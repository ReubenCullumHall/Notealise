import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import 'katex/dist/katex.min.css'
import App from './App'
import { ErrorBoundary } from './ErrorBoundary'
import './theme.css'
import './app.css'

// `electron-vite dev` also serves this renderer at http://localhost:5173, where
// there is no preload bridge and so no `window.api`. A dev-only stub stands in
// for it so the real UI can be opened in a browser tab; a production build has
// `import.meta.env.DEV` false and drops the branch, stub and all.
async function boot(): Promise<void> {
  if (import.meta.env.DEV && !window.api) {
    const { installBrowserApi } = await import('./dev/browserApi')
    installBrowserApi()
  }
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      {/* Outside App, so it survives App itself throwing — which is the case
          that produced a blank window. See ErrorBoundary.tsx. */}
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </StrictMode>
  )
}

void boot()

// A file dropped on a window that isn't expecting one makes the renderer
// NAVIGATE to it — the whole UI replaced by a rendering of the file, with no way
// back but restarting the app, and every unsaved buffer gone with it. That is
// Chromium's default and it has to be turned off explicitly.
//
// It only started to matter when presets became importable by dropping a
// `.mdpreset` on the library: that is the first gesture in this app that asks
// you to drag a file onto the window at all, and a drop that misses its target
// by a few pixels lands here. Handlers that DO want a drop (the preset library)
// call `preventDefault` themselves and are unaffected — these listeners are on
// `window` and run after the React tree has had its turn.
for (const type of ['dragover', 'drop'] as const) {
  window.addEventListener(type, (e) => e.preventDefault())
}
