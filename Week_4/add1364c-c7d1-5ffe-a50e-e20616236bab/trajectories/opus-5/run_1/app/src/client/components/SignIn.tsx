import { useRef, useState } from 'react';
import { ApiFailure, type Person } from '../api.js';
import { call } from '../guard.js';
import { refuse, useAnnouncements } from '../live.js';
import { go, useLocation } from '../router.js';

type Answer = { person: Person; session_ends_at: string; landing: string };

export function SignIn(props: { onSignedIn: (person: Person) => void }): React.ReactElement {
  const where = useLocation();
  const next = where.query.get('next');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const usernameField = useRef<HTMLInputElement>(null);
  const announcements = useAnnouncements();

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    try {
      const answer = await call<Answer>('/api/sessions', {
        method: 'POST',
        body: next === null ? { username, password } : { username, password, next },
      });
      props.onSignedIn(answer.person);
      go(answer.landing);
    } catch (error) {
      if (error instanceof ApiFailure) {
        refuse(error.message);
        usernameField.current?.focus();
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <main className="desk-main">
      <div className="folder">
        <span className="folder-tab" aria-hidden="true">
          Sign in
        </span>
        <div className="folder-band folder-band--surface">
          <div className="slip" style={{ maxWidth: '28rem' }}>
            <h1>Sign in</h1>
            <form onSubmit={submit} noValidate>
              <div className="field">
                <label htmlFor="sign-in-username">Username</label>
                <input
                  id="sign-in-username"
                  name="username"
                  type="text"
                  autoComplete="username"
                  ref={usernameField}
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="sign-in-password">Password</label>
                <input
                  id="sign-in-password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </div>
              <button type="submit" className="solid">
                {pending ? 'Signing in' : 'Sign in'}
              </button>
            </form>
          </div>
        </div>
      </div>
      <p className="status" role="status" aria-label="Desk status">
        {announcements.status}
      </p>
      <p role="alert" aria-label="Desk alert">
        {announcements.alert}
      </p>
    </main>
  );
}
