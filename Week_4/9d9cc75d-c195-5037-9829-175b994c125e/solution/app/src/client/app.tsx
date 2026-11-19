import { useEffect, useRef } from 'react';
import { setUnauthenticatedHandler } from './api/client.ts';
import type { Me } from './api/types.ts';
import { DashboardPage } from './pages/dashboard/index.tsx';
import { HomePage } from './pages/home/index.tsx';
import { InboxPage } from './pages/inbox/index.tsx';
import { NotFoundPage } from './pages/notfound/index.tsx';
import { ProjectPage } from './pages/project/index.tsx';
import { SheetPage } from './pages/sheet/index.tsx';
import { SignInPage } from './pages/signin/index.tsx';
import { SourcePage } from './pages/source/index.tsx';
import { UploadPage } from './pages/upload/index.tsx';
import { WorkbookPage } from './pages/workbook/index.tsx';
import { WorkbooksPage } from './pages/workbooks/index.tsx';
import { matchRoute, navigate, signInPath, useLocation } from './router.ts';
import type { Route } from './router.ts';
import { Header } from './shell/header.tsx';
import { SessionProvider } from './shell/session.tsx';

/** Every page the app has, first match wins. Add a page here: `{ pattern: '/dashboards/:id', page: DashboardPage }`. */
const routes: readonly Route[] = [
  { pattern: '/', page: HomePage },
  { pattern: '/signin', page: SignInPage },
  { pattern: '/workbooks', page: WorkbooksPage },
  { pattern: '/workbooks/:id', page: WorkbookPage },
  { pattern: '/workbooks/:id/sheets/:sheet', page: SheetPage },
  { pattern: '/dashboards/:id', page: DashboardPage },
  { pattern: '/projects/:id', page: ProjectPage },
  { pattern: '/sources/new', page: UploadPage },
  { pattern: '/sources/:id', page: SourcePage },
  { pattern: '/inbox', page: InboxPage },
];

setUnauthenticatedHandler(() => {
  if (window.location.pathname === '/signin') return;
  navigate(signInPath(window.location.pathname + window.location.search), { replace: true });
});

function Screen() {
  const location = useLocation();
  const match = matchRoute(routes, location.path);
  const main = useRef<HTMLElement>(null);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) first.current = false;
    else main.current?.focus({ preventScroll: true });
  }, [location.path]);

  return (
    <>
      <Header />
      <main id="main" ref={main} tabIndex={-1} className="screen">
        {match ? <match.route.page key={location.path} params={match.params} /> : <NotFoundPage />}
      </main>
    </>
  );
}

export function App({ initial }: { initial: Me | null }) {
  return (
    <SessionProvider initial={initial}>
      <Screen />
    </SessionProvider>
  );
}
