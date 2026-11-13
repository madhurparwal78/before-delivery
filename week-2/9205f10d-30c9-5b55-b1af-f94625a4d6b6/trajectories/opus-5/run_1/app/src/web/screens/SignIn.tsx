import { useState, type ReactNode } from 'react';
import { api, RequestFailed, UNREACHABLE_COPY } from '../api.js';
import type { SessionUser } from '../../shared/types.js';

export function SignIn({ onSignedIn }: { onSignedIn: (user: SessionUser) => void }): ReactNode {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  const submit = async (): Promise<void> => {
    setPending(true);
    try {
      const result = await api.signIn(email, password);
      onSignedIn(result.user);
    } catch (failure) {
      if (failure instanceof RequestFailed) {
        setError(failure.code === 'unreachable' ? UNREACHABLE_COPY : 'Email or password is incorrect.');
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <main className="signin-page">
      <div className="signin-card">
        <span className="wordmark">Crosshand Relay</span>
        <form
          aria-label="Sign in"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <h1 style={{ fontSize: 'var(--text-2xl)', marginBottom: 'var(--gap-lg)' }}>
            Sign in to Crosshand Relay
          </h1>
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
          <button type="submit" disabled={pending} style={{ width: '100%' }}>
            Sign in
          </button>
          <p className="live alert" role="alert" aria-label="Sign-in error">
            {error}
          </p>
        </form>
      </div>
    </main>
  );
}
