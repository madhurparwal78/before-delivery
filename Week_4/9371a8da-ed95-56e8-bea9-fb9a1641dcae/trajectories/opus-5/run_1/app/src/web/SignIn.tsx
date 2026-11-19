import { useEffect, useRef, useState } from 'react';
import { api, ApiFailure } from './api.js';
import { copy } from './copy.js';
import { replace, safeNext } from './navigation.js';
import { User } from './types.js';

interface Props {
  search: string;
  onSignedIn: (user: User) => void;
}

export function SignIn(props: Props): JSX.Element {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const emailRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    emailRef.current?.focus();
  }, []);

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const answer = await api<{ user: User }>('/api/session', {
        method: 'POST',
        body: { email, password },
      });
      const next = safeNext(new URLSearchParams(props.search).get('next'));
      props.onSignedIn(answer.user);
      replace(next);
    } catch (failure) {
      setError(
        failure instanceof ApiFailure && failure.status === 401
          ? copy.fields.credentials
          : copy.somethingWrong,
      );
      emailRef.current?.focus();
    } finally {
      setPending(false);
    }
  };

  return (
    <main className="centred-column">
      <h1>Sign in to Marginalia</h1>
      <form onSubmit={submit} className="stack">
        <label>
          <span className="field-label">Email</span>
          <input
            ref={emailRef}
            type="email"
            value={email}
            aria-describedby={error === null ? undefined : 'signin-error'}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <label>
          <span className="field-label">Password</span>
          <input
            type="password"
            value={password}
            aria-describedby={error === null ? undefined : 'signin-error'}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        {error === null ? null : (
          <p className="field-error" id="signin-error">
            {error}
          </p>
        )}
        <button type="submit" disabled={pending} aria-busy={pending ? true : undefined}>
          Sign in
        </button>
      </form>
    </main>
  );
}
