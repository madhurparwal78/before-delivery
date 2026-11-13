import { useRef, useState } from 'react';
import type { User } from '../../../shared/api.js';
import { ApiFailure, api } from '../api.js';

const WRONG_CREDENTIALS = "That email and passcode don't match.";

export function SignIn({ onSignedIn }: { onSignedIn: (user: User) => void }): JSX.Element {
  const [email, setEmail] = useState('');
  const [passcode, setPasscode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const emailField = useRef<HTMLInputElement | null>(null);

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const answer = await api.signIn(email, passcode);
      onSignedIn(answer.user);
    } catch (failure) {
      setError(failure instanceof ApiFailure ? failure.body.message : WRONG_CREDENTIALS);
      setPending(false);
      emailField.current?.focus();
    }
  }

  return (
    <main className="centred sign-in">
      <h1 className="display">Quirewell Stand Desk</h1>
      <form onSubmit={submit} className="card">
        {error === null ? null : (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        <label>
          <span>Email</span>
          <input
            type="email"
            name="email"
            aria-label="Email"
            autoComplete="username"
            value={email}
            ref={emailField}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <label>
          <span>Passcode</span>
          <input
            type="password"
            name="passcode"
            aria-label="Passcode"
            autoComplete="current-password"
            value={passcode}
            onChange={(event) => setPasscode(event.target.value)}
          />
        </label>
        <button type="submit" className="primary">
          {pending ? 'Signing in' : 'Sign in'}
        </button>
      </form>
    </main>
  );
}
