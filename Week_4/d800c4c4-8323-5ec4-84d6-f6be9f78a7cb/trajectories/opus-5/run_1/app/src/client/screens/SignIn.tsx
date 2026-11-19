import { useRef, useState } from 'react';
import { destinationAfterSignIn } from '../../shared/screens';
import type { User } from '../../shared/types';
import { Announcements } from '../components/Shell';
import { FormProblems } from '../components/FormProblems';
import { api, ApiFailed } from '../lib/api';
import { takeDraft } from '../lib/draft';
import { useApp } from '../lib/app-context';

export function SignIn(): JSX.Element {
  const { search, announce, reloadViewer, navigate, offerDraft } = useApp();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const summary = useRef<HTMLDivElement>(null);

  async function submit(): Promise<void> {
    if (pending) return;
    setPending(true);
    try {
      const result = await api.post<{ user: User }>('/api/session', { email, password });
      await reloadViewer();
      const next = new URLSearchParams(search).get('next');
      const destination = destinationAfterSignIn(next, result.user.role);
      offerDraft(takeDraft(destination, result.user.email));
      navigate(destination, { replace: true });
    } catch (error) {
      if (error instanceof ApiFailed) announce(error.error);
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Announcements kind="account" />
      <FormProblems problems={null} ref={summary} onJump={() => undefined} />
      <h1>Sign in</h1>
      <form
        className="ledger-form"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
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
        <button type="submit" aria-busy={pending} aria-disabled={pending}>
          {pending ? 'Signing in...' : 'Sign in'}
        </button>
      </form>
    </>
  );
}
