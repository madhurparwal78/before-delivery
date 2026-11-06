import { useState } from 'react';
import { SessionUser } from '../../shared/api';
import { ApiFailure, api } from '../lib/api';
import { FieldError } from '../components/shell';

interface SignInProps {
  onSignedIn: (user: SessionUser) => void;
}

export function SignInScreen({ onSignedIn }: SignInProps): JSX.Element {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setPending(true);
    setFailure(null);
    try {
      const result = await api<{ user: SessionUser }>('/api/session', {
        method: 'POST',
        body: { email, password },
      });
      onSignedIn(result.user);
    } catch (problem) {
      setFailure(problem instanceof ApiFailure ? 'Email or password is wrong.' : 'Email or password is wrong.');
    } finally {
      setPending(false);
    }
  };

  return (
    <main className="centre-screen">
      <form className="paper-card sign-in-card" onSubmit={submit}>
        <h1 className="product-mark large">Furrowbook</h1>
        <p className="muted">Tilth &amp; Tally field ledger</p>
        <label className="field">
          <span>Email</span>
          <input
            type="email"
            name="email"
            autoComplete="username"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <label className="field">
          <span>Password</span>
          <input
            type="password"
            name="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        <button type="submit" className="primary-button" disabled={pending}>
          {pending ? 'Signing in…' : 'Sign in'}
        </button>
        <FieldError text={failure} />
      </form>
    </main>
  );
}
