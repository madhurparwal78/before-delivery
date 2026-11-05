import { useEffect, useState } from 'react';
import type { Role, User } from '../shared/types';
import { api } from './api';
import { SignInScreen } from './screens/SignIn';
import { IntakeScreen } from './screens/Intake';
import { MyPiecesScreen } from './screens/MyPieces';
import { PieceDetailScreen } from './screens/PieceDetail';
import { BoardScreen } from './screens/Board';
import { CounterScreen } from './screens/Counter';
import { PickupScreen } from './screens/Pickup';
import { StudioScreen } from './screens/Studio';
import { RatesScreen } from './screens/Rates';
import { TrackScreen } from './screens/Track';

const STUDIO_NAME = 'Brickfield Lane Clayhouse';

interface NavLink {
  label: string;
  path: string;
}

const NAV: Record<Role, NavLink[]> = {
  member: [
    { label: 'Intake', path: '/intake' },
    { label: 'My pieces', path: '/pieces' },
  ],
  tech: [
    { label: 'Load board', path: '/board' },
    { label: 'Counter', path: '/counter' },
    { label: 'Pickup shelf', path: '/pickup' },
  ],
  owner: [
    { label: 'Studio', path: '/studio' },
    { label: 'Load board', path: '/board' },
    { label: 'Counter', path: '/counter' },
    { label: 'Pickup shelf', path: '/pickup' },
    { label: 'Rates', path: '/rates' },
  ],
};

const HOME: Record<Role, string> = {
  member: '/intake',
  tech: '/board',
  owner: '/studio',
};

export function navigate(path: string): void {
  window.history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

function Header({ user, path }: { user: User; path: string }): JSX.Element {
  return (
    <header className="header">
      <p className="studio-name">{STUDIO_NAME}</p>
      <nav aria-label="Studio">
        <ul>
          {NAV[user.role].map((link) => (
            <li key={link.path}>
              <a
                href={link.path}
                aria-current={path === link.path ? 'page' : undefined}
                onClick={(event) => {
                  event.preventDefault();
                  navigate(link.path);
                }}
              >
                {link.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <span className="spacer" />
      <span className="mono">{user.name}</span>
      <button
        type="button"
        className="quiet"
        onClick={() => {
          void api.del('/api/session').then(() => {
            window.location.assign('/');
          });
        }}
      >
        Sign out
      </button>
    </header>
  );
}

function screenFor(path: string, user: User): { element: JSX.Element; allowed: Role[] } | null {
  const detail = /^\/pieces\/([^/]+)$/.exec(path);
  if (detail?.[1]) {
    return {
      element: <PieceDetailScreen number={detail[1]} user={user} />,
      allowed: ['member', 'tech', 'owner'],
    };
  }
  switch (path) {
    case '/intake':
      return { element: <IntakeScreen />, allowed: ['member'] };
    case '/pieces':
      return { element: <MyPiecesScreen />, allowed: ['member'] };
    case '/board':
      return { element: <BoardScreen />, allowed: ['tech', 'owner'] };
    case '/counter':
      return { element: <CounterScreen />, allowed: ['tech', 'owner'] };
    case '/pickup':
      return { element: <PickupScreen />, allowed: ['tech', 'owner'] };
    case '/studio':
      return { element: <StudioScreen />, allowed: ['owner'] };
    case '/rates':
      return { element: <RatesScreen />, allowed: ['owner'] };
    default:
      return null;
  }
}

export function App(): JSX.Element {
  const [path, setPath] = useState(window.location.pathname);
  const [user, setUser] = useState<User | null | undefined>(undefined);

  useEffect(() => {
    const listener = (): void => setPath(window.location.pathname);
    window.addEventListener('popstate', listener);
    return () => window.removeEventListener('popstate', listener);
  }, []);

  const tracking = /^\/track\/([^/]+)$/.exec(path);

  useEffect(() => {
    if (window.location.pathname.startsWith('/track/')) {
      setUser(null);
      return;
    }
    api
      .get<User>('/api/me')
      .then((me) => setUser(me))
      .catch(() => setUser(null));
  }, []);

  if (tracking?.[1]) return <TrackScreen token={tracking[1]} />;

  if (user === undefined) return <main />;

  if (user === null) {
    return (
      <SignInScreen
        onSignedIn={(signedIn) => {
          setUser(signedIn);
          navigate(HOME[signedIn.role]);
        }}
      />
    );
  }

  if (path === '/') {
    navigate(HOME[user.role]);
    return <main />;
  }

  const screen = screenFor(path, user);

  return (
    <>
      <Header user={user} path={path} />
      <main>
        {!screen ? (
          <p>Not found.</p>
        ) : !screen.allowed.includes(user.role) ? (
          <p>Your role can&apos;t open this page.</p>
        ) : (
          screen.element
        )}
      </main>
    </>
  );
}
