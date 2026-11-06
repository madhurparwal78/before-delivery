import { useState, type ReactNode } from 'react';
import { SIGN_IN_AGAIN } from '../copy';
import { api } from '../lib/api';
import { Dialog } from './Dialog';

/** Opens in place when a session meets its fixed lifetime; signing in is the only way on. */
export function SignInAgainDialog({
  email,
  onSignedIn,
}: {
  email: string;
  onSignedIn: () => void;
}): ReactNode {
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setMessage(SIGN_IN_AGAIN.pending);
    const outcome = await api('/api/session', { body: { email, password } });
    if (outcome.kind === 'ok') {
      setMessage(null);
      onSignedIn();
      return;
    }
    setMessage(SIGN_IN_AGAIN.refused);
  };

  return (
    <Dialog name="Sign in again" closable={false}>
      <form onSubmit={submit} className="stack">
        <p>{SIGN_IN_AGAIN.text}</p>
        <p className="mono">{email}</p>
        <label htmlFor="sign-in-again-password">Password</label>
        <input
          id="sign-in-again-password"
          type="password"
          value={password}
          autoComplete="current-password"
          onChange={(event) => setPassword(event.target.value)}
        />
        {message === null ? null : (
          <p className="field-error" aria-live="polite">
            {message}
          </p>
        )}
        <button type="submit" className="primary">
          Sign in again
        </button>
      </form>
    </Dialog>
  );
}
