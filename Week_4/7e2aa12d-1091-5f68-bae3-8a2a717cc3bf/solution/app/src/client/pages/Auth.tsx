import { useState, type FormEvent } from 'react';
import { UNREACHABLE_PAGE_MESSAGE } from '../../shared/messages.js';
import { Link, navigate, useLocation } from '../lib/router.js';
import { request, safeNext } from '../lib/api.js';
import type { ErrorBody } from '../lib/api.js';

/** Sign-up and sign-in: a small centred card; both go on to `next` when it is a path on this origin. */
export function AuthPage({ mode }: { mode: 'signup' | 'signin' }) {
  const location = useLocation();
  const next = safeNext(new URLSearchParams(location.split('?')[1] ?? '').get('next'));
  const query = next ? `?next=${encodeURIComponent(next)}` : '';
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  const signUp = mode === 'signup';

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const { status, body } = await request<ErrorBody | { username: string }>('POST', signUp ? '/api/signup' : '/api/session', { username, password });
      if (status === 200 || status === 201) navigate(next ?? '/');
      else setProblem((body as ErrorBody).message ?? '');
    } catch {
      setProblem(UNREACHABLE_PAGE_MESSAGE);
    }
    setBusy(false);
  };

  return (
    <main className="card centered">
      <p className="wordmark">Mullion</p>
      <h1>{signUp ? 'Create your account' : 'Sign in'}</h1>
      <form onSubmit={submit} className="stack">
        <label className="field">
          <span>Username</span>
          <input type="text" aria-label="Username" autoComplete="username" autoCapitalize="none" spellCheck={false} value={username} onChange={(event) => setUsername(event.target.value)} />
        </label>
        <label className="field">
          <span>Password</span>
          <input type="password" aria-label="Password" autoComplete={signUp ? 'new-password' : 'current-password'} value={password} onChange={(event) => setPassword(event.target.value)} />
        </label>
        <div role="alert" aria-label="Form problem" className="problem">
          {problem}
        </div>
        <button type="submit" className="primary" disabled={busy}>
          {signUp ? 'Create account' : 'Sign in'}
        </button>
      </form>
      <p className="note">
        <Link to={`${signUp ? '/signin' : '/signup'}${query}`}>{signUp ? 'Sign in' : 'Create an account'}</Link>
      </p>
    </main>
  );
}
