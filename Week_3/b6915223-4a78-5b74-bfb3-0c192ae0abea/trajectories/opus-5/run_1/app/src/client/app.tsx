import { useEffect } from 'react';
import { formatLeagueDeadline } from '../shared/leagueTime.ts';
import { api } from './api.ts';
import { Link, navigate, useLocation } from './router.tsx';
import { useApp } from './state.tsx';
import { NoticesButton } from './components/Notices.tsx';
import { SignIn } from './screens/SignIn.tsx';
import { Team } from './screens/Team.tsx';
import { Transfers } from './screens/Transfers.tsx';
import { Leagues } from './screens/Leagues.tsx';
import { League } from './screens/League.tsx';
import { MemberHistory } from './screens/MemberHistory.tsx';
import { History } from './screens/History.tsx';
import { Operator } from './screens/Operator.tsx';

export const gameweekStatusLine = (gameweek: {
  number: number;
  status: string;
  deadline: string | null;
}): string => {
  if (gameweek.status === 'open') {
    return gameweek.deadline === null
      ? `Gameweek ${gameweek.number} · Open · Deadline not set`
      : `Gameweek ${gameweek.number} · Open · Deadline ${formatLeagueDeadline(gameweek.deadline)}`;
  }
  const label = gameweek.status.charAt(0).toUpperCase() + gameweek.status.slice(1);
  return `Gameweek ${gameweek.number} · ${label}`;
};

const Header = () => {
  const { me, gameweek, setMe } = useApp();
  return (
    <header className="app-header">
      <Link to={me?.role === 'operator' ? '/operator' : '/team'} className="wordmark">
        Elevens
      </Link>
      <nav aria-label="Main">
        <Link to="/team">Pick Team</Link>
        <Link to="/transfers">Transfers</Link>
        <Link to="/leagues">Leagues</Link>
        <Link to="/history">History</Link>
        {me?.role === 'operator' && <Link to="/operator">Operator</Link>}
      </nav>
      <p role="status" aria-label="Gameweek status" className="gameweek-status">
        {gameweek === null ? '' : gameweekStatusLine(gameweek)}
      </p>
      <NoticesButton />
      <button
        type="button"
        className="sign-out"
        onClick={() => {
          void api.signOut().then(() => {
            setMe(null);
            navigate('/signin');
          });
        }}
      >
        Sign out
      </button>
    </header>
  );
};

const Screen = ({ pathname }: { pathname: string }) => {
  const members = /^\/leagues\/([^/]+)\/members\/([^/]+)$/.exec(pathname);
  if (members !== null) {
    return <MemberHistory leagueId={members[1]!} managerId={members[2]!} />;
  }
  const league = /^\/leagues\/([^/]+)$/.exec(pathname);
  if (league !== null) return <League leagueId={league[1]!} />;
  switch (pathname) {
    case '/transfers':
      return <Transfers />;
    case '/leagues':
      return <Leagues />;
    case '/history':
      return <History />;
    case '/operator':
      return <Operator />;
    default:
      return <Team />;
  }
};

export const App = () => {
  const { ready, me, hasSquad, squadLoaded } = useApp();
  const location = useLocation();

  useEffect(() => {
    if (!ready) return;
    if (me === null) {
      if (location.pathname !== '/signin') navigate('/signin', { replace: true });
      return;
    }
    if (location.pathname === '/signin' || location.pathname === '/') {
      if (me.role === 'operator') {
        navigate('/operator', { replace: true });
        return;
      }
      if (squadLoaded) {
        navigate(hasSquad ? '/team' : '/transfers', { replace: true });
      }
      return;
    }
    if (me.role === 'manager' && location.pathname === '/team' && squadLoaded && !hasSquad) {
      navigate('/transfers', { replace: true });
    }
  }, [ready, me, hasSquad, squadLoaded, location.pathname]);

  if (!ready) return <main className="loading">Loading Elevens…</main>;
  if (me === null) return <SignIn />;

  return (
    <>
      <Header />
      <main className="app-main">
        <Screen pathname={location.pathname} />
      </main>
    </>
  );
};
