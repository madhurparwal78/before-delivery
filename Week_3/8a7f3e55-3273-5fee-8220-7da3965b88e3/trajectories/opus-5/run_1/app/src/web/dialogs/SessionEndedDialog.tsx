import { useRef, useState, type ReactNode } from 'react';
import type { SessionUser } from '../../shared/api.js';
import { jsonRequest, sendAction } from '../api.js';
import { errorCopy, NETWORK_FAILURE, PENDING, SESSION_ENDED_LINE } from '../copy.js';
import { useLive } from '../live.js';
import { Dialog } from '../components/Dialog.js';
import { Field } from '../components/Field.js';

export interface SessionEndedDialogProps {
  email: string;
  onSignedIn: (user: SessionUser) => void;
  onSignedOut: () => void;
}

export function SessionEndedDialog({
  email,
  onSignedIn,
  onSignedOut,
}: SessionEndedDialogProps): ReactNode {
  const live = useLive();
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const passwordField = useRef<HTMLInputElement | null>(null);

  const signIn = async (): Promise<void> => {
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
    live.announceError(
      errorCopy({ action: 'other', code: outcome.body.error }),
    );
    setPassword('');
    passwordField.current?.focus();
  };

  return (
    <Dialog title="Sign in to continue" onEscape={null} focusOnOpen={() => passwordField.current}>
      <p>{SESSION_ENDED_LINE}</p>
      <p>{email}</p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void signIn();
        }}
      >
        <Field id="gate-password" label="Password">
          <input
            id="gate-password"
            type="password"
            ref={passwordField}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </Field>
        <div className="dialog-buttons">
          <button type="submit" disabled={pending}>
            Sign in and continue
          </button>
          <button type="button" onClick={onSignedOut}>
            Sign out
          </button>
        </div>
      </form>
    </Dialog>
  );
}
