import { StrictMode, useCallback, useEffect, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { currentUser, signOut, type CurrentUser } from './lib/api';
import { TopBar, landingFor, navigationFor } from './components/Shell';
import { Billing } from './screens/Billing';
import { Board } from './screens/Board';
import { MySeats } from './screens/MySeats';
import { Offers } from './screens/Offers';
import { Org } from './screens/Org';
import { Requests } from './screens/Requests';
import { SignIn } from './screens/SignIn';

function screenFor(path: string, user: CurrentUser): ReactNode {
  if (path === '/board') return <Board />;
  if (path === '/offers') return <Offers />;
  if (path === '/my-seats') return <MySeats user={user} />;
  if (path === '/billing') return <Billing />;
  if (path === '/org') return <Org user={user} />;
  return <Requests user={user} />;
}

function App(): ReactNode {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [ready, setReady] = useState(false);
  const [path, setPath] = useState(window.location.pathname);

  const navigate = useCallback((to: string) => {
    window.history.pushState({}, '', to);
    setPath(to);
  }, []);

  useEffect(() => {
    const listener = (): void => setPath(window.location.pathname);
    window.addEventListener('popstate', listener);
    return () => window.removeEventListener('popstate', listener);
  }, []);

  useEffect(() => {
    currentUser()
      .then((result) => setUser(result.user))
      .catch(() => setUser(null))
      .finally(() => setReady(true));
  }, []);

  useEffect(() => {
    if (user === null) return;
    const allowed = navigationFor(user.role).map((link) => link.path);
    if (!allowed.includes(path)) navigate(landingFor(user.role));
  }, [user, path, navigate]);

  if (!ready) return <main className="sheet" />;

  if (user === null) {
    return (
      <SignIn
        onSignedIn={(signedIn) => {
          setUser(signedIn);
          navigate(landingFor(signedIn.role));
        }}
      />
    );
  }

  return (
    <>
      <TopBar
        user={user}
        path={path}
        onNavigate={navigate}
        onSignOut={() => {
          void signOut().then(() => {
            setUser(null);
            navigate('/');
          });
        }}
      />
      {screenFor(path, user)}
    </>
  );
}

const root = document.querySelector('#root');
if (root !== null) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
