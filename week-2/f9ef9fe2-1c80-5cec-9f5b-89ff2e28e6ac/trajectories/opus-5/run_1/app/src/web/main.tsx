import { createRoot } from 'react-dom/client';
import '@fontsource/instrument-serif/400.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import './styles.css';
import { App } from './app';

const root = document.getElementById('root');
if (root) createRoot(root).render(<App />);
