import type { JSX } from 'preact';
import { useLayoutEffect, useRef } from 'preact/hooks';
import { TopBar } from './components/TopBar.js';
import { usePath } from './lib/router.js';
import { userStore } from './lib/user.js';
import { Follow, SignIn, SignUp } from './pages/auth.js';
import { CareerPage, InvitationPage, MatchPage, TeamPage, TournamentPage } from './pages/detail.js';
import { NewMatch, NewTeam, NewTournament } from './pages/forms.js';
import { Landing } from './pages/Landing.js';
import { MatchesPage, PlayersPage, TeamsPage, TournamentsPage } from './pages/lists.js';
import { NotFound, SignInRequired } from './pages/NotFound.js';
import { ScorePage } from './pages/Score.js';
import { ScorecardPage, ViewerScorecardPage } from './pages/Scorecard.js';
import { ViewerPage } from './pages/Viewer.js';

interface Route { pattern: RegExp; private: boolean; render: (params: string[]) => JSX.Element }

const at = (params: string[]): string => params[0] ?? '';

const ROUTES: Route[] = [
  { pattern: /^\/$/, private: false, render: () => <Landing /> },
  { pattern: /^\/signin$/, private: false, render: () => <SignIn /> },
  { pattern: /^\/signup$/, private: false, render: () => <SignUp /> },
  { pattern: /^\/follow$/, private: false, render: () => <Follow /> },
  { pattern: /^\/live\/([^/]+)$/, private: false, render: (p) => <ViewerPage key={at(p)} code={at(p)} /> },
  { pattern: /^\/live\/([^/]+)\/scorecard$/, private: false, render: (p) => <ViewerScorecardPage key={at(p)} code={at(p)} /> },
  { pattern: /^\/matches$/, private: true, render: () => <MatchesPage /> },
  { pattern: /^\/matches\/new$/, private: true, render: () => <NewMatch /> },
  { pattern: /^\/matches\/([^/]+)$/, private: true, render: (p) => <MatchPage key={at(p)} id={at(p)} /> },
  { pattern: /^\/matches\/([^/]+)\/score$/, private: true, render: (p) => <ScorePage key={at(p)} id={at(p)} /> },
  { pattern: /^\/matches\/([^/]+)\/scorecard$/, private: true, render: (p) => <ScorecardPage key={at(p)} id={at(p)} /> },
  { pattern: /^\/teams$/, private: true, render: () => <TeamsPage /> },
  { pattern: /^\/teams\/new$/, private: true, render: () => <NewTeam /> },
  { pattern: /^\/teams\/([^/]+)$/, private: true, render: (p) => <TeamPage key={at(p)} id={at(p)} /> },
  { pattern: /^\/tournaments$/, private: true, render: () => <TournamentsPage /> },
  { pattern: /^\/tournaments\/new$/, private: true, render: () => <NewTournament /> },
  { pattern: /^\/tournaments\/([^/]+)$/, private: true, render: (p) => <TournamentPage key={at(p)} id={at(p)} /> },
  { pattern: /^\/players$/, private: true, render: () => <PlayersPage /> },
  { pattern: /^\/players\/([^/]+)$/, private: true, render: (p) => <CareerPage key={at(p)} id={at(p)} /> },
  { pattern: /^\/invitations\/([^/]+)$/, private: true, render: (p) => <InvitationPage key={at(p)} token={at(p)} /> },
];

export const App = (): JSX.Element => {
  const path = usePath();
  const user = userStore.use();
  const main = useRef<HTMLElement>(null);
  const first = useRef(true);

  useLayoutEffect(() => {
    if (first.current) first.current = false; else main.current?.focus({ preventScroll: true });
  }, [path]);

  let page = <NotFound />;
  for (const route of ROUTES) {
    const match = route.pattern.exec(path);
    if (match) {
      page = route.private && !user ? <SignInRequired path={path} /> : route.render(match.slice(1));
      break;
    }
  }
  return (
    <>
      <TopBar path={path} landing={path === '/'} />
      <main id="main" ref={main} tabIndex={-1} class={path === '/' ? 'main-landing' : ''}>{page}</main>
    </>
  );
};
