import { useEffect, useState } from 'react';
import { loadSession, useSession } from './api.js';
import { Column } from './Chrome.js';
import { HomePage } from './Home.js';
import { navigate, useLocation } from './router.js';
import { SignInPage } from './SignIn.js';
import { TeamPage } from './Team.js';
import { WidgetPage } from './Widget.js';
import { Link, WorkspacePage } from './WorkspacePage.js';

function NotFoundPage() {
  useEffect(() => {
    document.title = 'Not found · Hushline';
  }, []);
  return (
    <main className="screen">
      <Column>
        <h1>There&apos;s no page here.</h1>
        <Link href="/inbox" className="button primary">Back to the inbox</Link>
      </Column>
    </main>
  );
}

const needsSession = (path: string): boolean => /^\/(inbox(\/[^/]+)?|team)$/.test(path);

export function App() {
  const location = useLocation();
  const [path, search = ''] = location.split(/\?(.*)/s);
  const session = useSession();
  const [checked, setChecked] = useState(!needsSession(window.location.pathname));
  useEffect(() => {
    if (!checked) void loadSession().then(() => setChecked(true));
  }, [checked]);
  useEffect(() => {
    if (checked && !session && needsSession(path as string)) navigate('/signin', { replace: true });
  }, [checked, session, path]);

  const widget = /^\/widget\/([^/]+)$/.exec(path as string);
  if (path === '/') return <HomePage />;
  if (path === '/signin') return <SignInPage />;
  if (widget) return <WidgetPage slug={decodeURIComponent(widget[1] as string)} search={search} />;
  if (needsSession(path as string)) {
    if (!session) return null;
    return path === '/team' ? <TeamPage /> : <WorkspacePage location={location} />;
  }
  return <NotFoundPage />;
}
