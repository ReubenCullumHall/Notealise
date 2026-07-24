import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { loadSettings, applySettings } from './settings.js'

// index.html sets theme/density before first paint; the accent ramps are
// computed, so they're applied here — still ahead of React's first render.
applySettings(loadSettings())

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
