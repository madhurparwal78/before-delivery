import { useEffect, useState, type ReactElement } from 'react';
import type { User, Workspace } from '../shared/api';
import { ApiFailure, apiGet, apiSend } from './api';
import { Shell } from './Shell';

interface Session {
  user: User;
  workspace: Workspace;
}

function SignIn({ onSignedIn, notice }: { onSignedIn: (session: Session) => void; notice: string | null }): ReactElement {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(notice);

  return (
    <main className="centre-panel">
      <h1>Rimewire</h1>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setWorking(true);
          setError(null);
          void apiSend<Session>('POST', '/api/session', { email, password })
            .then(onSignedIn)
            .catch((failure: unknown) => {
              if (failure instanceof ApiFailure) setError(failure.message);
            })
            .finally(() => setWorking(false));
        }}
      >
        <label htmlFor="sign-in-email">Email</label>
        <input id="sign-in-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
        <label htmlFor="sign-in-password">Password</label>
        <input
          id="sign-in-password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <button type="submit" disabled={working}>
          {working ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
      <div role="status" aria-label="Notices" className="notices">
        {error}
      </div>
    </main>
  );
}

function Join({ token, onJoined }: { token: string; onJoined: (session: Session) => void }): ReactElement {
  const [invite, setInvite] = useState<{ workspace_name: string; name: string; email: string } | null>(null);
  const [missing, setMissing] = useState(false);
  const [password, setPassword] = useState('');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    void apiGet<{ workspace_name: string; name: string; email: string }>(`/api/invites/${token}`)
      .then(setInvite)
      .catch(() => setMissing(true));
  }, [token]);

  if (missing) {
    return (
      <main className="centre-panel">
        <h1>Rimewire</h1>
        <p>This invite link is not valid. Ask your operations manager for a new one.</p>
      </main>
    );
  }
  if (invite === null) return <main className="centre-panel">Loading…</main>;

  return (
    <main className="centre-panel">
      <h1>Rimewire</h1>
      <h2>{invite.workspace_name}</h2>
      <p>{invite.name}</p>
      <p>{invite.email}</p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setWorking(true);
          setError(null);
          void apiSend<Session>('POST', `/api/invites/${token}/accept`, { password })
            .then((session) => {
              setNotice(`Password set. Welcome to ${invite.workspace_name}.`);
              onJoined(session);
            })
            .catch((failure: unknown) => {
              if (failure instanceof ApiFailure) {
                setError(
                  failure.body.errors?.['password'] ??
                    (failure.code === 'not_found'
                      ? 'This invite link is not valid. Ask your operations manager for a new one.'
                      : failure.message),
                );
              }
            })
            .finally(() => setWorking(false));
        }}
      >
        <label htmlFor="join-password">New password</label>
        <input
          id="join-password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        {error !== null ? <p className="field-error">{error}</p> : null}
        <button type="submit" disabled={working}>
          {working ? 'Joining…' : 'Set password and join'}
        </button>
      </form>
      <div role="status" aria-label="Notices" className="notices">
        {notice}
      </div>
    </main>
  );
}

export function App(): ReactElement {
  const [session, setSession] = useState<Session | null>(null);
  const [resolved, setResolved] = useState(false);
  const [endedNotice, setEndedNotice] = useState<string | null>(null);
  const joinMatch = /^\/join\/([^/]+)/.exec(window.location.pathname);

  useEffect(() => {
    if (joinMatch !== null) {
      setResolved(true);
      return;
    }
    void apiGet<Session>('/api/me')
      .then(setSession)
      .catch(() => undefined)
      .finally(() => setResolved(true));
  }, [joinMatch === null]);

  if (!resolved) return <main className="centre-panel">Loading…</main>;

  if (joinMatch !== null && session === null) {
    return (
      <Join
        token={joinMatch[1] as string}
        onJoined={(joined) => {
          window.history.replaceState({}, '', '/');
          setSession(joined);
        }}
      />
    );
  }

  if (session === null) {
    return <SignIn notice={endedNotice} onSignedIn={setSession} />;
  }

  return (
    <Shell
      me={session.user}
      workspace={session.workspace}
      onSessionEnded={() => {
        setEndedNotice('Your session has ended. Sign in again.');
        setSession(null);
      }}
    />
  );
}
