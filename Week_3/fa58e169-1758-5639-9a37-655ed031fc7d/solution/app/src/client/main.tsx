import { createRoot } from 'react-dom/client'
import { App } from './App.tsx'
import { SessionProvider } from './session.tsx'
import '@fontsource/manrope/latin-400.css'
import '@fontsource/manrope/latin-600.css'
import '@fontsource/manrope/latin-700.css'
import '@fontsource/open-sans/latin-600.css'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <SessionProvider>
    <App />
  </SessionProvider>,
)
