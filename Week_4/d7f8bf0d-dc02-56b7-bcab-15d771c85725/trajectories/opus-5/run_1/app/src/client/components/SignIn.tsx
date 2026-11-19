import { useEffect, useRef, useState } from 'react';
import { copy } from '../lib/copy.js';
import { useStore } from '../store.js';
import { Wordmark } from './Art.js';

export function SignIn(): JSX.Element {
  const { actions, status } = useStore();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const first = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    first.current?.focus();
  }, []);

  return (
    <div className="modal-centre" style={{ background: 'transparent' }}>
      <form
        className="sign-in-card"
        data-testid="sign-in-form"
        onSubmit={(event) => {
          event.preventDefault();
          setBusy(true);
          void actions.signIn(email, password).finally(() => setBusy(false));
        }}
      >
        <Wordmark />
        <h2>Sign in</h2>
        <label className="field">
          <span>Email</span>
          <input
            ref={first}
            type="email"
            autoComplete="username"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <label className="field">
          <span>Password</span>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        <button className="lipped" type="submit" disabled={busy}>
          Sign in
        </button>
        {status === copy.signInFailed ? <p role="alert">{copy.signInFailed}</p> : null}
      </form>
    </div>
  );
}

export function SignInAgain(): JSX.Element {
  const { actions, me, signInAgainFailed } = useStore();
  const [password, setPassword] = useState('');
  const field = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    field.current?.focus();
  }, []);

  return (
    <div className="modal-centre">
      <form
        role="dialog"
        aria-modal="true"
        aria-label="Sign in again"
        data-testid="sign-in-again"
        className="modal-card"
        onSubmit={(event) => {
          event.preventDefault();
          void actions.signInAgainWith(password);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Tab') {
            const focusable = event.currentTarget.querySelectorAll<HTMLElement>(
              'input, button',
            );
            const list = [...focusable];
            const index = list.indexOf(document.activeElement as HTMLElement);
            const next = event.shiftKey ? index - 1 : index + 1;
            if (next < 0 || next >= list.length) {
              event.preventDefault();
              list[event.shiftKey ? list.length - 1 : 0]?.focus();
            }
          }
        }}
      >
        <h2>Sign in again</h2>
        <label className="field">
          <span>Email</span>
          <input type="email" value={me?.user.email ?? ''} readOnly />
        </label>
        <label className="field">
          <span>Password</span>
          <input
            ref={field}
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        <button className="lipped" type="submit">
          Sign in
        </button>
        {signInAgainFailed ? <p role="alert">{copy.signInFailed}</p> : null}
      </form>
    </div>
  );
}
