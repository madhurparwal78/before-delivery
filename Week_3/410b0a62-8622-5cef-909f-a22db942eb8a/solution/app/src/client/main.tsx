import { createRoot } from 'react-dom/client';
import { App } from './app.js';
import './styles.css';

createRoot(document.getElementById('root') as HTMLElement).render(<App />);
