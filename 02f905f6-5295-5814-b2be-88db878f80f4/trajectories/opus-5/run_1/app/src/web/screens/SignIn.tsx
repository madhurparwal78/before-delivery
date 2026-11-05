import { useState } from 'react';
import type { User } from '../../shared/types';
import { ApiFailure, api } from '../api';

export function SignInScreen({
  onSignedIn,
}: {
  onSignedIn: (user: User) => void;
}): JSX.Element {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);

  const submit = async (): Promise<void> => {
    setSending(true);
    setError('');
    try {
      const result = await api.post<{ user: User }>('/api/session', { email, password });
      onSignedIn(result.user);
    } catch (failure) {
      setError(
        failure instanceof ApiFailure && failure.status === 401
          ? 'Email or password is wrong.'
          : 'The studio server is unreachable.',
      );
    } finally {
      setSending(false);
    }
  };

  return (
    <main>
      <form
        className="signin"
        aria-label="Sign in"
        onSubmit={(event) => {
          event.preventDefault();
          if (!sending) void submit();
        }}
      >
        <h1>Shelfmark</h1>
        <p>Brickfield Lane Clayhouse firing desk</p>
        <div className="field">
          <label htmlFor="signin-email">Email</label>
          <input
            id="signin-email"
            type="text"
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
        <button type="submit" className="primary" aria-disabled={sending}>
          Sign in
        </button>
        <p role="alert" className="live bad">
          {error}
        </p>
      </form>
    </main>
  );
}
