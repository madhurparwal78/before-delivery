import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/inter/latin-700.css';
import '@fontsource/jetbrains-mono/latin-400.css';
import '@fontsource/jetbrains-mono/latin-500.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/dialog.css';
import { useEffect, useState, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import { usePath } from './nav';
import NotFound from './pages/NotFound';
import PackPage from './pages/PackPage';
import SignInPage from './pages/SignInPage';

const loadPublic = () => import('./pages/PublicPage');
const loadEditor = () => import('./editor/EditorPage');
const loadPlay = () => import('./pages/PlayPage');

/**
 * A page that pulls in the 3D engine loads on demand. This is plain state set when the module arrives, not Suspense:
 * React holds a Suspense reveal back with a timer, and a page under a paused clock would never come up.
 */
function Later<P extends object>({ load, ...props }: { load: () => Promise<{ default: ComponentType<P> }> } & P) {
  const [Page, setPage] = useState<ComponentType<P> | null>(null);
  useEffect(() => {
    let current = true;
    void load().then((module) => current && setPage(() => module.default));
    return () => {
      current = false;
    };
  }, [load]);
  return Page ? <Page {...(props as P)} /> : null;
}

function Router() {
  const path = usePath();
  if (path === '/') return <Later load={loadPublic} />;
  if (path === '/signin') return <SignInPage />;
  if (path === '/app' || /^\/app\/rooms\/[^/]+$/.test(path)) return <Later load={loadEditor} />;
  const play = /^\/play\/([^/]+)$/.exec(path);
  if (play) return <Later load={loadPlay} token={play[1]!} />;
  const pack = /^\/pack\/([^/]+)$/.exec(path);
  if (pack) return <PackPage token={pack[1]!} />;
  return <NotFound />;
}

createRoot(document.getElementById('root')!).render(<Router />);
