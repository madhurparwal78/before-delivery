import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import './styles/base.css';

const host = document.getElementById('root');
if (host) createRoot(host).render(<App />);
