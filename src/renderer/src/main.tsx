import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import 'katex/dist/katex.min.css'
import App from './App'
import './theme.css'
import './app.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
