import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import './styles.css';

const mount = document.getElementById('drawer');
if (mount !== null) {
  createRoot(mount).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
