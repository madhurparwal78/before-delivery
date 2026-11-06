// Quire in the browser: the session, the router and the screens inside the workspace frame.
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/base.css';
import './styles/frame.css';
import { get, onUnauthenticated, setCsrf } from './api.ts';
import { Frame } from './Frame.tsx';
import { refreshLibrary } from './library.ts';
import { useLocation } from './router.ts';
import { applyTheme, setSession, setZone } from './session.ts';
import { startSync, useSync } from './sync.ts';
import type { SessionJson } from './types.ts';
import { SignIn } from './screens/SignIn.tsx';
import { ObjectPage, TodayPage } from './screens/ObjectPage.tsx';
import { TypePage } from './screens/TypePage.tsx';
import { CollectionPage } from './screens/CollectionPage.tsx';
import { BoardPage } from './screens/BoardPage.tsx';
import { TimelinePage } from './screens/TimelinePage.tsx';
import { QueriesPage } from './screens/QueriesPage.tsx';
import { GraphPage } from './screens/GraphPage.tsx';
import { SettingsPage } from './screens/SettingsPage.tsx';
import { NotFound } from './screens/NotFound.tsx';
import type { ThemeName } from '../shared/tokens.ts';

const SIGNED_OUT_FLAG = 'signed-out';

/** Leaves the workspace for sign-in, remembering where the tab was. */
function toSignIn(reason?: string): void {
  const here = `${window.location.pathname}${window.location.search}`;
  const query = new URLSearchParams({ return: here });
  if (reason) query.set('reason', reason);
  window.location.assign(`/sign-in?${query.toString()}`);
}

function Screen() {
  const { path } = useLocation();
  let m: RegExpExecArray | null;
  if (path === '/today') return <TodayPage />;
  if ((m = /^\/o\/([^/]+)$/.exec(path))) return <ObjectPage key={m[1]} objectId={m[1]} />;
  if ((m = /^\/types\/([^/]+)$/.exec(path))) return <TypePage key={m[1]} typeId={m[1]} />;
  if ((m = /^\/collections\/([^/]+)\/board$/.exec(path))) return <BoardPage key={m[1]} collectionId={m[1]} />;
  if ((m = /^\/collections\/([^/]+)$/.exec(path))) return <CollectionPage key={m[1]} collectionId={m[1]} />;
  if (path === '/timeline') return <TimelinePage />;
  if (path === '/queries') return <QueriesPage queryId={null} />;
  if ((m = /^\/queries\/([^/]+)$/.exec(path))) return <QueriesPage queryId={m[1]} />;
  if (path === '/graph') return <GraphPage />;
  if (path === '/settings') return <SettingsPage />;
  return <NotFound />;
}

function Workspace() {
  const { path } = useLocation();
  useSync((event, data) => {
    if (event === 'settings.saved') {
      const s = data as { home_time_zone: string; theme: ThemeName };
      applyTheme(s.theme);
      setZone(s.home_time_zone);
    }
  });
  return (
    <Frame wide={/\/board$/.test(path) || path === '/timeline'} bleed={path === '/graph'}>
      <Screen />
    </Frame>
  );
}

function App() {
  const { path } = useLocation();
  const [ready, setReady] = useState<'loading' | 'in' | 'out'>('loading');
  useEffect(() => {
    onUnauthenticated(() => toSignIn(SIGNED_OUT_FLAG));
    if (path === '/sign-in') {
      setReady('out');
      return;
    }
    void get<SessionJson>('/api/session').then(async (r) => {
      if (r.status !== 200) return;
      setCsrf(r.data.csrf_token);
      setSession(r.data);
      startSync();
      // The library (types in library order, collections) is ready before any screen opens.
      await refreshLibrary();
      setReady('in');
    }).catch(() => setReady('in'));
    // The session is read once per page load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (path === '/sign-in') return <SignIn />;
  if (ready === 'in') return <Workspace />;
  return null;
}

const root = document.getElementById('root');
if (root) createRoot(root).render(<StrictMode><App /></StrictMode>);
