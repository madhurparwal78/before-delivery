import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/fraunces/latin-600.css';
import '@fontsource/ibm-plex-sans/latin-400.css';
import '@fontsource/ibm-plex-sans/latin-600.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import './styles.css';
import { App } from './App.tsx';
import { store } from './lib/store.ts';

void store.start();

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
