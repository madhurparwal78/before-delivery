import { createRoot } from 'react-dom/client';
import { Router } from './router.tsx';
import { Announcer, Toasts } from './ui/index.ts';
import './styles/index.css';

const root = document.getElementById('root');
if (!root) throw new Error('index.html has no #root element');

createRoot(root).render(
  <>
    <Router />
    <Toasts />
    <Announcer />
  </>,
);
