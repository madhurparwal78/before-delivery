import { useState } from 'react';
import { api, ApiError, reasonOf } from '../lib/api.js';
import { useRouter } from '../lib/router.js';

export function SignIn(): JSX.Element {
  const { navigate } = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setPending(true);
    setError('');
    try {
      await api('POST', '/api/session', { email, password });
      navigate('/workshops');
    } catch (failure) {
      if (failure instanceof ApiError && failure.code === 'rate_limited') {
        setError(`Too many attempts — try again in ${failure.retryAfter ?? 0} seconds.`);
      } else {
        setError(reasonOf(failure));
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="column signin">
      <h1>Sign in</h1>
      <p className="muted">Facilitators sign in here. Participants join from the link they were sent.</p>
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
          <div className="row">
            <input
              id="signin-password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <button type="button" onClick={() => setShowPassword((shown) => !shown)}>
              Show password
            </button>
          </div>
        </div>
        <button type="submit" className="primary" disabled={pending}>
          {pending ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
      <div role="alert" className="status-line problem">
        {error}
      </div>
    </main>
  );
}
