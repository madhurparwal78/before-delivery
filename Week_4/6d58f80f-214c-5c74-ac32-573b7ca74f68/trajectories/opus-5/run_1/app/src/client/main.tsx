import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/app.css';
import { App } from './App.js';

const host = document.getElementById('root');
if (host === null) throw new Error('the app shell is missing its root element');

createRoot(host).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
