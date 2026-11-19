import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from './lib/router.js';
import { App } from './App.js';
import './styles.css';
import './room.css';

const container = document.getElementById('root');
if (container === null) throw new Error('The page is missing its root element');

createRoot(container).render(
  <StrictMode>
    <RouterProvider>
      <App />
    </RouterProvider>
  </StrictMode>,
);
