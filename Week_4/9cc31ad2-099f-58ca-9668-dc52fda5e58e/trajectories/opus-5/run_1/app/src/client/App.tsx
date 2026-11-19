import { useEffect } from 'react';
import { acceptedNextPath } from '../shared/next-path.js';
import { Boards } from './pages/Boards.js';
import { Championship } from './pages/Championship.js';
import { Coins } from './pages/Coins.js';
import { Dealer } from './pages/Dealer.js';
import { Garage } from './pages/Garage.js';
import { GuestStart } from './pages/GuestStart.js';
import { Lobby, LobbyNew } from './pages/Lobby.js';
import { Race } from './pages/Race.js';
import { Results } from './pages/Results.js';
import { SignIn, SignInRedeem } from './pages/SignIn.js';
import { navigate, useLocation } from './router.js';
import { refreshMe, startStatusPolling, useMe } from './store.js';

const SIGN_IN_PATH = /^\/sign-in(\/[^/]+)?$/;

export function App() {
  const location = useLocation();
  const { loaded, me } = useMe();

  useEffect(() => {
    void refreshMe();
    startStatusPolling();
  }, []);

  // Session redirects.
  useEffect(() => {
    if (!loaded) return;
    const path = location.pathname;
    if (SIGN_IN_PATH.test(path)) return;
    if (me === null) {
      if (path === '/') return;
      const lobby = /^\/lobby\/([A-Za-z0-9_-]+)$/.exec(path);
      if (lobby && lobby[1] !== 'new') {
        navigate(`/?next=${path}`, { replace: true });
        return;
      }
      navigate('/', { replace: true });
      return;
    }
    if (path === '/') {
      const next = acceptedNextPath(new URLSearchParams(location.search).get('next'));
      navigate(next ?? '/garage', { replace: true });
    }
  }, [loaded, me, location.pathname, location.search]);

  if (!loaded) return null;

  const path = location.pathname;
  const signIn = SIGN_IN_PATH.exec(path);
  if (signIn) {
    const token = signIn[1];
    return token === undefined ? <SignIn /> : <SignInRedeem token={token.slice(1)} />;
  }
  if (me === null) return path === '/' ? <GuestStart /> : null;

  if (path === '/garage') return <Garage />;
  if (path === '/garage/dealer') return <Dealer />;
  if (path === '/garage/coins') return <Coins />;
  if (path === '/race') return <Race />;
  if (path === '/boards') return <Boards />;
  if (path === '/championship') return <Championship />;
  if (path === '/lobby/new') return <LobbyNew />;
  const run = /^\/runs\/([^/]+)$/.exec(path);
  if (run) return <Results runId={run[1]!} />;
  const lobby = /^\/lobby\/([^/]+)$/.exec(path);
  if (lobby) return <Lobby lobbyId={lobby[1]!} />;
  return null;
}
