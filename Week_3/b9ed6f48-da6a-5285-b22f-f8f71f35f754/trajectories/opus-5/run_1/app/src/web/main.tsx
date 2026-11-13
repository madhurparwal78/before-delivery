import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { RouterProvider } from './lib/router.js';
import { StoreProvider } from './lib/store.js';
import './styles.css';

const container = document.getElementById('root');
if (!container) throw new Error('The page has no root element');

createRoot(container).render(
  <StrictMode>
    <RouterProvider>
      <StoreProvider>
        <App />
      </StoreProvider>
    </RouterProvider>
  </StrictMode>,
);
