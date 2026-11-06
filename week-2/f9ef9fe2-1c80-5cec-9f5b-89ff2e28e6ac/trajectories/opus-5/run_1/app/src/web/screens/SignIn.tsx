import { useState, type ReactNode } from 'react';
import type { User } from '../../shared/types';
import { ApiFailure, api } from '../api';

export function SignInScreen({ onSignedIn }: { onSignedIn: (user: User) => void }): ReactNode {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  const submit = (event: React.FormEvent): void => {
    event.preventDefault();
    setPending(true);
    setError('');
    void api
      .signIn(email, password)
      .then(({ user }) => onSignedIn(user))
      .catch((failure: unknown) => {
        if (failure instanceof ApiFailure && failure.body.error === 'invalid_credentials') {
          setError('Email or password is incorrect.');
        } else if (failure instanceof ApiFailure && failure.body.errors) {
          setError(Object.values(failure.body.errors)[0]);
        } else {
          setError('Email or password is incorrect.');
        }
        setPending(false);
      });
  };

  return (
    <main>
      <div className="signin">
        <h1>Pilotlight</h1>
        <p className="lede">Station time for shared kitchens.</p>
        <div role="alert" className="alert">
          {error}
        </div>
        <form onSubmit={submit}>
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
            <input
              id="signin-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
          <button
            type="submit"
            className="primary"
            aria-label="Sign in"
            disabled={pending}
            style={{ width: '100%' }}
          >
            {pending ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </main>
  );
}
