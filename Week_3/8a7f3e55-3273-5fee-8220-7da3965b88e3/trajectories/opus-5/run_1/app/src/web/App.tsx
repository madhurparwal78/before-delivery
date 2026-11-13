import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { AgencySettings, Contract, Role, SessionUser } from '../shared/api.js';
import { jsonRequest, registerSessionGate, sendAction, sendRefetch } from './api.js';
import { navigate, useLocationHref } from './hooks.js';
import { LiveProvider, LiveRegionsView } from './live.js';
import { SessionEndedDialog } from './dialogs/SessionEndedDialog.js';
import { BillingHome } from './screens/BillingHome.js';
import { BookingDeepLink } from './screens/DeepLink.js';
import { CoordinatorHome } from './screens/CoordinatorHome.js';
import { InterpreterHome } from './screens/InterpreterHome.js';
import { RequesterHome } from './screens/RequesterHome.js';
import { SignIn } from './screens/SignIn.js';

const ROLE_LABELS: Record<Role, string> = {
  coordinator: 'Dispatch coordinator',
  interpreter: 'Staff interpreter',
  requester: 'Client requester',
  billing_manager: 'Billing manager',
};

function Header({
  user,
  timeZone,
  onSignOut,
}: {
  user: SessionUser;
  timeZone: string;
  onSignOut: () => void;
}): ReactNode {
  return (
    <header className="header">
      <span className="product">Relayline</span>
      <nav aria-label="Main">
        <span className="who">{`Signed in as ${user.name} · ${ROLE_LABELS[user.role]}`}</span>
      </nav>
      <span className="zone">{`Times in ${timeZone}`}</span>
      <span className="spacer" />
      <button type="button" onClick={onSignOut}>
        Sign out
      </button>
    </header>
  );
}

function RoleHome({
  user,
  agency,
  contracts,
}: {
  user: SessionUser;
  agency: AgencySettings;
  contracts: Contract[];
}): ReactNode {
  switch (user.role) {
    case 'coordinator':
      return (
        <CoordinatorHome
          agency={agency}
          organisations={contracts.map((contract) => ({
            id: contract.org_id,
            name: contract.org_name,
          }))}
        />
      );
    case 'interpreter':
      return <InterpreterHome />;
    case 'requester':
      return <RequesterHome agency={agency} />;
    case 'billing_manager':
      return <BillingHome agency={agency} />;
  }
}

function SignedIn({
  user,
  onUser,
}: {
  user: SessionUser;
  onUser: (user: SessionUser | null) => void;
}): ReactNode {
  const href = useLocationHref();
  const [agency, setAgency] = useState<AgencySettings | null>(null);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [gateResolve, setGateResolve] = useState<((signedIn: boolean) => void) | null>(null);
  const loadedFor = useRef('');

  useEffect(() => {
    registerSessionGate(() => new Promise<boolean>((resolve) => setGateResolve(() => resolve)));
    return () => registerSessionGate(null);
  }, []);

  useEffect(() => {
    if (loadedFor.current === user.id) return;
    loadedFor.current = user.id;
    void sendRefetch<AgencySettings>('/api/agency').then((outcome) => {
      if (outcome.kind === 'ok') setAgency(outcome.data);
    });
    if (user.role === 'coordinator' || user.role === 'billing_manager') {
      void sendRefetch<{ contracts: Contract[] }>('/api/contracts').then((outcome) => {
        if (outcome.kind === 'ok') setContracts(outcome.data.contracts);
      });
    }
  }, [user.id, user.role]);

  const signOut = async (): Promise<void> => {
    await sendAction(jsonRequest('DELETE', '/api/session'));
    onUser(null);
    navigate('/', 'replace');
  };

  const deepLink = /^\/bookings\/([^/?]+)/.exec(href);

  return (
    <>
      <Header user={user} timeZone={agency?.time_zone ?? ''} onSignOut={() => void signOut()} />
      <LiveRegionsView />
      <main>
        {agency === null ? (
          <p className="empty-row">Loading…</p>
        ) : deepLink !== null && deepLink[1] !== undefined ? (
          <BookingDeepLink bookingId={deepLink[1]} role={user.role} />
        ) : (
          <RoleHome user={user} agency={agency} contracts={contracts} />
        )}
      </main>
      {gateResolve === null ? null : (
        <SessionEndedDialog
          email={user.email}
          onSignedIn={(fresh) => {
            onUser(fresh);
            gateResolve(true);
            setGateResolve(null);
          }}
          onSignedOut={() => {
            gateResolve(false);
            setGateResolve(null);
            onUser(null);
            navigate('/', 'replace');
          }}
        />
      )}
    </>
  );
}

export function App(): ReactNode {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    void sendRefetch<SessionUser>('/api/me').then((outcome) => {
      if (outcome.kind === 'ok') setUser(outcome.data);
      setChecked(true);
    });
  }, []);

  return (
    <LiveProvider>
      <div className="app">
        {user === null ? (
          <>
            <LiveRegionsView />
            <main>{checked ? <SignIn onSignedIn={setUser} /> : null}</main>
          </>
        ) : (
          <SignedIn user={user} onUser={setUser} />
        )}
      </div>
    </LiveProvider>
  );
}
