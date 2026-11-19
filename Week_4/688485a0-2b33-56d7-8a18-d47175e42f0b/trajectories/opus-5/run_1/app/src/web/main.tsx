import { createRoot } from 'react-dom/client';
import '@fontsource/tiktok-sans/latin-400.css';
import '@fontsource/tiktok-sans/latin-500.css';
import '@fontsource/tiktok-sans/latin-700.css';
import '@fontsource/tiktok-sans/latin-900.css';
import '@fontsource/martian-mono/latin-400.css';
import '@fontsource/martian-mono/latin-700.css';
import './styles.css';
import { App } from './app';

const root = document.getElementById('root');
if (root) createRoot(root).render(<App />);
