import { useEffect } from 'react';
import { LiveProvider } from './live.js';
import { navigate, useLocation } from './router.js';
import { SessionProvider, useSession } from './session.js';
import { Footer, Header, NotFound } from './shell.js';
import { Builder } from './pages/builder.js';
import { Coaches } from './pages/coaches.js';
import { Dashboard } from './pages/dashboard.js';
import { Home } from './pages/home.js';
import { Inbox } from './pages/inbox.js';
import { Plans } from './pages/plans.js';
import { SignIn } from './pages/sign-in.js';
import { WorkoutPage } from './pages/workout.js';

const KNOWN_PAGE = /^\/(?:coach|plans|inbox|coaches|athletes\/[^/]+(?:\/builder)?|workouts\/[^/]+)?$/;

function Routes() {
  const { me, ready } = useSession();
  const { path, params } = useLocation();

  useEffect(() => {
    if (!ready) return;
    if (!me && path !== '/sign-in' && KNOWN_PAGE.test(path)) navigate('/sign-in', true);
    else if (me && path === '/sign-in') navigate('/', true);
    else if (me && path === '/') navigate(me.role === 'coach' ? '/coach' : `/athletes/${me.id}`, true);
  }, [ready, me, path]);

  if (!ready) return <div className="boot" aria-busy="true" />;
  if (!me) {
    if (path === '/sign-in') return <SignIn />;
    return KNOWN_PAGE.test(path) ? null : <NotFound />;
  }

  const athlete = /^\/athletes\/([^/]+)(\/builder)?$/.exec(path);
  const workout = /^\/workouts\/([^/]+)$/.exec(path);
  let page = <NotFound />;
  if (athlete?.[1]) page = athlete[2] ? <Builder key={athlete[1]} athleteId={athlete[1]} params={params} /> : <Home key={athlete[1]} athleteId={athlete[1]} params={params} />;
  else if (workout?.[1]) page = <WorkoutPage key={workout[1]} workoutId={workout[1]} />;
  else if (path === '/coach' && me.role === 'coach') page = <Dashboard />;
  else if (path === '/plans' && me.role === 'coach') page = <Plans />;
  else if (path === '/inbox' && me.role === 'coach') page = <Inbox />;
  else if (path === '/coaches' && me.role === 'athlete') page = <Coaches />;
  else if (path === '/' || path === '/sign-in') page = <div className="boot" aria-busy="true" />;

  return (
    <>
      <Header me={me} />
      <main className="site-main">{page}</main>
      <Footer me={me} />
    </>
  );
}

export function App() {
  return (
    <SessionProvider>
      <LiveProvider>
        <Routes />
      </LiveProvider>
    </SessionProvider>
  );
}
