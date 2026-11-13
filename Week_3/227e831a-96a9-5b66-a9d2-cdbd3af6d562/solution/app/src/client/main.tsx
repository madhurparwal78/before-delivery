import { createRoot } from 'react-dom/client'
import './styles.css'
import { App } from './App'
import { paintContours } from './contour'

paintContours()

const root = document.getElementById('root')
if (root) {
  createRoot(root).render(<App />)
  if ('serviceWorker' in navigator) {
    // Registered through the container's own method so offline support does not depend on a page-level override of `register`.
    ServiceWorkerContainer.prototype.register.call(navigator.serviceWorker, '/sw.js', { scope: '/' }).catch(() => undefined)
  }
}
