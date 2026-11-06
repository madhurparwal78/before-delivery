import { createRoot } from 'react-dom/client';
import './styles.css';
import { App } from './app';
import { keepFocusInView } from './focus';
import { startHistory } from './router';

startHistory();
keepFocusInView();
const start = () => createRoot(document.getElementById('app') as HTMLElement).render(<App />);

// Arabic text set in a fallback face wraps differently and moves the whole page when its own face arrives.
if (document.documentElement.lang === 'ar') {
  void Promise.allSettled(['400', '700'].map((weight) => document.fonts.load(`${weight} 1em "Noto Naskh Arabic"`, 'ع'))).then(start);
} else {
  start();
}
