import { useState, type FormEvent, type ReactNode } from 'react';

import { ApiError, NetworkError } from '../api.js';
import { UNREACHABLE, useApp } from '../app-state.js';

export function SignInScreen(): ReactNode {
  const app = useApp();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    app.pending('Signing in…');
    try {
      await app.signIn(email, password);
    } catch (error) {
      if (error instanceof NetworkError) {
        app.report(UNREACHABLE);
      } else if (error instanceof ApiError) {
        app.report('Email or password is wrong.');
      } else {
        throw error;
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="signin-wrap">
      <form className="signin-card" aria-label="Sign in" onSubmit={(event) => void submit(event)}>
        <h1>Sign in to Passboard</h1>
        <div className="field">
          <label htmlFor="signin-email">Email</label>
          <input
            id="signin-email"
            type="text"
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
        <button type="submit" className="primary" disabled={busy} aria-busy={busy}>
          Sign in
        </button>
      </form>
    </div>
  );
}
