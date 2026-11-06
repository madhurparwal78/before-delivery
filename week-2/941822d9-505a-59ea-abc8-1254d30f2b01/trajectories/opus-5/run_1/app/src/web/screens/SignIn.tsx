import { useState, type ReactNode } from 'react';
import { ApiFailure, NetworkFailure, NETWORK_MESSAGE, request } from '../lib/api.js';
import { FeedbackRegions, useFeedback } from '../lib/feedback.js';
import { navigate } from '../lib/router.js';
import type { User } from '../lib/types.js';

export function SignIn({ onSignedIn }: { readonly onSignedIn: (user: User) => void }): ReactNode {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const feedback = useFeedback();

  async function submit(): Promise<void> {
    setPending(true);
    setFieldError(null);
    feedback.announce('Signing in…');
    try {
      const result = await request<{ user: User }>('/api/session', {
        method: 'POST',
        body: { email, password },
      });
      feedback.clear();
      onSignedIn(result.user);
      navigate('/courses');
    } catch (error) {
      if (error instanceof ApiFailure && error.fieldErrors !== null) {
        setFieldError(error.fieldErrors['password'] ?? error.fieldErrors['email'] ?? null);
        feedback.clear();
      } else if (error instanceof NetworkFailure) {
        feedback.warn(NETWORK_MESSAGE);
      } else {
        feedback.warn(NETWORK_MESSAGE);
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="signin">
      <div className="signin__card">
        <h1>Sign in to Credwell</h1>
        <p className="hint">Sorrel &amp; Pike Learning — nursing continuing professional development.</p>
        <FeedbackRegions />
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!pending) void submit();
          }}
        >
          <div className="field">
            <label htmlFor="signin-email">Email</label>
            <input
              id="signin-email"
              type="text"
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="signin-password">Password</label>
            <input
              id="signin-password"
              type="password"
              autoComplete="current-password"
              aria-describedby={fieldError === null ? undefined : 'signin-password-error'}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            {fieldError === null ? null : (
              <p className="field__error" id="signin-password-error">
                {fieldError}
              </p>
            )}
          </div>
          <button type="submit" disabled={pending}>
            {pending ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </main>
  );
}
