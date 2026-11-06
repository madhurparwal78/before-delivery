import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app';
import { RouterProvider } from './router';
import { AppProvider } from './state';
import './styles.css';

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <RouterProvider>
        <AppProvider>
          <App />
        </AppProvider>
      </RouterProvider>
    </StrictMode>,
  );
}
