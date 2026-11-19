import { useState, useEffect } from 'react';
import { useSession, userHome } from './lib/session';
import { useAnnouncement, AnnouncementRegion, useLiveEvents } from './lib/live';
import type { LiveEvent } from './lib/api';
import type { ServiceState } from './components/ServiceNotice';
import { SignIn } from './screens/SignIn';
import { SignUp } from './screens/SignUp';
import { Today } from './screens/Today';
import { Catalogue } from './screens/Catalogue';
import { MonthScreen } from './screens/MonthScreen';
import { YearScreen } from './screens/YearScreen';
import { ClientsScreen } from './screens/ClientsScreen';
import { StatesScreen } from './screens/StatesScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { ReturnScreen } from './screens/ReturnScreen';
import { OwnerHome } from './screens/OwnerHome';

export function App(): React.ReactNode {
  const session = useSession();
  const { announce, line } = useAnnouncement();
  const [service, setService] = useState<ServiceState>({ mailUp: true, pdfUp: true });
  const [routeState, setRouteState] = useState(window.location.pathname + window.location.search);

  // The banner follows the health endpoint, so it also appears on a fresh load
  // during an outage and clears within two retry periods of recovery.
  useEffect(() => {
    let alive = true;
    const check = async () => {
      try {
        const response = await fetch('/api/health');
        const body = (await response.json()) as { status: string };
        if (alive) setService({ mailUp: body.status === 'ok', pdfUp: body.status === 'ok' });
      } catch {
        if (alive) setService({ mailUp: false, pdfUp: false });
      }
    };
    void check();
    const timer = setInterval(check, 2000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    const onPop = () => setRouteState(window.location.pathname + window.location.search);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // Announcements follow the published precedence: the App carries service and
  // clock lines, screens carry their own action lines.
  useLiveEvents((event: LiveEvent) => {
    if (event.kind === 'service_state') {
      setService({ mailUp: Boolean(event.mail_up), pdfUp: Boolean(event.pdf_up) });
      if (!(event.mail_up === true && event.pdf_up === true)) {
        const parts: string[] = [];
        if (event.mail_up !== true) parts.push("Reminders are waiting: mail can't be reached right now.");
        if (event.pdf_up !== true) parts.push("Packets are waiting: the PDF service can't be reached right now.");
        announce(parts[0] ?? '');
      }
    }
    if (event.kind === 'went_overdue') {
      announce(`${String(event.client ?? '')} ${String(event.state ?? '')} ${String(event.period_label ?? '')} is overdue.`);
    }
    if (event.kind === 'packet_ready') {
      announce(`Packet ready for ${String(event.client ?? '')} ${String(event.state ?? '')} ${String(event.period_label ?? '')}.`);
    }
    if (event.kind === 'reminder_sent') {
      announce(`Reminder sent for ${String(event.client ?? '')} ${String(event.state ?? '')} ${String(event.period_label ?? '')}.`);
    }
    if (event.kind === 'owner_approved') {
      announce(`${String(event.owner_name ?? '')} approved ${String(event.state ?? '')} ${String(event.period_label ?? '')}.`);
    }
    if (event.kind === 'owner_sent_back') {
      announce(`${String(event.owner_name ?? '')} sent back ${String(event.state ?? '')} ${String(event.period_label ?? '')}.`);
    }
  });

  const navigate = (path: string) => {
    window.history.pushState({}, '', path);
    setRouteState(path);
  };

  if (session === 'loading') {
    return <div className="page-loading">Duefield</div>;
  }

  if (session === 'signed-out') {
    const signedIn = (user: { role: 'bookkeeper' | 'owner' }) => {
      // A full navigation re-runs the session load on the role's home screen.
      window.location.href = userHome(user);
    };
    return (
      <>
        {routeState.startsWith('/sign-up') ? (
          <SignUp onSignedIn={signedIn} />
        ) : (
          <SignIn onSignedIn={signedIn} />
        )}
        <AnnouncementRegion line={line} />
      </>
    );
  }

  const user = session.me.user;
  const isOwner = user.role === 'owner';
  const queryStart = routeState.indexOf('?');
  const path = (queryStart === -1 ? routeState : routeState.slice(0, queryStart)) || '/';
  const query: Record<string, string> = {};
  if (queryStart !== -1) {
    for (const [key, value] of new URLSearchParams(routeState.slice(queryStart + 1)).entries()) {
      query[key] = value;
    }
  }

  // Role routing: owners only reach /home and /returns/<id>.
  let effectivePath = path;
  if (isOwner && !path.startsWith('/returns/')) effectivePath = '/home';
  if (!isOwner && path === '/home') effectivePath = '/today';

  const screen = renderRoute(effectivePath, session, { path: effectivePath, query, navigate }, announce, service);

  return (
    <>
      {screen}
      <AnnouncementRegion line={line} />
    </>
  );
}

function renderRoute(
  path: string,
  session: { me: import('../../shared/types').MeJson; signOut: () => Promise<void> },
  route: { path: string; query: Record<string, string>; navigate: (path: string) => void },
  announce: (line: string) => void,
  service: ServiceState,
): React.ReactNode {
  const me = session.me;
  if (me.user.role === 'owner') {
    if (path.startsWith('/returns/')) {
      return <ReturnScreen id={path.slice('/returns/'.length)} me={me} announce={announce} />;
    }
    return <OwnerHome me={me} />;
  }
  if (path === '/today') return <Today me={me} service={service} />;
  if (path === '/catalogue') return <Catalogue me={me} />;
  if (path.startsWith('/month')) return <MonthScreen me={me} route={route} announce={announce} service={service} />;
  if (path.startsWith('/year')) return <YearScreen me={me} route={route} announce={announce} />;
  if (path === '/clients') return <ClientsScreen me={me} announce={announce} />;
  if (path === '/states') return <StatesScreen me={me} announce={announce} />;
  if (path === '/settings') return <SettingsScreen me={me} announce={announce} />;
  if (path.startsWith('/returns/')) {
    return <ReturnScreen id={path.slice('/returns/'.length)} me={me} announce={announce} />;
  }
  return <Today me={me} service={service} />;
}

export function SignOutButton({ session, route }: { session: { signOut: () => Promise<void> }; route: { navigate: (path: string) => void } }): React.ReactNode {
  return (
    <button
      type="button"
      className="button button-secondary"
      onClick={() => {
        void session.signOut().then(() => route.navigate('/sign-in'));
      }}
    >
      Sign out
    </button>
  );
}
