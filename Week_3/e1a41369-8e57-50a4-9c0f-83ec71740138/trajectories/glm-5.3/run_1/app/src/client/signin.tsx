import { useState } from 'react';
import { api, type Player } from './api.js';
import { navigate } from './app.js';

export function SignIn() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<'in' | 'up' | null>(null);

  const submit = async (mode: 'in' | 'up') => {
    setBusy(mode);
    setError('');
    setFieldErrors({});
    try {
      let me: Player;
      if (mode === 'in') {
        me = await api.login(username, password);
      } else {
        me = await api.signup(username, password);
      }
      void me;
      window.location.href = '/board';
    } catch (err) {
      const failure = err as { status: number; body: { error?: string; errors?: Record<string, string> } };
      if (failure.status === 401) {
        setError('Wrong username or password.');
      } else if (failure.body?.errors) {
        setFieldErrors(failure.body.errors);
      } else if (failure.body?.error === 'username_taken') {
        setError('Wrong username or password.');
      } else {
        setError('Something went wrong. Try again.');
      }
    } finally {
      setBusy(null);
    }
  };

  return (
    <main className="signin-page">
      <div className="signin-card">
        <h1 className="display">Deedfall</h1>
        <p className="body">Keep your lists. Fight the boss with friends.</p>
        <label htmlFor="signin-username">Username</label>
        <input
          id="signin-username"
          className="textbox"
          aria-label="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
        />
        {fieldErrors.username && <p className="field-error" role="alert">{fieldErrors.username}</p>}
        <label htmlFor="signin-password">Password</label>
        <input
          id="signin-password"
          className="textbox"
          type="password"
          aria-label="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
        />
        {fieldErrors.password && <p className="field-error" role="alert">{fieldErrors.password}</p>}
        <div className="signin-actions">
          <button
            className="btn btn-primary"
            type="button"
            disabled={busy !== null}
            onClick={() => void submit('in')}
          >
            {busy === 'in' ? 'Signing in...' : 'Sign in'}
          </button>
          <button
            className="btn"
            type="button"
            disabled={busy !== null}
            onClick={() => void submit('up')}
          >
            {busy === 'up' ? 'Creating...' : 'Create account'}
          </button>
        </div>
        {error && (
          <div className="alert-strip" role="alert">{error}</div>
        )}
        <p className="signin-hint">
          <button className="link-btn" type="button" onClick={() => navigate('/')}>Back to the landing page</button>
        </p>
      </div>
    </main>
  );
}
