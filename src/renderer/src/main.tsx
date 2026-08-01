import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import 'katex/dist/katex.min.css'
import App from './App'
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
      <App />
    </StrictMode>
  )
}

void boot()
