import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import type { SessionUser } from '../../shared/api';
import { apiJson, errorMessage } from './api';
import { useAuth } from './App';
import { COPY } from './hooks';

export function SignInScreen(): ReactNode {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const statusRef = useRef<HTMLParagraphElement>(null);

  const onSubmit = async (ev: React.FormEvent): Promise<void> => {
    ev.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    const res = await apiJson<{ user?: SessionUser }>('POST', '/api/session', { email, password });
    setPending(false);
    if (res.status !== 200 || !res.body.user) {
      setError(errorMessage(res.body, 'Sign in failed.'));
      return;
    }
    await refresh();
    navigate('/catalog', { replace: true });
  };

  return (
    <main className="signin-main" data-motion={window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'reduced' : 'full'}>
      <h1 className="wordmark signin-wordmark">Quarrystone Strata</h1>
      <form className="signin-form" onSubmit={(ev) => void onSubmit(ev)}>
        <label className="field">
          <span className="field-label">Email</span>
          <input
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-label="Email"
            className="input"
          />
        </label>
        <label className="field">
          <span className="field-label">Password</span>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-label="Password"
            className="input"
          />
        </label>
        <button type="submit" className="btn primary" disabled={pending}>
          Sign in
        </button>
      </form>
      <p ref={statusRef} role="status" aria-label="Sign-in status" aria-live="polite" className="status signin-status">
        {pending ? COPY.signingIn : ''}
      </p>
      {error && (
        <div role="alert" className="alert">
          {error}
        </div>
      )}
    </main>
  );
}
