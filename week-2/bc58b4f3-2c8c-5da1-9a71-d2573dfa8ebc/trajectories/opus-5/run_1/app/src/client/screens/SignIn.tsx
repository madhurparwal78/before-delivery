import { useState, type ReactNode } from 'react';
import type { SessionUser } from '../../shared/contract.js';
import { ApiFailure, api } from '../api.js';
import { Field, StatusRegion } from '../ui.js';

export function SignIn({ onSignedIn }: { onSignedIn: (user: SessionUser) => void }): ReactNode {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState('');
  const [pending, setPending] = useState(false);

  const submit = async (): Promise<void> => {
    setPending(true);
    setStatus('Signing in…');
    try {
      const result = await api.signIn(email, password);
      onSignedIn(result.user);
    } catch (error) {
      setStatus(
        error instanceof ApiFailure && error.status === 401
          ? 'Email or password is wrong.'
          : "Couldn't reach Teamseat. Try again shortly.",
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <main className="signin">
      <div className="signin__card">
        <h1>Teamseat</h1>
        <p className="signin__lede">
          Northfold Language Access dispatch and billing. All times Central (Chicago).
        </p>
        <form
          aria-label="Sign in"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <Field label="Email">
            {({ id }) => (
              <input
                id={id}
                type="email"
                autoComplete="username"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            )}
          </Field>
          <Field label="Password">
            {({ id }) => (
              <input
                id={id}
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            )}
          </Field>
          <button type="submit" className="btn btn--primary" disabled={pending}>
            Sign in
          </button>
          <StatusRegion name="Sign-in status" text={status} />
        </form>
      </div>
    </main>
  );
}
