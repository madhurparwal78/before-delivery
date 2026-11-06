import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/newsreader/latin-400.css';
import '@fontsource/newsreader/latin-600.css';
import '@fontsource/atkinson-hyperlegible/latin-400.css';
import '@fontsource/atkinson-hyperlegible/latin-700.css';
import './styles.css';
import { App } from './App.tsx';
import { boot } from './store/store.ts';
import { startSync } from './store/sync.ts';

const shared = window.location.pathname.startsWith('/s/');

async function readyForOffline(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  const mark = () => {
    if (navigator.serviceWorker.controller) document.documentElement.dataset.offlineReady = 'true';
  };
  try {
    await navigator.serviceWorker.register('/sw.js');
    mark();
    navigator.serviceWorker.addEventListener('controllerchange', mark);
  } catch {
    return;
  }
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

void boot({ seed: !shared }).then(() => {
  if (!shared) void startSync();
});
void readyForOffline();
