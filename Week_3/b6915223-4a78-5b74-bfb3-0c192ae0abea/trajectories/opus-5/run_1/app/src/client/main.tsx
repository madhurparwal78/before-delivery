import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { App } from './app.tsx';
import { LiveProvider } from './live.tsx';
import { AppStateProvider } from './state.tsx';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LiveProvider>
      <AppStateProvider>
        <App />
      </AppStateProvider>
    </LiveProvider>
  </StrictMode>,
);
