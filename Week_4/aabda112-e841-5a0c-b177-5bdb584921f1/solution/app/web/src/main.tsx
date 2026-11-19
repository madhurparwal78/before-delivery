import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import '@fontsource/plus-jakarta-sans/latin-700.css';
import '@fontsource/plus-jakarta-sans/latin-800.css';
import '@fontsource/dm-sans/latin-400.css';
import '@fontsource/dm-sans/latin-500.css';
import './styles.css';

/** The four bundled faces. The first paint waits for them, so no text reflows (and nothing shifts) when they swap in. */
const FACES = ['700 1em "Plus Jakarta Sans"', '800 1em "Plus Jakarta Sans"', '400 1em "DM Sans"', '500 1em "DM Sans"'];

void Promise.allSettled(FACES.map((face) => document.fonts.load(face))).then(() =>
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  ),
);
