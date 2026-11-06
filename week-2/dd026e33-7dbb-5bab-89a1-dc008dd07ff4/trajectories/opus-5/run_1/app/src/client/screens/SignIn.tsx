import { useState, type ReactNode } from 'react';
import type { User } from '../../shared/types';
import { SIGN_IN } from '../copy';
import { api, fieldErrors } from '../lib/api';
import { navigate, useLocation } from '../lib/router';
import { useSession } from '../lib/session';
import { ErrorSummary, FieldMessage, type FieldError } from '../components/Status';

export function SignInScreen(): ReactNode {
  const location = useLocation();
  const { setUser, revokedNotice, clearRevokedNotice } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [refused, setRefused] = useState(false);

  const next = new URLSearchParams(location.search).get('next');

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    clearRevokedNotice();
    setErrors({});
    setRefused(false);
    setPending(SIGN_IN.pending);
    const outcome = await api<{ user: User; redirect: string }>('/api/session', {
      body: { email, password, next },
    });
    setPending(null);
    if (outcome.kind === 'ok') {
      setUser(outcome.body.user);
      navigate(outcome.body.redirect, { replace: true });
      return;
    }
    if (outcome.kind === 'error' && outcome.status === 422) {
      setErrors(fieldErrors(outcome.body));
      return;
    }
    setRefused(true);
  };

  const summary: FieldError[] = [];
  if (revokedNotice) {
    summary.push({ field: 'revoked', message: SIGN_IN.revoked, inputId: 'sign-in-email' });
  }
  if (refused) {
    summary.push({ field: 'credentials', message: SIGN_IN.wrong, inputId: 'sign-in-email' });
  }
  for (const [field, message] of Object.entries(errors)) {
    summary.push({ field, message, inputId: `sign-in-${field}` });
  }

  return (
    <div className="sign-in">
      <h1>Sign in to Lacquer</h1>
      <ErrorSummary errors={summary} />
      <form onSubmit={submit} className="stack">
        <label htmlFor="sign-in-email">Email</label>
        <input
          id="sign-in-email"
          type="email"
          autoComplete="username"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <FieldMessage id="sign-in-email-error" message={errors.email} />
        <label htmlFor="sign-in-password">Password</label>
        <input
          id="sign-in-password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <FieldMessage id="sign-in-password-error" message={errors.password} />
        <button type="submit" className="primary">
          Sign in
        </button>
        {pending === null ? null : <p aria-live="polite">{pending}</p>}
      </form>
    </div>
  );
}
