import { useState } from 'react';
import { ApiFailure, api, type Person } from '../api';
import { COPY } from '../copy';

export interface SignInProps {
  readonly onSignedIn: (person: Person) => void;
}

export function SignIn({ onSignedIn }: SignInProps): React.ReactElement {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setFailed(false);
    try {
      const result = await api.signIn(email, password);
      onSignedIn(result.person);
    } catch (error) {
      if (error instanceof ApiFailure) setFailed(true);
      else setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="signin" onSubmit={(event) => void submit(event)}>
      <h1 className="wordmark">Fluxseal</h1>
      <div className="field">
        <label htmlFor="email">Email</label>
        <input
          id="email"
          type="text"
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
      <button type="submit" disabled={busy}>
        Sign in
      </button>
      {failed ? (
        <div role="alert" className="alert">
          {COPY.signInFailed}
        </div>
      ) : null}
    </form>
  );
}
