import { createRoot } from 'react-dom/client';
import { App } from './app.js';
import { StoreProvider } from './store.js';
import './styles.css';

const root = createRoot(document.getElementById('app')!);
root.render(
  <StoreProvider>
    <App />
  </StoreProvider>
);
