import { ReactElement, useCallback, useEffect, useState } from 'react';
import { ApiCallError, api } from './api';
import { LiveRegion } from './components/LiveRegion';
import { Link, useRouter } from './router';
import { Role, SessionUser, SystemStatus } from './types';
import { Board } from './pages/Board';
import { Billing } from './pages/Billing';
import { Invoices } from './pages/Invoices';
import { MyPage } from './pages/MyPage';
import { NewRequest } from './pages/NewRequest';
import { OfferPage } from './pages/OfferPage';
import { Preferences } from './pages/Preferences';
import { RequestDetail } from './pages/RequestDetail';
import { RequestsList } from './pages/RequestsList';
import { SignIn } from './pages/SignIn';

const LANDING: Record<Role, string> = {
  coordinator: '/board',
  requester: '/requests',
  interpreter: '/me',
  consumer: '/preferences',
  billing: '/billing',
};

interface NavLink {
  to: string;
  label: string;
}

const NAV: Record<Role, NavLink[]> = {
  coordinator: [{ to: '/board', label: 'Dispatch board' }],
  requester: [
    { to: '/requests', label: 'Requests' },
    { to: '/requests/new', label: 'New request' },
    { to: '/invoices', label: 'Invoices' },
  ],
  interpreter: [{ to: '/me', label: 'My work' }],
  consumer: [{ to: '/preferences', label: 'Preferences' }],
  billing: [
    { to: '/billing', label: 'Billing' },
    { to: '/invoices', label: 'Invoices' },
  ],
};

const MAIL_DOWN = 'Mail is unreachable. Emails are queued and send automatically when it returns.';
const BILLING_DOWN = 'Billing is unreachable. Approvals, charged cancellations and invoices are paused.';

function ServiceStatusBanner(): ReactElement {
  const [status, setStatus] = useState<SystemStatus | null>(null);

  useEffect(() => {
    let live = true;
    const read = async (): Promise<void> => {
      try {
        const next = await api.systemStatus();
        if (live) setStatus(next);
      } catch {
        if (live) setStatus(null);
      }
    };
    void read();
    const timer = window.setInterval(() => void read(), 15000);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, []);

  const messages: string[] = [];
  if (status?.mail === 'down') messages.push(MAIL_DOWN);
  if (status?.killbill === 'down') messages.push(BILLING_DOWN);
  return (
    <LiveRegion label="Service status" message={messages.join(' ')} className="service-status" />
  );
}

function TopBar({ user, onSignOut }: { user: SessionUser; onSignOut: () => void }): ReactElement {
  const { path } = useRouter();
  return (
    <header className="topbar">
      <span className="product">Seatweaver</span>
      <nav aria-label="Main">
        <ul>
          {NAV[user.role].map((link) => (
            <li key={link.to}>
              <Link to={link.to} className={path === link.to ? 'current' : undefined}>
                {link.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <span className="who">{user.name}</span>
      <button type="button" onClick={onSignOut}>
        Sign out
      </button>
    </header>
  );
}

function allowedRoles(path: string): Role[] | null {
  if (path === '/board') return ['coordinator'];
  if (path === '/requests' || path === '/requests/new') return ['requester'];
  if (path.startsWith('/requests/')) return ['requester', 'coordinator', 'billing'];
  if (path === '/invoices') return ['requester', 'billing'];
  if (path === '/me') return ['interpreter'];
  if (path === '/preferences') return ['consumer'];
  if (path === '/billing') return ['billing'];
  return null;
}

function Screen({ user }: { user: SessionUser }): ReactElement {
  const { path } = useRouter();
  if (path === '/board') return <Board />;
  if (path === '/requests') return <RequestsList />;
  if (path === '/requests/new') return <NewRequest />;
  if (path.startsWith('/requests/')) {
    return <RequestDetail requestId={path.slice('/requests/'.length)} user={user} />;
  }
  if (path === '/invoices') return <Invoices user={user} />;
  if (path === '/me') return <MyPage user={user} />;
  if (path === '/preferences') return <Preferences />;
  if (path === '/billing') return <Billing />;
  return <RequestsList />;
}

export function App(): ReactElement {
  const { path, navigate } = useRouter();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loaded, setLoaded] = useState(false);

  const refreshUser = useCallback(async (): Promise<SessionUser | null> => {
    try {
      const { user: me } = await api.me();
      setUser(me);
      return me;
    } catch (error) {
      if (error instanceof ApiCallError) setUser(null);
      return null;
    }
  }, []);

  useEffect(() => {
    void refreshUser().finally(() => setLoaded(true));
  }, [refreshUser]);

  const isOfferLink = path.startsWith('/offers/');

  useEffect(() => {
    if (!loaded || isOfferLink) return;
    if (!user) {
      if (path !== '/signin') navigate('/signin', { replace: true });
      return;
    }
    if (path === '/signin' || path === '/') {
      navigate(LANDING[user.role], { replace: true });
      return;
    }
    const roles = allowedRoles(path);
    if (roles && !roles.includes(user.role)) navigate(LANDING[user.role], { replace: true });
  }, [loaded, user, path, navigate, isOfferLink]);

  if (isOfferLink) {
    return (
      <>
        {user ? (
          <TopBar
            user={user}
            onSignOut={async () => {
              await api.signOut();
              setUser(null);
              navigate('/signin');
            }}
          />
        ) : null}
        <ServiceStatusBanner />
        <OfferPage token={path.slice('/offers/'.length)} />
      </>
    );
  }

  if (!loaded) return <main className="column" />;

  if (!user) {
    return (
      <>
        <ServiceStatusBanner />
        <SignIn
          onSignedIn={(signedIn) => {
            setUser(signedIn);
            navigate(LANDING[signedIn.role], { replace: true });
          }}
        />
      </>
    );
  }

  return (
    <>
      {path === '/board' ? (
        <a className="skip" href="#requests-region">
          Skip to requests
        </a>
      ) : null}
      <TopBar
        user={user}
        onSignOut={async () => {
          await api.signOut();
          setUser(null);
          navigate('/signin');
        }}
      />
      <ServiceStatusBanner />
      <Screen user={user} />
    </>
  );
}
