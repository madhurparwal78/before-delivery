import { createRoot } from 'react-dom/client';
import '@fontsource/archivo/latin-900.css';
import '@fontsource/ibm-plex-sans/latin-400.css';
import '@fontsource/ibm-plex-sans/latin-600.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import './styles.css';
import { App } from './App.js';

const host = document.getElementById('root');
if (host === null) throw new Error('The page shell is missing its root element');
createRoot(host).render(<App />);
