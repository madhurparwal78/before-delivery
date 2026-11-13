import { StrictMode, createContext, useContext, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { read, send } from './api.ts';
import { SERVICE_COPY } from './format.ts';
import { useInterval } from './hooks.ts';
import { AccountsScreen } from './screens/Accounts.tsx';
import { BoardScreen } from './screens/Board.tsx';
import { InvoiceScreen } from './screens/Invoice.tsx';
import { LoginScreen } from './screens/Login.tsx';
import { MoveScreen } from './screens/Move.tsx';
import { NotFound } from './screens/NotFound.tsx';
import { OrdersScreen } from './screens/Orders.tsx';
import { PilotScreen } from './screens/Pilot.tsx';
import { ReportScreen } from './screens/Report.tsx';
import type { PortReply, Role, ServiceSnapshot, SessionUser } from './types.ts';

export type Navigation = {
  path: string;
  search: URLSearchParams;
  navigate: (target: string) => void;
  replace: (target: string) => void;
};

const NavigationContext = createContext<Navigation>({
  path: '/',
  search: new URLSearchParams(),
  navigate: () => undefined,
  replace: () => undefined,
});

export function useNavigation(): Navigation {
  return useContext(NavigationContext);
}

const HOME: Record<Role, string> = {
  dispatcher: '/board',
  agent: '/orders',
  pilot: '/pilot',
  clerk: '/accounts',
};

function ServiceState({ services }: { services: ServiceSnapshot }): JSX.Element {
  const items: [keyof ServiceSnapshot, string][] = [
    ['billing', 'Billing'],
    ['storage', 'Storage'],
    ['mail', 'Mail'],
  ];
  return (
    <div className="service-state" role="region" aria-label="Service state">
      {items.map(([name, label]) => (
        <span key={name} className={services[name] === 'down' ? 'down mono' : 'mono'}>
          {`${label} ${services[name]}`}
        </span>
      ))}
    </div>
  );
}

function Shell({
  user,
  port,
  services,
  onSignOut,
  children,
}: {
  user: SessionUser;
  port: PortReply | null;
  services: ServiceSnapshot;
  onSignOut: () => void;
  children: React.ReactNode;
}): JSX.Element {
  const outages = (['billing', 'storage', 'mail'] as const)
    .filter((name) => services[name] === 'down')
    .map((name) => SERVICE_COPY[name] as string);
  return (
    <>
      <header className="top-strip">
        <span className="product">Ebbstone Marine Slackwater</span>
        <span className="dim">{user.role}</span>
        <span className="mono">{`${(port?.now ?? '').slice(11, 19)} port time`}</span>
        <ServiceState services={services} />
        <span className="spacer" />
        <button type="button" onClick={onSignOut}>
          Sign out
        </button>
      </header>
      <div role="status" aria-label="Service announcements" className="announce">
        {outages.join(' ')}
      </div>
      <main className="screen">{children}</main>
    </>
  );
}

function Screen({ user }: { user: SessionUser }): JSX.Element {
  const navigation = useNavigation();
  const path = navigation.path;
  if (path === '/' || path === '') {
    navigation.replace(HOME[user.role]);
    return <p>Loading...</p>;
  }
  if (path === '/board') {
    return user.role === 'dispatcher' ? <BoardScreen user={user} /> : <NotFound />;
  }
  if (path === '/orders') {
    return user.role === 'agent' ? <OrdersScreen user={user} /> : <NotFound />;
  }
  if (path === '/pilot') {
    return user.role === 'pilot' ? <PilotScreen user={user} /> : <NotFound />;
  }
  if (path === '/accounts') {
    return user.role === 'clerk' ? <AccountsScreen /> : <NotFound />;
  }
  const move = /^\/moves\/([^/]+)$/.exec(path);
  if (move !== null) return <MoveScreen user={user} ref_={move[1] as string} />;
  const report = /^\/reports\/([^/]+)$/.exec(path);
  if (report !== null) return <ReportScreen id={report[1] as string} />;
  const invoice = /^\/invoices\/([^/]+)$/.exec(path);
  if (invoice !== null) return <InvoiceScreen id={invoice[1] as string} />;
  return <NotFound />;
}

function App(): JSX.Element {
  const [location, setLocation] = useState(() => ({
    path: window.location.pathname,
    search: window.location.search,
  }));
  const [user, setUser] = useState<SessionUser | null | undefined>(undefined);
  const [port, setPort] = useState<PortReply | null>(null);
  const [services, setServices] = useState<ServiceSnapshot>({
    billing: 'up',
    storage: 'up',
    mail: 'up',
  });

  useEffect(() => {
    const onPopState = (): void =>
      setLocation({ path: window.location.pathname, search: window.location.search });
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const navigation: Navigation = {
    path: location.path,
    search: new URLSearchParams(location.search),
    navigate: (target) => {
      window.history.pushState(null, '', target);
      const url = new URL(target, window.location.origin);
      setLocation({ path: url.pathname, search: url.search });
    },
    replace: (target) => {
      window.history.replaceState(null, '', target);
      const url = new URL(target, window.location.origin);
      setLocation({ path: url.pathname, search: url.search });
    },
  };

  useEffect(() => {
    void (async () => {
      const session = await read<{ user: SessionUser }>('/api/session');
      setUser(session === null ? null : session.user);
    })();
  }, []);

  useEffect(() => {
    if (user === undefined || user === null) return;
    void (async () => {
      setPort(await read<PortReply>('/api/port'));
      const snapshot = await read<ServiceSnapshot>('/api/services');
      if (snapshot !== null) setServices(snapshot);
    })();
  }, [user]);

  useInterval(() => {
    if (user === undefined || user === null) return;
    void (async () => {
      const [next, snapshot] = await Promise.all([
        read<PortReply>('/api/port'),
        read<ServiceSnapshot>('/api/services'),
      ]);
      if (next !== null) setPort(next);
      if (snapshot !== null) setServices(snapshot);
    })();
  }, 12_000);

  if (user === undefined) {
    return <p>Loading...</p>;
  }

  if (user === null) {
    return (
      <NavigationContext.Provider value={navigation}>
        <LoginScreen
          onSignedIn={(signedIn) => {
            setUser(signedIn);
            navigation.replace(HOME[signedIn.role]);
          }}
        />
      </NavigationContext.Provider>
    );
  }

  if (location.path === '/login') {
    navigation.replace(HOME[user.role]);
  }

  return (
    <NavigationContext.Provider value={navigation}>
      <Shell
        user={user}
        port={port}
        services={services}
        onSignOut={() => {
          void (async () => {
            await send('DELETE', '/api/session');
            setUser(null);
            navigation.replace('/login');
          })();
        }}
      >
        <Screen user={user} />
      </Shell>
    </NavigationContext.Provider>
  );
}

const root = document.getElementById('root');
if (root !== null) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
