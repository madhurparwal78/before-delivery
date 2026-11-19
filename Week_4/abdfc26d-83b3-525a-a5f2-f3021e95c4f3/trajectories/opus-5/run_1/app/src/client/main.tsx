import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { RouterProvider } from './lib/router.js';
import { SessionProvider } from './lib/session.js';
import './public/fonts/fonts.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';

const container = document.getElementById('root');
if (!container) throw new Error('The app shell has no #root element');

createRoot(container).render(
  <StrictMode>
    <RouterProvider>
      <SessionProvider>
        <App />
      </SessionProvider>
    </RouterProvider>
  </StrictMode>,
);
