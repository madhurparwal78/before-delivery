import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/tokens.css';
import './styles/app.css';
import { App } from './App.js';
import { RouterProvider } from './router.js';
import { ShopProvider } from './state/shop.js';

const host = document.getElementById('app');
if (host === null) throw new Error('the app shell is missing its root element');

createRoot(host).render(
  <StrictMode>
    <RouterProvider>
      <ShopProvider>
        <App />
      </ShopProvider>
    </RouterProvider>
  </StrictMode>,
);
