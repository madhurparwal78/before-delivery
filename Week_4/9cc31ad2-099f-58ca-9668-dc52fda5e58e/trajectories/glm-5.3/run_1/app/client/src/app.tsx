// The app: routing, session redirects, the header, the outage banner.
import { useCallback, useEffect, useState, type JSX } from 'react';
import { AppProvider, useApp } from './appState';
import { Header } from './header';
import { useNavigation } from './ui';
import GuestStart, { acceptedNext } from './guestStart';
import GarageScreen from './garageScreen';
import DealerScreen from './dealerScreen';
import CoinHistoryScreen from './coinHistoryScreen';
import RaceScreen, { parseRaceAddress } from './raceScreen';
import ResultsScreen from './resultsScreen';
import BoardsScreen from './boardsScreen';
import ChampionshipScreen from './championshipScreen';
import LobbyScreen from './lobbyScreen';
import SignInScreen from './signinScreen';

interface Route {
  path: string;
  focusSel?: string;
}

function Shell(): JSX.Element {
  const { me, refreshMe, refreshGarage } = useApp();
  const [route, setRoute] = useState<Route>({ path: window.location.pathname + window.location.search });
  const [ready, setReady] = useState(false);

  // ready means: the session check has answered at least once.
  useEffect(() => { setReady(true); }, [me !== null]);

  const onRoute = useCallback((path: string, focusSel?: string) => {
    setRoute({ path, focusSel });
    // The published landing focus for each route; retried while the screen mounts.
    if (focusSel) {
      let tries = 0;
      const attempt = (): void => {
        const el = document.querySelector<HTMLElement>(focusSel);
        if (el) {
          el.focus();
        } else if (tries < 40) {
          tries += 1;
          setTimeout(attempt, 50);
        }
      };
      setTimeout(attempt, 50);
    }
  }, []);

  useNavigation(onRoute);

  // After a guest start, the session exists but me has not loaded yet.
  // Poll until me lands; the no-session redirect waits for settled checks.
  const [sessionChecks, setSessionChecks] = useState(0);
  useEffect(() => {
    if (me !== null) return;
    // The initial check plus a short poll: a first-time visitor needs 3
    // answers before the redirect fires; a fresh session lands well inside it.
    void refreshMe().then(() => setSessionChecks(c => c + 1));
    const t = setInterval(() => {
      void refreshMe().then(() => setSessionChecks(c => c + 1));
    }, 400);
    const stop = setTimeout(() => clearInterval(t), 2000);
    return () => { clearInterval(t); clearTimeout(stop); };
  }, [me, refreshMe]);

  // Session redirects, after the session is known.
  useEffect(() => {
    if (me === null || !ready) return;
    // Opening / with a session lands on the next path when the next-address
    // rule accepts it, and otherwise on /garage.
    if (window.location.pathname === '/' && route.path.startsWith('/?next=')) {
      const next = new URLSearchParams(window.location.search).get('next');
      const accepted = acceptedNext(next);
      if (accepted) {
        window.history.replaceState({}, '', accepted);
        setRoute({ path: accepted, focusSel: '[data-join], button[name="join"]' });
        return;
      }
    }
  }, [me, ready, route]);

  // Without a session, most pages redirect to the guest start — but only
  // after enough /v1/me checks have answered none, so a session that is
  // arriving after a guest start is never bounced.
  useEffect(() => {
    if (me !== null) return;
    if (sessionChecks < 3) return;
    const path = route.path.split('?')[0];
    if (path === '/' || path === '/sign-in' || path.startsWith('/sign-in/')) return;
    if (path.startsWith('/lobby/')) {
      const next = encodeURIComponent(path);
      window.history.replaceState({}, '', `/?next=${next}`);
      setRoute({ path: `/?next=${next}` });
      return;
    }
    window.history.replaceState({}, '', '/');
    setRoute({ path: '/' });
  }, [me, route, sessionChecks]);

  // Load the garage once a session exists, and again on every route change.
  useEffect(() => {
    if (me !== null) void refreshGarage();
  }, [me, route, refreshGarage]);

  const path = route.path.split('?')[0];
  const search = route.path.includes('?') ? '?' + route.path.split('?')[1] : '';

  let screen: JSX.Element;
  let showLinks = me !== null;

  if (path === '/' && me === null) {
    screen = <GuestStart />;
    showLinks = false;
  } else if (path === '/' && me !== null) {
    screen = <GarageScreen />;
  } else if (path === '/garage') {
    screen = <GarageScreen />;
  } else if (path === '/garage/dealer') {
    screen = <DealerScreen />;
  } else if (path === '/garage/coins') {
    screen = <CoinHistoryScreen />;
  } else if (path === '/race') {
    screen = <RaceScreen address={parseRaceAddress(search)} units={me?.units ?? 'kmh'} />;
  } else if (path.startsWith('/runs/')) {
    const runId = path.slice('/runs/'.length);
    screen = <ResultsScreen runId={runId} />;
  } else if (path === '/boards') {
    screen = <BoardsScreen />;
  } else if (path === '/championship') {
    screen = <ChampionshipScreen />;
  } else if (path === '/lobby/new') {
    screen = <LobbyScreen lobbyId={null} />;
  } else if (path.startsWith('/lobby/')) {
    screen = <LobbyScreen lobbyId={path.slice('/lobby/'.length)} />;
  } else if (path === '/sign-in' || path.startsWith('/sign-in/')) {
    const token = path.startsWith('/sign-in/') ? path.slice('/sign-in/'.length) : null;
    screen = <SignInScreen token={token} />;
    showLinks = false;
  } else {
    screen = <GuestStart />;
    showLinks = false;
  }
  return (
    <div className="page">
      <Header showLinks={showLinks} />
      {screen}
    </div>
  );
}

export default function App(): JSX.Element {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}
