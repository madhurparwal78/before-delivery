import { useState } from 'react';
import { NoReply, send } from '../api.ts';
import { NO_REPLY } from '../format.ts';
import type { SessionUser } from '../types.ts';

export function LoginScreen({
  onSignedIn,
}: {
  onSignedIn: (user: SessionUser) => void;
}): JSX.Element {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');

  return (
    <main className="screen" style={{ padding: 16, maxWidth: 420 }}>
      <h1>Ebbstone Marine Slackwater</h1>
      <form
        className="form-grid"
        onSubmit={(event) => {
          event.preventDefault();
          setMessage('Signing in...');
          void (async () => {
            try {
              const reply = await send<{ user: SessionUser }>('POST', '/api/session', {
                body: { email, password },
              });
              if (reply.ok) {
                setMessage('');
                onSignedIn(reply.data.user);
                return;
              }
              setMessage('Email or password is incorrect');
            } catch (cause) {
              setMessage(cause instanceof NoReply ? NO_REPLY : 'Email or password is incorrect');
            }
          })();
        }}
      >
        <label>
          Email
          <input
            type="email"
            aria-label="Email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <label>
          Password
          <input
            type="password"
            aria-label="Password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        <button type="submit" className="primary">
          Sign in
        </button>
      </form>
      <p className="announce" role="status">
        {message}
      </p>
    </main>
  );
}
