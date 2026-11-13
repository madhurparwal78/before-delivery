import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { COPY } from '../shared/copy';
import type { SessionBody } from '../shared/types';
import { forgetSession, loadSession, onSessionEnded, storeResume, storeSignInNotice } from './lib/api';
import { navigate, useLocation } from './lib/router';
import { PublicPage } from './pages/Public';
import { SignInPage } from './pages/SignIn';
import { WorkspacePage } from './pages/Workspace';
import { TeamPage } from './pages/Team';
import { WidgetPage } from './pages/Widget';
import { NotFoundPage } from './pages/NotFound';

interface GameData {
  slug: string;
  name: string;
}

function App({ game }: { game: GameData }): React.ReactElement {
  const location = useLocation();
  const [session, setSession] = useState<SessionBody | null>(null);
  const [checked, setChecked] = useState(false);
  const draftRef = useRef('');

  const staffPage = location.pathname.startsWith('/inbox') || location.pathname === '/team';

  useEffect(() => {
    onSessionEnded(() => {
      storeResume({ url: `${window.location.pathname}${window.location.search}`, reply: draftRef.current });
      storeSignInNotice(COPY.sessionEnded);
      forgetSession();
      setSession(null);
      navigate('/signin');
    });
  }, []);

  useEffect(() => {
    if (!staffPage) {
      setChecked(true);
      return;
    }
    let active = true;
    void (async () => {
      const loaded = await loadSession();
      if (!active) return;
      setSession(loaded);
      setChecked(true);
      if (loaded === null) navigate('/signin');
    })();
    return () => {
      active = false;
    };
  }, [staffPage, location.pathname]);

  if (location.pathname === '/') return <PublicPage />;
  if (location.pathname === '/signin') return <SignInPage />;
  if (location.pathname.startsWith('/widget/')) {
    return <WidgetPage slug={game.slug} gameName={game.name} />;
  }
  if (staffPage) {
    if (!checked || session === null) return <div className="workspace loading" />;
    if (location.pathname === '/team') return <TeamPage />;
    return <WorkspacePage session={session} draftRef={draftRef} />;
  }
  return <NotFoundPage />;
}

const root = document.getElementById('root');
if (root !== null) {
  const game: GameData = {
    slug: root.dataset.gameSlug ?? '',
    name: root.dataset.gameName ?? '',
  };
  createRoot(root).render(<App game={game} />);
}
