import { useState } from 'react';
import type { User } from '../../shared/types';
import { ApiError, request } from '../api';
import { useApp } from '../app-state';
import { Announcements } from '../components/Shell';
import { navigate } from '../router';

export function SignIn(): JSX.Element {
  const app = useApp();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (): Promise<void> => {
    setBusy(true);
    try {
      const data = await request<{ user: User }>('/api/session', {
        method: 'POST',
        body: { email, password },
      });
      app.signIn(data.user);
      navigate('/inbox');
    } catch (error) {
      if (error instanceof ApiError) app.setAlert('Email or password is incorrect.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="signin">
      <Announcements />
      <h1 className="display">Sign in to Evidence Desk</h1>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div className="field">
          <label htmlFor="signin-email">Email</label>
          <input
            id="signin-email"
            type="email"
            aria-label="Email"
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
            aria-label="Password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>
        <button type="submit" className="button accent" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  );
}
