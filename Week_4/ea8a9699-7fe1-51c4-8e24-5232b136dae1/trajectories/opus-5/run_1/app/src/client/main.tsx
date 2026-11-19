import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { App } from './App.js';
import { RouterProvider } from './lib/router.js';
import { SessionProvider } from './lib/session.js';

const container = document.getElementById('root');
if (container === null) {
  throw new Error('Missing application root');
}

createRoot(container).render(
  <StrictMode>
    <RouterProvider>
      <SessionProvider>
        <App />
      </SessionProvider>
    </RouterProvider>
  </StrictMode>,
);
