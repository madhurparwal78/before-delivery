import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ShellProvider } from './shell';
import './build/styles/tokens.css';
import './build/styles/base.css';

// The first paint waits for the three faces (loaded or failed), so text never reflows when a fallback font swaps out.
const FACES = ['600 16px "Bricolage Grotesque"', '400 16px "Schibsted Grotesk"', '400 16px "JetBrains Mono"'];

void Promise.allSettled(FACES.map((face) => document.fonts.load(face))).then(() => {
  createRoot(document.getElementById('root') as HTMLElement).render(
    <StrictMode>
      <ShellProvider>
        <App />
      </ShellProvider>
    </StrictMode>,
  );
});
