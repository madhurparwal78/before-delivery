import { createRoot } from 'react-dom/client'
import { bootstrap } from './actions'
import { App } from './App'
import './styles.css'
import './hud.css'
import { installEscape } from './ui/overlay'
import { startUrlSync } from './url'

// Fetched from the start: left to the first numeral on screen it arrives late, and only signed-in screens use it, so a preload would warn.
void document.fonts.load('500 1em Fredoka').catch(() => undefined)
installEscape()
startUrlSync()
void bootstrap()
createRoot(document.getElementById('root') as HTMLElement).render(<App />)
