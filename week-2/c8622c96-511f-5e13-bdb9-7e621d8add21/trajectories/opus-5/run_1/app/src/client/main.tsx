import { createRoot } from 'react-dom/client';
import '@fontsource/newsreader/400.css';
import '@fontsource/newsreader/600.css';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import './styles.css';
import { App } from './app.js';

const host = document.getElementById('desk');
if (host) createRoot(host).render(<App />);
