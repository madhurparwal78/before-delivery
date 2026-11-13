import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/fraunces/index.css';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import './styles.css';
import { App } from './app.js';

const container = document.getElementById('root');
if (!container) throw new Error('the app shell is missing its root element');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
