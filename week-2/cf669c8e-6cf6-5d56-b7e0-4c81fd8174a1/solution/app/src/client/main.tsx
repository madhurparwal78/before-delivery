import { createRoot } from 'react-dom/client';
import './styles/tokens.css';
import './scene/scene.css';
import './styles/app.css';
import { App } from './App.js';

/** Every face the first screen can use, each with text that selects both its letters and its mono numerals. */
const FACES = [
  '800 1em "Big Shoulders Display"', '400 1em "IBM Plex Sans"', '600 1em "IBM Plex Sans"',
  '400 1em "IBM Plex Mono"', '500 1em "IBM Plex Mono"',
];
const FONT_WAIT_MS = 1500;

/** A face arriving after first paint would re-wrap the header and move the page, so the first paint waits for them. */
const fonts = Promise.all(FACES.map((face) => document.fonts.load(face, 'Aa0€')));
const patience = new Promise((resolve) => { setTimeout(resolve, FONT_WAIT_MS); });
void Promise.race([fonts, patience]).finally(() => {
  createRoot(document.getElementById('root')!).render(<App />);
});
