import { createRoot } from 'react-dom/client';
import { App } from './App';
import { AppProvider } from './state/store';
import './styles.css';

const container = document.getElementById('app');
if (container) {
  createRoot(container).render(
    <AppProvider>
      <App />
    </AppProvider>,
  );
}
