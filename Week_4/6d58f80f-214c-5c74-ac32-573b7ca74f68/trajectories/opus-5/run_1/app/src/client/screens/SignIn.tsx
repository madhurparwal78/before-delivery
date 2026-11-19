import { useState } from 'react';
import { ApiFailure, api } from '../lib/api.js';
import { DIRECTORY_SIGN_IN_OUTAGE, SIGN_IN_REJECTED } from '../../shared/copy.js';
import type { Person } from '../../shared/types.js';

interface SignInProps {
  onSignedIn: (person: Person) => void;
}

export const SignIn = ({ onSignedIn }: SignInProps): JSX.Element => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.signIn(email, password);
      onSignedIn(result.person);
    } catch (failure) {
      if (failure instanceof ApiFailure && failure.code === 'directory_unavailable') {
        setError(DIRECTORY_SIGN_IN_OUTAGE);
      } else {
        setError(SIGN_IN_REJECTED);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="signin">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <span className="wordmark">Lintel Drive</span>
        <h1>Sign in to Lintel Drive</h1>
        <div className="field">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="text"
            aria-label="Email"
            autoComplete="username"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>
        {error === null ? null : <p className="field-error">{error}</p>}
        <button type="submit" className="primary" disabled={busy}>
          Sign in
        </button>
      </form>
    </main>
  );
};
