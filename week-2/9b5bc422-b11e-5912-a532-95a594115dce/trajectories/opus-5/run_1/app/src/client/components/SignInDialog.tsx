import { useRef, useState } from 'react';
import { pending, signInCopy } from '../../domain/copy.ts';
import { announce } from '../store/store.ts';
import { account } from '../store/sync.ts';
import { Dialog } from './Dialog.tsx';

type Errors = Record<string, string>;

export function SignInDialog(props: { onClose: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState<'signIn' | 'create' | null>(null);
  const emailRef = useRef<HTMLInputElement | null>(null);
  const passwordRef = useRef<HTMLInputElement | null>(null);

  const submit = async (kind: 'signIn' | 'create') => {
    setBusy(kind);
    setErrors({});
    const result = kind === 'create' ? await account.create(email, password) : await account.signIn(email, password);
    setBusy(null);
    if (result.status === 201 || result.status === 200) {
      props.onClose();
      return;
    }
    if (!result.reachable || result.status === 503) {
      setErrors({ form: signInCopy.unreachable });
      announce(signInCopy.unreachable);
      return;
    }
    const given = (result.body.errors as Errors) ?? { form: signInCopy.unreachable };
    setErrors(given);
    announce(Object.values(given)[0]);
    if (given.email) emailRef.current?.focus();
    else if (given.password) passwordRef.current?.focus();
  };

  return (
    <Dialog name="Sign in" onClose={props.onClose}>
      <h2 className="display">Sign in</h2>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit('signIn');
        }}
      >
        <label className="field">
          <span>Email</span>
          <input
            type="email"
            value={email}
            ref={emailRef}
            data-autofocus
            autoComplete="email"
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        {errors.email && <p className="field-error">{errors.email}</p>}
        <label className="field">
          <span>Password</span>
          <input
            type="password"
            value={password}
            ref={passwordRef}
            autoComplete="current-password"
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        {errors.password && <p className="field-error">{errors.password}</p>}
        {errors.form && <p className="field-error">{errors.form}</p>}
        <div className="dialog-actions">
          <button type="submit" className="button" disabled={busy !== null}>
            {busy === 'signIn' ? pending.signingIn : 'Sign in'}
          </button>
          <button
            type="button"
            className="button"
            disabled={busy !== null}
            onClick={() => void submit('create')}
          >
            {busy === 'create' ? pending.creatingAccount : 'Create account'}
          </button>
          <button type="button" className="button" onClick={props.onClose}>
            Close
          </button>
        </div>
      </form>
    </Dialog>
  );
}
