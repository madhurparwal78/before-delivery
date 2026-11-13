import { createRoot } from 'react-dom/client'
import './styles/base.css'
import { App } from './app'

createRoot(document.getElementById('root') as HTMLElement).render(<App />)
