import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { HostSessionResponse } from '../../shared/types';
import { OutageBanners, PinnedTitle } from '../components/Shell';
import { ApiFailure, apiPost } from '../lib/api';
import { COPY } from '../lib/format';

/** After signing in the host goes back to a same-origin host path, or to the floor. */
function safeNext(next: string | null): string {
  if (!next || next.startsWith('//')) return '/host';
  if (next !== '/host' && !next.startsWith('/host?')) return '/host';
  return next;
}

export function HostSignIn(): JSX.Element {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const ended = params.get('ended') === '1';

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await apiPost<HostSessionResponse>('/api/host/session', {
        email,
        password,
      });
      navigate(safeNext(params.get('next')), { replace: true });
    } catch (failure) {
      if (failure instanceof ApiFailure && failure.status === 401) setError(COPY.signInError);
      else if (failure instanceof ApiFailure) setError(failure.message);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="page host-sign-in">
      <OutageBanners />
      <PinnedTitle>Host sign-in</PinnedTitle>
      {ended ? (
        <div role="status" aria-label="Sign-in notice" className="notice">
          {COPY.sessionEnded}
        </div>
      ) : null}
      <form className="one-column" onSubmit={(event) => void submit(event)}>
        <label className="field">
          <span>Email</span>
          <input type="text" value={email} onChange={(event) => setEmail(event.target.value)} />
        </label>
        <label className="field">
          <span>Password</span>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        {error ? <p className="field-error">⚠ {error}</p> : null}
        <button type="submit" className="button button--accent" disabled={pending}>
          Sign in
        </button>
      </form>
    </div>
  );
}
