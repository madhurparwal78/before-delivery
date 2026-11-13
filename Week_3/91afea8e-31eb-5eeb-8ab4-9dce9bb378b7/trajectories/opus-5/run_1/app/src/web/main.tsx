import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app.tsx';
import { RouterProvider } from './router.tsx';
import { CartProvider, SessionProvider } from './state.tsx';
import './styles.css';

const root = document.getElementById('root');
if (root !== null) {
  createRoot(root).render(
    <StrictMode>
      <RouterProvider>
        <SessionProvider>
          <CartProvider>
            <App />
          </CartProvider>
        </SessionProvider>
      </RouterProvider>
    </StrictMode>,
  );
}
