import { render, type JSX } from 'preact';
import { useCallback, useEffect, useMemo, useState } from 'preact/hooks';
import { api, DeskError } from './api';
import type { User } from './types';
import { Feedback } from './ui';
import { Leaderboard } from './pages/leaderboard';
import { Gallery } from './pages/gallery';
import { SignIn, SignUp } from './pages/auth';
import { StudioEntries } from './pages/studio';
import { EntryPage } from './pages/entry';
import { JuryHome, Conflicts } from './pages/jury';
import { BallotPage } from './pages/ballot';
import { DirectorHome, DirectorProgram } from './pages/director';
import { DirectorCategory } from './pages/directorCategory';
import { DirectorRound } from './pages/directorRound';
import { DirectorAudit } from './pages/directorAudit';
import { ShellContext, Countdown, type ShellState } from './shell';

export interface PageProps {
  user: User | null;
  path: string;
  params: Record<string, string>;
  navigate: (to: string) => void;
  reloadUser: () => Promise<void>;
}

interface RouteEntry {
  pattern: string;
  role: 'public' | 'studio' | 'juror' | 'director';
  page: (props: PageProps) => JSX.Element;
}

const ROUTES: RouteEntry[] = [
  { pattern: '/', role: 'public', page: Leaderboard },
  { pattern: '/gallery', role: 'public', page: Gallery },
  { pattern: '/signin', role: 'public', page: SignIn },
  { pattern: '/signup', role: 'public', page: SignUp },
  { pattern: '/studio', role: 'studio', page: StudioEntries },
  { pattern: '/studio/entries/new', role: 'studio', page: EntryPage },
  { pattern: '/studio/entries/:id', role: 'studio', page: EntryPage },
  { pattern: '/jury', role: 'juror', page: JuryHome },
  { pattern: '/jury/conflicts', role: 'juror', page: Conflicts },
  { pattern: '/jury/rounds/:id', role: 'juror', page: BallotPage },
  { pattern: '/director', role: 'director', page: DirectorHome },
  { pattern: '/director/programs/:id', role: 'director', page: DirectorProgram },
  { pattern: '/director/categories/:id', role: 'director', page: DirectorCategory },
  { pattern: '/director/rounds/:id', role: 'director', page: DirectorRound },
  { pattern: '/director/audit', role: 'director', page: DirectorAudit },
];

function matchRoute(path: string): { entry: RouteEntry; params: Record<string, string> } | null {
  const segments = path.split('/').filter((piece) => piece !== '');
  for (const entry of ROUTES) {
    const pattern = entry.pattern.split('/').filter((piece) => piece !== '');
    if (pattern.length !== segments.length) continue;
    const params: Record<string, string> = {};
    let ok = true;
    for (let index = 0; index < pattern.length; index += 1) {
      if (pattern[index].startsWith(':')) params[pattern[index].slice(1)] = segments[index];
      else if (pattern[index] !== segments[index]) {
        ok = false;
        break;
      }
    }
    if (ok) return { entry, params };
  }
  return null;
}

const NAV = [
  { href: '/', label: 'Leaderboard' },
  { href: '/gallery', label: 'Gallery' },
  { href: '/studio', label: 'Studio' },
  { href: '/jury', label: 'Jury' },
  { href: '/director', label: 'Director' },
];

function App(): JSX.Element {
  const [path, setPath] = useState(window.location.pathname);
  const [user, setUser] = useState<User | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [note, setNote] = useState('');
  const [problem, setProblem] = useState('');
  const [shell, setShell] = useState<ShellState>({ name: 'Cutline Jury Desk', target: null, fallback: null });

  const reloadUser = useCallback(async () => {
    try {
      const body = await api<{ user: User }>('GET', '/api/session');
      setUser(body.user);
    } catch {
      setUser(null);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void reloadUser();
  }, [reloadUser]);

  useEffect(() => {
    const onPop = (): void => setPath(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const navigate = useCallback((to: string) => {
    if (to === window.location.pathname + window.location.search) return;
    window.history.pushState({}, '', to);
    setPath(window.location.pathname);
    setNote('');
    setProblem('');
    window.scrollTo(0, 0);
  }, []);

  const feedback = useMemo(
    () => ({
      say: (message: string) => {
        setProblem('');
        setNote(message);
      },
      warn: (message: string) => {
        setNote('');
        setProblem(message);
      },
      clear: () => {
        setNote('');
        setProblem('');
      },
    }),
    [],
  );

  const found = matchRoute(path);
  const entry = found?.entry;

  useEffect(() => {
    if (!loaded || entry === undefined) return;
    if (entry.role !== 'public' && user === null) {
      window.history.replaceState({}, '', `/signin?next=${encodeURIComponent(path)}`);
      setPath('/signin');
    }
  }, [loaded, entry, user, path]);

  const signOut = async (): Promise<void> => {
    await api('DELETE', '/api/session');
    setUser(null);
    navigate('/');
  };

  let body: JSX.Element;
  if (!loaded || entry === undefined) {
    body = <p>{entry === undefined ? "We couldn't find that." : 'Loading…'}</p>;
  } else if (entry.role !== 'public' && user === null) {
    body = <p>Sign in to continue.</p>;
  } else if (entry.role !== 'public' && user !== null && user.role !== entry.role) {
    body = <p class="disqualified">Only the program director can do that.</p>;
  } else {
    const Page = entry.page;
    body = (
      <Page
        user={user}
        path={path}
        params={found?.params ?? {}}
        navigate={navigate}
        reloadUser={reloadUser}
      />
    );
  }

  return (
    <Feedback.Provider value={feedback}>
      <ShellContext.Provider value={setShell}>
        <a class="skip-link" href="#content">
          Skip to content
        </a>
        <header class="band" role="banner">
          <span class="band-name">{shell.name}</span>
          {shell.target === null ? (
            shell.fallback === null ? null : (
              <span class="band-timer">{shell.fallback}</span>
            )
          ) : (
            <Countdown target={shell.target} />
          )}
        </header>
        <nav aria-label="Primary">
          {NAV.map((item) => (
            <a
              key={item.href}
              href={item.href}
              aria-current={path === item.href ? 'page' : undefined}
              onClick={(event) => {
                event.preventDefault();
                navigate(item.href);
              }}
            >
              {item.label}
            </a>
          ))}
          {user === null ? (
            <a
              href="/signin"
              onClick={(event) => {
                event.preventDefault();
                navigate('/signin');
              }}
            >
              Sign in
            </a>
          ) : (
            <button type="button" onClick={() => void signOut()}>
              Sign out
            </button>
          )}
        </nav>
        <div class="live">
          <div role="status" aria-label="Desk status" aria-live="polite">
            {note}
          </div>
          <div role="alert" aria-label="Desk error">
            {problem}
          </div>
        </div>
        <main id="content" tabIndex={-1}>
          {body}
        </main>
      </ShellContext.Provider>
    </Feedback.Provider>
  );
}

export { DeskError };

render(<App />, document.getElementById('app') as HTMLElement);
