import { useCallback, useEffect, useState } from 'react';
import type { Clock, Person, Role } from './api.js';
import { call, currentRoute } from './guard.js';
import { setGuards } from './guard.js';
import { startLive, stopLive, useLive } from './live.js';
import { go, replace, useLocation } from './router.js';
import { Audit } from './components/Audit.js';
import { Billing } from './components/Billing.js';
import { Drawer } from './components/Drawer.js';
import { Health } from './components/Health.js';
import { ImportScreen } from './components/ImportScreen.js';
import { Landing } from './components/Landing.js';
import { People } from './components/People.js';
import { Reviews } from './components/Reviews.js';
import { Rotations } from './components/Rotations.js';
import { NotFound, SessionEnded, Shell } from './components/Shell.js';
import { SignIn } from './components/SignIn.js';
import { MyTravel } from './components/Travel.js';

const DESK_ROUTES: Record<string, readonly Role[]> = {
  '/desk': ['office_manager', 'managing_partner', 'staff_accountant', 'outside_bookkeeper'],
  '/rotations': ['office_manager', 'managing_partner'],
  '/reviews': ['office_manager', 'managing_partner'],
  '/people': ['office_manager', 'managing_partner'],
  '/travel': ['staff_accountant', 'outside_bookkeeper'],
  '/billing': ['office_manager', 'managing_partner'],
  '/health': ['office_manager', 'managing_partner'],
  '/import': ['office_manager'],
  '/audit': ['office_manager', 'managing_partner'],
};

function isDeskRoute(path: string): boolean {
  return path in DESK_ROUTES || /^\/desk\/vaults\/[^/]+$/.test(path);
}

export function App(): React.ReactElement {
  const where = useLocation();
  const [me, setMe] = useState<Person | null>(null);
  const [clock, setClock] = useState<Clock | null>(null);
  const [ready, setReady] = useState(false);
  const [ended, setEnded] = useState(false);

  const readClock = useCallback(() => {
    void call<Clock>('/api/clock')
      .then(setClock)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    setGuards({
      sessionEnded: () => setEnded(true),
      signedOut: () => {
        setMe(null);
        stopLive();
        if (isDeskRoute(window.location.pathname)) {
          go(`/sign-in?next=${encodeURIComponent(currentRoute())}`);
        }
      },
    });
  }, []);

  useEffect(() => {
    readClock();
    const beat = window.setInterval(readClock, 15_000);
    return () => window.clearInterval(beat);
  }, [readClock]);

  useEffect(() => {
    void call<{ person: Person }>('/api/me')
      .then((answer) => {
        setMe(answer.person);
        startLive();
      })
      .catch(() => undefined)
      .finally(() => setReady(true));
  }, []);

  useLive(
    'session-ended',
    useCallback(() => setEnded(true), []),
  );

  const signOut = async (): Promise<void> => {
    await call('/api/sessions', { method: 'DELETE' }).catch(() => undefined);
    stopLive();
    setMe(null);
    go('/');
  };

  if (where.path === '/' || where.path === '') return <Landing />;

  if (where.path === '/sign-in') {
    return (
      <SignIn
        onSignedIn={(person) => {
          setMe(person);
          setEnded(false);
          startLive();
          readClock();
        }}
      />
    );
  }

  if (!isDeskRoute(where.path)) return <NotFound />;

  if (!ready || clock === null) return <main className="desk-main" />;

  if (me === null) {
    replace(`/sign-in?next=${encodeURIComponent(currentRoute())}`);
    return <main className="desk-main" />;
  }

  if (ended) return <SessionEnded route={currentRoute()} />;

  const allowed = DESK_ROUTES[where.path];
  if (allowed !== undefined && !allowed.includes(me.role)) {
    return (
      <Shell me={me} clock={clock} onSignOut={() => void signOut()}>
        <NotFound />
      </Shell>
    );
  }

  const vaultMatch = /^\/desk\/vaults\/([^/]+)$/.exec(where.path);

  return (
    <Shell me={me} clock={clock} onSignOut={() => void signOut()}>
      {where.path === '/desk' || vaultMatch !== null ? (
        <Drawer me={me} clock={clock} openVaultId={vaultMatch?.[1] ?? null} />
      ) : null}
      {where.path === '/rotations' ? <Rotations me={me} clock={clock} /> : null}
      {where.path === '/reviews' ? <Reviews me={me} /> : null}
      {where.path === '/people' ? <People me={me} /> : null}
      {where.path === '/travel' ? <MyTravel me={me} /> : null}
      {where.path === '/billing' ? <Billing /> : null}
      {where.path === '/health' ? <Health clock={clock} /> : null}
      {where.path === '/import' ? <ImportScreen /> : null}
      {where.path === '/audit' ? <Audit clock={clock} /> : null}
    </Shell>
  );
}
