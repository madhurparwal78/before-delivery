import './styles.css';
import { useEffect, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { AuthSheet, openSheet } from './auth-sheet';
import { navigate, useLocation } from './router';
import { TUTORIAL_KEY, startStore, useStore, type Store } from './store';
import { HeadingScreen } from './ui';
import { Bracket, Tournaments } from './screens/Tournaments';
import { ClubScreen, Clubs } from './screens/Clubs';
import { Home } from './screens/Home';
import { Leaderboards } from './screens/Leaderboards';
import { AddFriend, Invite, Verify } from './screens/Links';
import { ModePicker, TierPicker } from './screens/Play';
import { PracticeSetup } from './screens/Practice';
import { Profile } from './screens/Profile';
import { Settings } from './screens/Settings';
import { Shop } from './screens/Shop';
import { OnlineTable } from './table/OnlineTable';
import { PracticeTable } from './table/PracticeTable';
import { TutorialTable } from './table/TutorialTable';

/** Online screens need a session: a guest goes to Home with the sheet open, and resumes here after signing up. */
function RequirePlayer({ store, path, children }: { store: Store; path: string; children: () => ReactNode }): ReactNode {
  const guest = store.auth === 'guest';
  useEffect(() => {
    if (!guest) return;
    navigate('/home', true);
    openSheet({ opener: null, then: () => navigate(path) });
  }, [guest, path]);
  return store.auth === 'player' ? children() : null;
}

function Entry({ store }: { store: Store }): ReactNode {
  const leaves = store.auth === 'player' || (store.auth === 'guest' && localStorage.getItem(TUTORIAL_KEY) !== null);
  useEffect(() => {
    if (leaves) navigate('/home', true);
  }, [leaves]);
  return store.auth === 'guest' && !leaves ? <TutorialTable store={store} /> : null;
}

function App(): ReactNode {
  const store = useStore();
  const location = useLocation();
  const path = location.split('?')[0];
  const guarded = (screen: () => ReactNode): ReactNode => <RequirePlayer store={store} path={location}>{screen}</RequirePlayer>;
  const match = (pattern: RegExp): string | null => pattern.exec(path)?.[1] ?? null;

  const screen = (): ReactNode => {
    if (path === '/') return <Entry store={store} />;
    if (path === '/home') return <Home store={store} />;
    if (path === '/play') return guarded(() => <TierPicker store={store} />);
    if (path === '/play/special') return guarded(() => <ModePicker store={store} />);
    if (path === '/practice') return <PracticeSetup store={store} />;
    if (path === '/practice/table') return <PracticeTable store={store} />;
    if (path === '/shop') return guarded(() => <Shop store={store} />);
    if (path === '/tournaments') return guarded(() => <Tournaments store={store} />);
    if (path === '/clubs') return guarded(() => <Clubs store={store} />);
    if (path === '/leaderboards') return guarded(() => <Leaderboards store={store} />);
    if (path === '/profile') return guarded(() => <Profile store={store} />);
    if (path === '/settings') return <Settings store={store} />;
    if (path === '/verify') return <Verify store={store} />;

    const table = match(/^\/table\/([^/]+)$/);
    if (table !== null) return guarded(() => <OnlineTable key={table} store={store} id={table} />);
    const bracket = match(/^\/tournaments\/([^/]+)$/);
    if (bracket !== null) return guarded(() => <Bracket key={bracket} store={store} id={bracket} />);
    const club = match(/^\/clubs\/([^/]+)$/);
    if (club !== null) return guarded(() => <ClubScreen key={club} store={store} id={club} />);
    const invite = match(/^\/invite\/([^/]+)$/);
    if (invite !== null) return <Invite store={store} token={invite} />;
    const code = match(/^\/friends\/add\/([^/]+)$/);
    if (code !== null) return guarded(() => <AddFriend store={store} code={code} />);
    return <HeadingScreen store={store} heading="Nothing on this table" />;
  };

  return (
    <>
      {screen()}
      <AuthSheet />
    </>
  );
}

startStore();
createRoot(document.getElementById('root') as HTMLElement).render(<App />);
