import { useEffect } from 'react';
import { AuthPage } from './pages/Auth.js';
import { EditorPage } from './pages/EditorPage.js';
import { JoinPage } from './pages/JoinPage.js';
import { LibraryPage } from './pages/Library.js';
import { NotAvailable } from './pages/NotAvailable.js';
import { ViewPage } from './pages/ViewPage.js';
import { useLocation } from './lib/router.js';

export function App() {
  const path = useLocation().split('?')[0];
  useEffect(() => {
    document.title = 'Mullion';
  }, [path]);
  const [, section, rest] = path.split('/');
  if (path === '/') return <LibraryPage />;
  if (path === '/signup') return <AuthPage mode="signup" />;
  if (path === '/signin') return <AuthPage mode="signin" />;
  if (section === 'layouts' && rest) return <EditorPage id={rest} key={rest} />;
  if (section === 'view' && rest) return <ViewPage token={rest} key={rest} />;
  if (section === 'join' && rest) return <JoinPage token={rest} key={rest} />;
  return <NotAvailable signedIn />;
}
