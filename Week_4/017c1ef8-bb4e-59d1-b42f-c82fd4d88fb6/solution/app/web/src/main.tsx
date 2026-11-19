import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { ClockProvider } from './clock';
import { SessionProvider } from './session';
import './styles.css';

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <BrowserRouter>
      <SessionProvider>
        <ClockProvider>
          <App />
        </ClockProvider>
      </SessionProvider>
    </BrowserRouter>
  </StrictMode>,
);
