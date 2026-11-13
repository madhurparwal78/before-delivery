import { useState, type FormEvent, type ReactElement } from 'react';
import { ApiFailure, call } from './api.ts';
import { COPY } from './copy.ts';
import { Sprig } from './icons.tsx';
import { signedIn, useStore } from './store.ts';

export function SignIn({ next }: { next: string | null }): ReactElement {
  const notice = useStore((s) => s.signedOutNotice);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setPending(true);
    setProblem(null);
    try {
      const reply = await call<{ redirectTo: string }>('/api/session', {
        method: 'POST',
        body: { email, password, ...(next === null ? {} : { next }) },
        quiet401: true,
      });
      signedIn(reply.redirectTo);
    } catch (error) {
      setProblem(error instanceof ApiFailure && error.status === 401 ? COPY.badLogin : COPY.wentWrong);
      setPending(false);
    }
  };

  return (
    <main className="signin">
      <div className="signin-card">
        <Sprig />
        <h1>Sign in to Kinfold</h1>
        {notice && <p role="status" className="signin-notice">{COPY.signedOut}</p>}
        <form onSubmit={(event) => void submit(event)} noValidate>
          <label className="field">
            <span>Email</span>
            <input type="email" name="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label className="field">
            <span>Password</span>
            <input type="password" name="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          {problem && <p role="alert" className="field-error">{problem}</p>}
          <button type="submit" className="primary" disabled={pending}>{pending ? 'Signing in…' : 'Sign in'}</button>
        </form>
      </div>
    </main>
  );
}
