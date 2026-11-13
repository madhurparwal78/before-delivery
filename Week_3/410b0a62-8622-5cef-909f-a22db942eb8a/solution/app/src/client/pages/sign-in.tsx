import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { Me } from '../../shared/types.js';
import { failureMessage, post } from '../api.js';
import { navigate } from '../router.js';
import { useSession } from '../session.js';
import { Field, Panel, Pill } from '../ui.js';

export function SignIn() {
  const { signedIn } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const alert = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (message) alert.current?.focus();
  }, [message]);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setPending(true);
    setMessage(null);
    try {
      const { user } = await post<{ user: Me }>('/api/auth/sign-in', { email, password });
      signedIn(user);
      navigate('/', true);
    } catch (failure) {
      setMessage(failureMessage(failure));
    } finally {
      setPending(false);
    }
  };

  return (
    <main className="sign-in">
      <form className="sign-in-card" onSubmit={(event) => void submit(event)} noValidate>
        <div className="wordmark wordmark-static">
          <svg viewBox="0 0 32 32" width="40" height="40" aria-hidden="true" focusable="false">
            <rect width="32" height="32" rx="9" className="wordmark-tile" />
            <path d="M8 23 14 9h5l-6 14z" className="wordmark-stroke" />
            <path d="M17 23 23 9h3l-6 14z" className="wordmark-stroke-2" />
          </svg>
          <span className="wordmark-text">
            <strong>Tempoline</strong>
            <small>Ottermere Sport</small>
          </span>
        </div>
        <h1>Sign in</h1>
        {message && (
          <Panel panelRef={alert} tabbable>
            {message}
          </Panel>
        )}
        <Field label="Email">{(props) => <input {...props} type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} />}</Field>
        <Field label="Password">
          {(props) => <input {...props} type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} />}
        </Field>
        <Pill tone="navy" type="submit" pending={pending} pendingText="Signing in…">
          Sign in
        </Pill>
      </form>
    </main>
  );
}
