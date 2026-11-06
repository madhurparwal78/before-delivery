import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { SessionProvider } from './lib/session';
import './fonts.css';
import './styles.css';

const container = document.getElementById('app-shell');
if (container === null) throw new Error('The app shell is missing');

createRoot(container).render(
  <StrictMode>
    <SessionProvider>
      <App />
    </SessionProvider>
  </StrictMode>,
);
