import { useEffect, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { api } from './api.js';
import { Chrome } from './components/Chrome.js';
import { Auth } from './pages/Auth.js';
import { BracketPage } from './pages/Bracket.js';
import { DisputesPage } from './pages/Disputes.js';
import { HistoryPage } from './pages/History.js';
import { Landing } from './pages/Landing.js';
import { MePage } from './pages/Me.js';
import { NotFound } from './pages/NotFound.js';
import { SetupPage } from './pages/Setup.js';
import { SharePage } from './pages/Share.js';
import { CreateTournament, TournamentList } from './pages/Tournaments.js';
import { navigate, Router, useLocation } from './router.js';
import { RequireUser, SessionProvider } from './session.js';
import type { TournamentView } from '../shared/api.js';
import { isOrganizerRole, isStarted } from '../shared/rules.js';
import './styles.css';

// /t/<id> sends organizers to setup before start and bracket after; everyone else to the bracket.
function TournamentRedirect({ id }: { id: string }): ReactNode {
  useEffect(() => {
    api.get<{ tournament: TournamentView }>(`/api/tournaments/${id}`).then(({ tournament }) => {
      const organizer = isOrganizerRole(tournament.my_role);
      const started = isStarted(tournament.state);
      navigate(`/t/${id}/${organizer && !started ? 'setup' : 'bracket'}`, true);
    }, () => navigate(`/t/${id}/bracket`, true));
  }, [id]);
  return <Chrome><p className="loading">Loading...</p></Chrome>;
}

function Routes(): ReactNode {
  const { path } = useLocation();
  const parts = path.split('/').filter(Boolean);
  const [head, a, b] = parts;
  if (path === '/') return <Landing />;
  if (path === '/signin') return <Auth mode="signin" />;
  if (path === '/signup') return <Auth mode="signup" />;
  if (head === 's' && a && parts.length === 2) return <SharePage code={a} />;
  if (head === 'u' && a && parts.length === 2) return <RequireUser>{() => <HistoryPage username={a} />}</RequireUser>;
  if (head === 't' && parts.length === 1) return <RequireUser>{() => <TournamentList />}</RequireUser>;
  if (head === 't' && a === 'new' && parts.length === 2) return <RequireUser>{() => <CreateTournament />}</RequireUser>;
  if (head === 't' && a && parts.length === 2) return <RequireUser>{() => <TournamentRedirect id={a} />}</RequireUser>;
  if (head === 't' && a && b && parts.length === 3) {
    if (b === 'setup') return <RequireUser>{() => <SetupPage id={a} />}</RequireUser>;
    if (b === 'bracket') return <RequireUser>{() => <BracketPage id={a} />}</RequireUser>;
    if (b === 'disputes') return <RequireUser>{() => <DisputesPage id={a} />}</RequireUser>;
    if (b === 'me') return <RequireUser>{() => <MePage id={a} />}</RequireUser>;
  }
  return <NotFound />;
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <Router>
    <SessionProvider>
      <Routes />
    </SessionProvider>
  </Router>,
);
