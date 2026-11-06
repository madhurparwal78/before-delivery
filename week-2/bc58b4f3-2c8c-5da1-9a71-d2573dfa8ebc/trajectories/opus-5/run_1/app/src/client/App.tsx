import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { SCREENS_BY_ROLE, type Role, type SessionUser } from '../shared/contract.js';
import { api } from './api.js';
import { Billing } from './screens/Billing.js';
import { Board } from './screens/Board.js';
import { MySeats } from './screens/MySeats.js';
import { Offers } from './screens/Offers.js';
import { Org } from './screens/Org.js';
import { Requests } from './screens/Requests.js';
import { SignIn } from './screens/SignIn.js';
import { TopBar, landingPathFor } from './ui.js';

export function App(): ReactNode {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [path, setPath] = useState(window.location.pathname);

  useEffect(() => {
    void api
      .me()
      .then((result) => setUser(result.user))
      .catch(() => setUser(null))
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    const onPopState = (): void => setPath(window.location.pathname);
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const navigate = useCallback((to: string, replace = false): void => {
    if (replace) {
      window.history.replaceState({}, '', to);
    } else {
      window.history.pushState({}, '', to);
    }
    setPath(to);
  }, []);

  useEffect(() => {
    if (user === null) {
      return;
    }
    if (!SCREENS_BY_ROLE[user.role].some((screen) => screen.path === path)) {
      navigate(landingPathFor(user.role), true);
    }
  }, [user, path, navigate]);

  if (!loaded) {
    return <main className="signin" />;
  }

  if (user === null) {
    return (
      <SignIn
        onSignedIn={(signedIn) => {
          setUser(signedIn);
          navigate(landingPathFor(signedIn.role), true);
        }}
      />
    );
  }

  const signOut = async (): Promise<void> => {
    await api.signOut();
    setUser(null);
    navigate('/', true);
  };

  return (
    <div className="app">
      <TopBar user={user} path={path} onNavigate={navigate} onSignOut={() => void signOut()} />
      <Screen role={user.role} path={path} user={user} />
    </div>
  );
}

function Screen({ role, path, user }: { role: Role; path: string; user: SessionUser }): ReactNode {
  const allowed = SCREENS_BY_ROLE[role].map((screen) => screen.path);
  const resolved = allowed.includes(path) ? path : landingPathFor(role);
  switch (resolved) {
    case '/requests':
      return <Requests user={user} />;
    case '/board':
      return <Board user={user} />;
    case '/offers':
      return <Offers />;
    case '/my-seats':
      return <MySeats user={user} />;
    case '/billing':
      return <Billing />;
    case '/org':
      return <Org user={user} />;
    default:
      return <main className="sheet sheet--plain" />;
  }
}
