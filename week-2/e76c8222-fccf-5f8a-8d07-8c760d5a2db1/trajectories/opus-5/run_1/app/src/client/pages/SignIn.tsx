import { ReactElement, useState } from 'react';
import { api } from '../api';
import { LiveRegion } from '../components/LiveRegion';
import { SessionUser } from '../types';

export function SignIn({ onSignedIn }: { onSignedIn: (user: SessionUser) => void }): ReactElement {
  const [email, setEmail] = useState('');
  const [passcode, setPasscode] = useState('');
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState(false);

  const submit = async (): Promise<void> => {
    setPending(true);
    setMessage('Signing in…');
    try {
      const { user } = await api.signIn(email, passcode);
      onSignedIn(user);
    } catch {
      setMessage('That email and passcode do not match.');
    } finally {
      setPending(false);
    }
  };

  return (
    <main className="column">
      <h1>Sign in</h1>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div className="field">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            name="email"
            type="text"
            autoComplete="username"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="passcode">Passcode</label>
          <input
            id="passcode"
            name="passcode"
            type="text"
            autoComplete="off"
            value={passcode}
            onChange={(event) => setPasscode(event.target.value)}
          />
        </div>
        <button type="submit" disabled={pending}>
          Sign in
        </button>
      </form>
      <LiveRegion label="Sign-in status" message={message} />
    </main>
  );
}
