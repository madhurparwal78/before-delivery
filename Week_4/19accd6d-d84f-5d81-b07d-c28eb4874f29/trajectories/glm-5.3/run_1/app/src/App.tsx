import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from './lib/api.js';
import { useWorkbench } from './lib/use-workbench.js';
import { Cloth, Icon } from './ui/icons.js';
import { Workbench } from './workbench/Workbench.jsx';
import { LibraryPage } from './pages/library.jsx';
import { HistoryPage } from './pages/history.jsx';
import { ImportPage, TeamPage, SnapshotPage } from './pages/misc.jsx';
import { SignupPage, SigninPage, VerifyPage, InvitePage } from './pages/auth.jsx';

interface Route {
  path: string;
  params: Record<string, string>;
}

function parseRoute(): Route {
  const path = location.pathname;
  const params: Record<string, string> = {};
  const qm = new URLSearchParams(location.search);
  for (const [k, v] of qm) params[k] = v;
  return { path, params };
}

export function App(): ReactNode {
  const [route, setRoute] = useState<Route>(parseRoute);
  const wb = useWorkbench();
  const [authTick, setAuthTick] = useState(0);

  useEffect(() => {
    const onPop = () => setRoute(parseRoute());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const navigate = useCallback((path: string) => {
    history.pushState(null, '', path);
    setRoute(parseRoute());
  }, []);

  // Full-page link navigation without a reload.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest('a');
      if (!a) return;
      const href = a.getAttribute('href');
      if (!href || href.startsWith('http') || href.startsWith('#')) return;
      e.preventDefault();
      navigate(href);
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, [navigate]);

  const serviceNotice = wb.livePaused ? 'Live updates paused. Reconnecting…' : '';

  const doSignout = useCallback(async () => {
    await api.signout().catch(() => undefined);
    location.href = '/';
  }, []);

  const screen = useMemo((): ReactNode => {
    const p = route.path;
    if (p === '/' || p === '/w') {
      return <Workbench wb={wb} recipeIdParam={route.params.recipe} versionParam={Number(route.params.version ?? 0)} />;
    }
    if (p === '/library') return <LibraryPage signal={wb.libraryTick + authTick} onOpen={(id) => navigate(`/library/${id}`)} />;
    const historyMatch = /^\/library\/([^/]+)$/.exec(p);
    if (historyMatch) {
      return <HistoryPage recipeId={historyMatch[1]} onOpenVersion={(id, version) => { location.href = `/w?recipe=${id}&version=${version}`; }} />;
    }
    if (p === '/import') return <ImportPage signal={wb.libraryTick} />;
    if (p === '/team') return <TeamPage />;
    const snapMatch = /^\/s\/([^/]+)$/.exec(p);
    if (snapMatch) return <SnapshotPage token={snapMatch[1]} />;
    if (p === '/signup') return <SignupPage onSignedUp={() => setAuthTick((t) => t + 1)} />;
    if (p === '/signin') return <SigninPage onSignedIn={() => setAuthTick((t) => t + 1)} />;
    const verifyMatch = /^\/verify\/([^/]+)$/.exec(p);
    if (verifyMatch) return <VerifyPage token={verifyMatch[1]} onVerified={() => setAuthTick((t) => t + 1)} />;
    const inviteMatch = /^\/invite\/([^/]+)$/.exec(p);
    if (inviteMatch) return <InvitePage token={inviteMatch[1]} onJoined={() => setAuthTick((t) => t + 1)} />;
    return <Workbench wb={wb} />;
  }, [route, wb, navigate, authTick]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <header className="info-strip">
        <a href="/" className="brand" style={{ color: 'inherit', textDecoration: 'none' }}>
          <Cloth />
          <span>Wringbench</span>
        </a>
        <div className="notice" role="status" aria-label="Service notice">{serviceNotice}</div>
        <nav className="links">
          <a href="/library"><Icon name="library" /> Library</a>
          <a href="/import"><Icon name="import" /> Import</a>
          <a href="/team"><Icon name="users" /> Team settings</a>
          {wb.user
            ? <button onClick={() => void doSignout()}><Icon name="logOut" /> Sign out</button>
            : <a href="/signin"><Icon name="logIn" /> Sign in</a>}
        </nav>
      </header>
      <main style={{ flex: 1, minHeight: 0 }}>{screen}</main>
    </div>
  );
}
