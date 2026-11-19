import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/fraunces/latin-400.css';
import '@fontsource/fraunces/latin-700.css';
import '@fontsource/public-sans/latin-400.css';
import '@fontsource/public-sans/latin-600.css';
import './styles.css';
import { App } from './App';

const root = document.getElementById('root');
if (root === null) throw new Error('the page has no root element');
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
