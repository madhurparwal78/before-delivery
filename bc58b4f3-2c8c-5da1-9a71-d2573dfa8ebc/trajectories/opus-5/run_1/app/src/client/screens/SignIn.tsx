import { useState, type ReactNode } from 'react';
import { signIn, type CurrentUser } from '../lib/api';
import { LiveStatus } from '../components/Shell';

export function SignIn({ onSignedIn }: { onSignedIn: (user: CurrentUser) => void }): ReactNode {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState('');
  const [pending, setPending] = useState(false);

  return (
    <main className="sign-in-wrap">
      <h1>Teamseat</h1>
      <p className="hint">
        Northfold Language Access dispatch and billing desk. All times Central (Chicago).
      </p>
      <form
        noValidate
        aria-label="Sign in"
        onSubmit={(event) => {
          event.preventDefault();
          setPending(true);
          setStatus('Signing in…');
          signIn(email, password)
            .then((result) => onSignedIn(result.user))
            .catch(() => setStatus('Email or password is wrong.'))
            .finally(() => setPending(false));
        }}
      >
        <div className="field">
          <label htmlFor="sign-in-email">Email</label>
          <input
            id="sign-in-email"
            type="text"
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
            role="textbox"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>
        <button type="submit" className="primary" disabled={pending}>
          Sign in
        </button>
        <LiveStatus name="Sign-in status" message={status} />
      </form>
    </main>
  );
}
