import { options, render } from 'preact';
import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'preact/hooks';
import './styles.css';
import type { Me } from './api.js';
import { AppContext, type AppContextValue } from './app-context.js';
import { NotFound, Shell } from './components/shell.js';
import { InvitePage, SigninPage, SignupPage, VerifyPage } from './pages/account.js';
import { AerodromePage, AerodromesPage } from './pages/aerodromes.js';
import { ClassPage } from './pages/class.js';
import { DebriefPage } from './pages/debrief.js';
import { HomePage } from './pages/home.js';
import { LandingPage } from './pages/landing.js';
import { RecordPage } from './pages/record.js';
import { ScenarioPage } from './pages/scenario.js';
import { SessionPage } from './pages/session.js';
import { SettingsPage } from './pages/settings.js';

// Effects run straight after each render rather than on an animation frame, so pushed
// updates render even while the browser clock is paused.
options.requestAnimationFrame = (callback: () => void) => {
  void Promise.resolve().then(callback);
};

function useSystemReducedMotion(): boolean {
  const query = useMemo(() => window.matchMedia('(prefers-reduced-motion: reduce)'), []);
  const [reduced, setReduced] = useState(query.matches);
  useEffect(() => {
    const listener = () => setReduced(query.matches);
    query.addEventListener('change', listener);
    return () => query.removeEventListener('change', listener);
  }, [query]);
  return reduced;
}

const OPEN_PATHS = ['/', '/signup', '/signin', '/verify'];

function route(path: string, me: Me | null) {
  let match: RegExpExecArray | null;
  if (path === '/') return me ? <HomePage /> : <LandingPage />;
  if (path === '/signup') return <SignupPage />;
  if (path === '/signin') return <SigninPage />;
  if (path === '/verify') return <VerifyPage />;
  if ((match = /^\/invite\/([^/]+)$/.exec(path))) return <InvitePage token={match[1]!} />;
  if (!me) return null;
  if ((match = /^\/classes\/([^/]+)$/.exec(path))) return <ClassPage id={match[1]!} />;
  if (path === '/aerodromes') return <AerodromesPage />;
  if ((match = /^\/aerodromes\/([^/]+)$/.exec(path))) return <AerodromePage id={match[1]!} />;
  if (path === '/scenarios/new') return <ScenarioPage id={null} />;
  if ((match = /^\/scenarios\/([^/]+)$/.exec(path))) return <ScenarioPage id={match[1]!} />;
  if ((match = /^\/sessions\/([^/]+)\/debrief$/.exec(path))) return <DebriefPage id={match[1]!} />;
  if ((match = /^\/sessions\/([^/]+)$/.exec(path))) return <SessionPage id={match[1]!} />;
  if ((match = /^\/records\/([^/]+)$/.exec(path))) return <RecordPage id={match[1]!} />;
  if (path === '/settings') return <SettingsPage />;
  return <NotFound />;
}

function App() {
  const [path, setPath] = useState(location.pathname);
  const [me, setMe] = useState<Me | null>(null);
  const [loaded, setLoaded] = useState(false);
  const systemReduced = useSystemReducedMotion();

  const reloadMe = useCallback(async () => {
    const response = await fetch('/api/me', { credentials: 'same-origin' });
    const next = response.ok ? ((await response.json()) as Me) : null;
    setMe(next);
    return next;
  }, []);

  useLayoutEffect(() => {
    void reloadMe().finally(() => setLoaded(true));
    const onPop = () => setPath(location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [reloadMe]);

  const navigate = useCallback((to: string, replace = false) => {
    if (replace) history.replaceState(null, '', to);
    else history.pushState(null, '', to);
    setPath(new URL(to, location.origin).pathname);
    window.scrollTo(0, 0);
  }, []);

  useLayoutEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
      const link = (event.target as Element).closest?.('a');
      if (!link || link.target || link.hasAttribute('download')) return;
      const href = link.getAttribute('href');
      if (!href || !href.startsWith('/') || href.startsWith('//')) return;
      event.preventDefault();
      navigate(href);
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, [navigate]);

  const reducedMotion = systemReduced || Boolean(me?.reduceMotion);
  useLayoutEffect(() => {
    document.documentElement.dataset.reducedMotion = reducedMotion ? 'true' : 'false';
  }, [reducedMotion]);

  const needsSignIn = !OPEN_PATHS.includes(path) && !path.startsWith('/invite/');
  useEffect(() => {
    if (loaded && !me && needsSignIn) location.assign(`/signin?next=${encodeURIComponent(path)}`);
  }, [loaded, me, needsSignIn, path]);

  const value: AppContextValue = { me, setMe, reloadMe, navigate, reducedMotion };
  return (
    <AppContext.Provider value={value}>
      {loaded ? (
        <Shell path={path} key={path}>
          {route(path, me)}
        </Shell>
      ) : (
        <div class="loading-guides" aria-hidden="true" />
      )}
    </AppContext.Provider>
  );
}

render(<App />, document.getElementById('app')!);
