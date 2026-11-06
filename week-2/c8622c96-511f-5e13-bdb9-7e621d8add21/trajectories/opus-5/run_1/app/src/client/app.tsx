import { useCallback, useEffect, useRef, useState } from 'react';
import { SECTIONS_BY_ROLE, type Role } from '../domain/sections.js';
import { request, RequestFailed, type Session } from './api.js';
import { navigate, useLocation } from './router.js';
import { AllEssays, ReviewQueue } from './screens/desk.js';
import { Licences, Following, Shortlist, Usage } from './screens/newsroom.js';
import { Royalties, Studio } from './screens/studio.js';
import { Rates, Statements } from './screens/treasury.js';
import { ContactSheet } from './screens/sheet.js';

function SignIn({ onSignedIn }: { onSignedIn: (session: Session) => void }): React.ReactElement {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result = await request<{ user: Session }>('/api/session', {
        method: 'POST',
        body: { email, password },
      });
      onSignedIn(result.data.user);
    } catch (failure) {
      setPassword('');
      setError(
        failure instanceof RequestFailed
          ? failure.body.message
          : 'Couldn’t reach Saltprint Desk. Nothing was changed; try again.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="signin">
      <h1>Sign in to Saltprint Desk</h1>
      <form onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor="signin-email">Email</label>
          <input
            id="signin-email"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="signin-password">Password</label>
          <input
            id="signin-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>
        {error ? <p role="alert" className="alert">{error}</p> : null}
        <button type="submit" disabled={busy}>
          Sign in
        </button>
      </form>
    </div>
  );
}

function Shell({
  session,
  onSignedOut,
  children,
}: {
  session: Session;
  onSignedOut: () => void;
  children: React.ReactNode;
}): React.ReactElement {
  const location = useLocation();
  const sections = SECTIONS_BY_ROLE[session.role];
  const signOut = async (): Promise<void> => {
    try {
      await request('/api/session', { method: 'DELETE' });
    } catch {
      /* the cookie is dropped either way */
    }
    onSignedOut();
  };
  return (
    <div className="app">
      <header className="topbar">
        <span className="product">Saltprint Desk</span>
        <span className="who">
          {session.name} · {session.newsroom ? session.newsroom.name : 'Saltprint Picture Co-operative'}
        </span>
        <nav className="sections" aria-label="Desk sections">
          {sections.map((section) => (
            <a
              key={section.path}
              href={section.path}
              aria-current={location.path === section.path ? 'page' : undefined}
              onClick={(event) => {
                event.preventDefault();
                navigate(section.path);
              }}
            >
              {section.name}
            </a>
          ))}
        </nav>
        <button type="button" onClick={() => void signOut()}>
          Sign out
        </button>
      </header>
      {children}
    </div>
  );
}

function sectionPaths(role: Role): string[] {
  return SECTIONS_BY_ROLE[role].map((section) => section.path);
}

function Screen({ session, path }: { session: Session; path: string }): React.ReactElement {
  switch (path) {
    case '/sheet':
      return <ContactSheet session={session} />;
    case '/studio':
      return <Studio session={session} />;
    case '/royalties':
      return <Royalties />;
    case '/shortlist':
      return <Shortlist session={session} />;
    case '/licences':
      return <Licences session={session} />;
    case '/following':
      return <Following />;
    case '/usage':
      return <Usage />;
    case '/review-queue':
      return <ReviewQueue />;
    case '/all-essays':
      return <AllEssays />;
    case '/rates':
      return <Rates />;
    case '/statements':
      return <Statements />;
    default:
      return <main />;
  }
}

export function App(): React.ReactElement {
  const location = useLocation();
  const [session, setSession] = useState<Session | null>(null);
  const [loaded, setLoaded] = useState(false);
  const wanted = useRef(`${window.location.pathname}${window.location.search}`);

  useEffect(() => {
    void request<{ user: Session }>('/api/me')
      .then((result) => setSession(result.data.user))
      .catch(() => setSession(null))
      .finally(() => setLoaded(true));
  }, []);

  const landOn = useCallback((person: Session) => {
    const paths = sectionPaths(person.role);
    const target = wanted.current;
    const targetPath = target.split('?')[0] ?? '/';
    if (paths.includes(targetPath)) {
      navigate(target, true);
      return;
    }
    navigate(paths[0] ?? '/', true);
  }, []);

  useEffect(() => {
    if (!session) return;
    const paths = sectionPaths(session.role);
    if (!paths.includes(location.path)) landOn(session);
  }, [session, location.path, landOn]);

  if (!loaded) return <div className="app" />;
  if (!session) {
    return (
      <SignIn
        onSignedIn={(person) => {
          setSession(person);
          landOn(person);
        }}
      />
    );
  }
  return (
    <Shell
      session={session}
      onSignedOut={() => {
        wanted.current = '/';
        setSession(null);
      }}
    >
      <Screen session={session} path={location.path} />
    </Shell>
  );
}
