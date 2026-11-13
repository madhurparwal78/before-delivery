import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Quizmaster } from '../shared/protocol';
import './styles.css';
import { api } from './lib/api';
import { Router, matchPath, useRouter } from './lib/router';
import { measureServerOffset } from './lib/serverTime';
import { Join } from './screens/Join';
import { SignIn, SignUp } from './screens/Account';
import { Decks } from './screens/Decks';
import { DeckEditor } from './screens/DeckEditor';
import { NightResults, PastNights } from './screens/Nights';
import { Play } from './screens/Play';
import { Stage } from './screens/Stage';

type Session = { state: 'loading' } | { state: 'out' } | { state: 'in'; quizmaster: Quizmaster };

function App(): JSX.Element | null {
  const { path, navigate } = useRouter();
  const [session, setSession] = useState<Session>({ state: 'loading' });

  const hostPaths = ['/host', '/host/decks/:deckId', '/host/nights', '/host/nights/:roomId', '/stage/:roomId'];
  const needsSession = hostPaths.some((pattern) => matchPath(pattern, path) !== null);
  const isAuthPage = path === '/host/login' || path === '/host/signup';
  const hostScreen = needsSession || isAuthPage;

  useEffect(() => {
    if (!hostScreen) {
      setSession({ state: 'out' });
      return;
    }
    void api.get<{ quizmaster: Quizmaster }>('/api/auth/me').then((result) => {
      setSession(result.ok ? { state: 'in', quizmaster: result.data.quizmaster } : { state: 'out' });
    });
  }, [hostScreen]);

  useEffect(() => {
    void measureServerOffset();
  }, []);

  const signedIn = session.state === 'in';

  useEffect(() => {
    if (session.state === 'loading') return;
    if (needsSession && !signedIn) navigate('/host/login', true);
    else if (isAuthPage && signedIn) navigate('/host', true);
  }, [session.state, signedIn, needsSession, isAuthPage, navigate]);

  if (session.state === 'loading') return null;
  if (needsSession && !signedIn) return null;
  if (isAuthPage && signedIn) return null;

  const onSignedIn = (quizmaster: Quizmaster): void => setSession({ state: 'in', quizmaster });
  const onSignedOut = (): void => setSession({ state: 'out' });

  if (path === '/host/login') return <SignIn onSignedIn={onSignedIn} />;
  if (path === '/host/signup') return <SignUp onSignedIn={onSignedIn} />;
  if (path === '/host') return <Decks onSignedOut={onSignedOut} />;
  if (path === '/host/nights') return <PastNights />;

  const deckMatch = matchPath('/host/decks/:deckId', path);
  if (deckMatch) return <DeckEditor deckId={deckMatch['deckId'] as string} />;

  const nightMatch = matchPath('/host/nights/:roomId', path);
  if (nightMatch) return <NightResults roomId={nightMatch['roomId'] as string} />;

  const stageMatch = matchPath('/stage/:roomId', path);
  if (stageMatch) return <Stage roomId={stageMatch['roomId'] as string} />;

  const playMatch = matchPath('/play/:roomId', path);
  if (playMatch) return <Play roomId={playMatch['roomId'] as string} />;

  return <Join />;
}

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <Router>
        <App />
      </Router>
    </StrictMode>,
  );
}
