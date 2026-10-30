import { useEffect, useState, type ReactNode } from 'react';
import type { Kitchen, Role, User } from '../shared/types';
import { api } from './api';
import { useNarrow } from './hooks';
import { navigate, useLocation } from './router';
import { ServiceBanner, useServices } from './services';
import { LoomScreen } from './loom/LoomScreen';
import { BookingsScreen } from './screens/Bookings';
import { BillingScreen } from './screens/Billing';
import { MembersScreen } from './screens/Members';
import { PapersScreen } from './screens/Papers';
import { RatesScreen } from './screens/Rates';
import { ReportsScreen } from './screens/Reports';
import { SignInScreen } from './screens/SignIn';
import { Menu, TriangleAlert } from './ui/icons';

interface NavItem {
  path: string;
  label: string;
  roles: Role[];
}

const NAV: NavItem[] = [
  { path: '/loom', label: 'Loom', roles: ['operator', 'member'] },
  { path: '/bookings', label: 'Bookings', roles: ['operator', 'member', 'bookkeeper'] },
  { path: '/papers', label: 'Papers', roles: ['operator', 'member'] },
  { path: '/billing', label: 'Billing', roles: ['member'] },
  { path: '/members', label: 'Members', roles: ['operator'] },
  { path: '/rates', label: 'Rates', roles: ['operator'] },
  { path: '/reports', label: 'Reports', roles: ['operator', 'bookkeeper'] },
];

export function landingFor(role: Role): string {
  return role === 'bookkeeper' ? '/reports' : '/loom';
}

export interface Session {
  user: User;
  kitchen: Kitchen;
  reload: () => void;
}

export function App(): ReactNode {
  const [user, setUser] = useState<User | null>(null);
  const [kitchen, setKitchen] = useState<Kitchen | null>(null);
  const [ready, setReady] = useState(false);
  const [version, setVersion] = useState(0);
  const location = useLocation();

  useEffect(() => {
    let live = true;
    void api
      .me()
      .then(async ({ user: found }) => {
        const { kitchen: own } = await api.kitchen(found.kitchen_id);
        if (!live) return;
        setUser(found);
        setKitchen(own);
      })
      .catch(() => {
        if (live) {
          setUser(null);
          setKitchen(null);
        }
      })
      .finally(() => live && setReady(true));
    return () => {
      live = false;
    };
  }, [version]);

  if (!ready) return <main />;

  if (!user || !kitchen) {
    return (
      <SignInScreen
        onSignedIn={(signed) => {
          setVersion((value) => value + 1);
          navigate(landingFor(signed.role));
        }}
      />
    );
  }

  if (location.path === '/signin' || location.path === '/') {
    navigate(landingFor(user.role));
  }

  const session: Session = {
    user,
    kitchen,
    reload: () => setVersion((value) => value + 1),
  };

  return (
    <ServiceBanner>
      <Shell session={session} onSignOut={() => setVersion((value) => value + 1)}>
        <Screen session={session} path={location.path} />
      </Shell>
    </ServiceBanner>
  );
}

function Screen({ session, path }: { session: Session; path: string }): ReactNode {
  const allowed = NAV.find((item) => item.path === path && item.roles.includes(session.user.role));
  if (!allowed) return <Redirect to={landingFor(session.user.role)} />;
  switch (path) {
    case '/loom':
      return <LoomScreen session={session} />;
    case '/bookings':
      return <BookingsScreen session={session} />;
    case '/papers':
      return <PapersScreen session={session} />;
    case '/billing':
      return <BillingScreen session={session} />;
    case '/members':
      return <MembersScreen session={session} />;
    case '/rates':
      return <RatesScreen session={session} />;
    case '/reports':
      return <ReportsScreen session={session} />;
    default:
      return <Redirect to={landingFor(session.user.role)} />;
  }
}

function Redirect({ to }: { to: string }): ReactNode {
  useEffect(() => navigate(to), [to]);
  return <main />;
}

function Shell({
  session,
  onSignOut,
  children,
}: {
  session: Session;
  onSignOut: () => void;
  children: ReactNode;
}): ReactNode {
  const narrow = useNarrow();
  const [menuOpen, setMenuOpen] = useState(false);
  const { lines } = useServices();
  const location = useLocation();
  const items = NAV.filter((item) => item.roles.includes(session.user.role));

  const signOut = (): void => {
    void api.signOut().finally(() => {
      navigate('/signin');
      onSignOut();
    });
  };

  return (
    <>
      <header className="topbar">
        <span className="brand">Pilotlight</span>
        <span className="kitchen-name">{session.kitchen.name}</span>
        <nav aria-label="Main">
          {items.map((item) => (
            <a
              key={item.path}
              href={item.path}
              aria-current={location.path === item.path ? 'page' : undefined}
              onClick={(event) => {
                event.preventDefault();
                navigate(item.path);
              }}
            >
              {item.label}
            </a>
          ))}
        </nav>
        {narrow && (
          <button type="button" style={{ marginLeft: 'auto' }} onClick={() => setMenuOpen(true)}>
            Menu
          </button>
        )}
        <button type="button" onClick={signOut}>
          Sign out
        </button>
      </header>

      <div className="banner" role="status" aria-label="Service status">
        {lines.length > 0 && (
          <div className="banner-inner banner-enter">
            {lines.map((line) => (
              <p className="banner-line" key={line}>
                <TriangleAlert size={15} aria-hidden="true" />
                <span>{line}</span>
              </p>
            ))}
          </div>
        )}
      </div>

      {menuOpen && narrow && (
        <div className="menu-sheet">
          <nav aria-label="Main">
            {items.map((item) => (
              <a
                key={item.path}
                href={item.path}
                aria-current={location.path === item.path ? 'page' : undefined}
                onClick={(event) => {
                  event.preventDefault();
                  setMenuOpen(false);
                  navigate(item.path);
                }}
              >
                {item.label}
              </a>
            ))}
          </nav>
          <button type="button" onClick={() => setMenuOpen(false)}>
            <Menu size={16} aria-hidden="true" /> Close menu
          </button>
        </div>
      )}

      <main>{children}</main>
    </>
  );
}
