import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { windowTitle } from '../../shared/build-info'
import { App } from './App'
import './styles.css'

// The window title follows the chrome UI's document title.
document.title = windowTitle

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
