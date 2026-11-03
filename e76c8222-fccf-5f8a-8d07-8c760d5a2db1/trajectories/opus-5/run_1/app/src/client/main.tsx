import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { RouterProvider } from './router';
import './styles.css';

const host = document.getElementById('root');
if (!host) throw new Error('no root element');

createRoot(host).render(
  <StrictMode>
    <RouterProvider>
      <App />
    </RouterProvider>
  </StrictMode>,
);
