import { createRoot } from 'react-dom/client';
import '@fontsource/fraunces/600.css';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import './styles.css';
import { App } from './components/shell.js';

const root = document.getElementById('root');
if (root !== null) createRoot(root).render(<App />);
