import './styles/index.css';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { ApiError, track } from './api/client.ts';
import { App } from './app.tsx';
import { loadMe } from './shell/session.tsx';

const root = createRoot(document.getElementById('root') as HTMLElement);

// The first screen renders inside the pending counter, so `body[data-pending]` reads 0 only once it has settled.
void track(async () => {
  const me = await loadMe().catch((caught: unknown) => {
    if (caught instanceof ApiError) return null;
    throw caught;
  });
  flushSync(() => root.render(<App initial={me} />));
});
