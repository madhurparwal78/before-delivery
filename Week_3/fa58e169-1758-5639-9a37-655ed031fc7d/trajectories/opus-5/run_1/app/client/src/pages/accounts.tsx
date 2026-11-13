import { useEffect, useState } from 'react';
import { api, ApiFailure, type Account } from '../api';
import { useApp } from '../app';
import { Shell } from '../shell';

export function SignUpScreen(): JSX.Element {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [field, setField] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    try {
      await api.post('/api/signup', { name, email, password });
      setDone(true);
    } catch (failure) {
      if (failure instanceof ApiFailure) {
        setError(failure.body.message ?? '');
        setField(failure.body.field ?? '');
      }
      setBusy(false);
    }
  };

  return (
    <Shell lead="Start a Twinrow account.">
      {done ? (
        <p>Check your email to verify your account.</p>
      ) : (
        <form className="form" onSubmit={submit}>
          <label className="field">
            <span>Name</span>
            <input
              aria-label="Name"
              value={name}
              aria-invalid={field === 'name' ? 'true' : undefined}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label className="field">
            <span>Email</span>
            <input
              aria-label="Email"
              value={email}
              aria-invalid={field === 'email' ? 'true' : undefined}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <label className="field">
            <span>Password</span>
            <input
              type="password"
              value={password}
              aria-invalid={field === 'password' ? 'true' : undefined}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <p role="alert" aria-label="Sign-up error" className="alert">
            {error}
          </p>
          <button type="submit" className="primary" disabled={busy} aria-busy={busy}>
            Create account
          </button>
        </form>
      )}
    </Shell>
  );
}

export function SignInScreen(): JSX.Element {
  const { navigate, query, setAccount } = useApp();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    try {
      await api.post('/api/session', { email, password });
      const account = await api.get<Account>('/api/me');
      setAccount(account);
      const next = query.get('next');
      navigate(next && next.startsWith('/') ? next : '/', true);
    } catch (failure) {
      if (failure instanceof ApiFailure) setError(failure.body.message ?? '');
      setBusy(false);
    }
  };

  return (
    <Shell lead="Sign in to Twinrow.">
      <form className="form" onSubmit={submit}>
        <label className="field">
          <span>Email</span>
          <input aria-label="Email" value={email} onChange={(event) => setEmail(event.target.value)} />
        </label>
        <label className="field">
          <span>Password</span>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        <p role="alert" aria-label="Sign-in error" className="alert">
          {error}
        </p>
        <button type="submit" className="primary" disabled={busy} aria-busy={busy}>
          Sign in
        </button>
      </form>
    </Shell>
  );
}

export function VerifyScreen(): JSX.Element {
  const { query, navigate } = useApp();
  const [state, setState] = useState<'working' | 'verified' | 'expired'>('working');

  useEffect(() => {
    void (async () => {
      try {
        await api.post('/api/verify', { token: query.get('token') ?? '' });
        setState('verified');
      } catch {
        setState('expired');
      }
    })();
  }, [query]);

  return (
    <Shell lead="Verify your email.">
      {state === 'working' ? <p>Loading...</p> : null}
      {state === 'verified' ? (
        <p>
          Your email is verified.{' '}
          <a
            href="/signin"
            onClick={(event) => {
              event.preventDefault();
              navigate('/signin');
            }}
          >
            Sign in
          </a>
        </p>
      ) : null}
      {state === 'expired' ? <p>This link has expired. Sign up again to get a new one.</p> : null}
    </Shell>
  );
}
