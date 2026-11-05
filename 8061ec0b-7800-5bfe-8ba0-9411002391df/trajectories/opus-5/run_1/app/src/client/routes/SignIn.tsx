import { useEffect, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { landingFor } from '../../shared/landing';
import type { User } from '../../shared/types';
import { useSession } from '../app';
import { api, ApiFailure, NetworkFailure } from '../lib/api';
import { NETWORK_COPY, PENDING } from '../lib/copy';

export function SignIn(): ReactNode {
  const { user, loaded, setUser } = useSession();
  const location = useLocation();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  const next = new URLSearchParams(location.search).get('next');

  useEffect(() => {
    if (loaded && user !== null) navigate(landingFor(user.role, next), { replace: true });
  }, [loaded, user, next, navigate]);

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setStatus(PENDING.signIn);
    try {
      const answer = await api<{ user: User }>('/session', { method: 'POST', body: { email, password } });
      setUser(answer.user);
      navigate(landingFor(answer.user.role, next), { replace: true });
    } catch (error) {
      if (error instanceof ApiFailure && error.status === 401) setStatus('Email or password is wrong.');
      else if (error instanceof NetworkFailure) setStatus(NETWORK_COPY);
      else if (error instanceof ApiFailure) setStatus(error.message);
      setBusy(false);
    }
  };

  return (
    <main className="page">
      <h1>Keel &amp; Bell rentals</h1>
      <p>Rent-to-own instruments for partner school band and orchestra programs.</p>
      <form onSubmit={(event) => void submit(event)}>
        <div className="field">
          <label htmlFor="sign-in-email">Email</label>
          <input
            id="sign-in-email"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="sign-in-password">Password</label>
          <input
            id="sign-in-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>
        <button type="submit" className="primary" disabled={busy}>
          Sign in
        </button>
      </form>
      <p className="status" role="status" aria-label="Sign-in status">
        {status}
      </p>
    </main>
  );
}
