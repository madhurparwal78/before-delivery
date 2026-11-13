import { useRef, useState, type ReactNode } from 'react';
import type { SessionUser } from '../../shared/api.js';
import { jsonRequest, sendAction } from '../api.js';
import { errorCopy, NETWORK_FAILURE, PENDING } from '../copy.js';
import { useLive } from '../live.js';
import { Field } from '../components/Field.js';

export function SignIn({ onSignedIn }: { onSignedIn: (user: SessionUser) => void }): ReactNode {
  const live = useLive();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const emailField = useRef<HTMLInputElement | null>(null);

  const submit = async (): Promise<void> => {
    live.startAction();
    live.announceStatus(PENDING.signIn);
    setPending(true);
    const outcome = await sendAction<{ user: SessionUser }>(
      jsonRequest('POST', '/api/session', { email, password }),
    );
    setPending(false);
    if (outcome.kind === 'ok') {
      onSignedIn(outcome.data.user);
      return;
    }
    if (outcome.kind === 'network') {
      live.announceError(NETWORK_FAILURE);
      return;
    }
    if (outcome.kind !== 'error') return;
    live.announceError(errorCopy({ action: 'other', code: outcome.body.error }));
  };

  return (
    <form
      className="signin"
      aria-label="Sign in"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <h1>Sign in</h1>
      <Field id="signin-email" label="Email">
        <input
          id="signin-email"
          type="email"
          ref={emailField}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </Field>
      <Field id="signin-password" label="Password">
        <input
          id="signin-password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </Field>
      <div className="dialog-buttons">
        <button type="submit" disabled={pending}>
          Sign in
        </button>
      </div>
    </form>
  );
}
