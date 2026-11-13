import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import type { SessionBody } from '../shared/types.js';
import { announce, useAnnouncement } from './announce.js';
import { ApiError, RETURN_KEY, api, setSession } from './api.js';
import { Column, FormSummary } from './Chrome.js';
import type { FormError } from './Chrome.js';
import { navigate } from './router.js';

export function SignInPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<FormError[]>([]);
  const [pending, setPending] = useState(false);
  const status = useAnnouncement('Sign-in announcements');
  useEffect(() => {
    document.title = 'Sign in to Hushline';
  }, []);
  useEffect(() => {
    if (errors.length > 0) document.getElementById('form-summary')?.focus();
  }, [errors]);
  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (pending) return;
    const found: FormError[] = [];
    if (email.trim() === '') found.push({ field: 'email', message: 'Enter your email.' });
    if (password === '') found.push({ field: 'password', message: 'Enter your password.' });
    setErrors(found);
    if (found.length > 0) return;
    setPending(true);
    announce('Sign-in announcements', 'Signing in...');
    try {
      const session = await api<SessionBody>('/api/auth/login', { method: 'POST', body: { email, password }, staff: false });
      setSession(session);
      const back = window.sessionStorage.getItem(RETURN_KEY);
      window.sessionStorage.removeItem(RETURN_KEY);
      navigate(back ?? '/inbox');
    } catch (error) {
      announce('Sign-in announcements', error instanceof ApiError && error.status === 401 ? "That email and password don't match." : 'Sign in failed. Try again.');
      setPending(false);
    }
  };
  const message = (field: string): string | undefined => errors.find((error) => error.field === field)?.message;
  return (
    <main className="screen">
      <Column>
        <h1>Sign in to Hushline</h1>
        <form className="form" onSubmit={(event) => void submit(event)} noValidate>
          <FormSummary errors={errors} />
          <label htmlFor="email" className="label">Email</label>
          <input id="email" type="email" className="field" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} aria-invalid={message('email') ? true : undefined} aria-describedby={message('email') ? 'email-error' : undefined} />
          {message('email') ? <p className="error" id="email-error">{message('email')}</p> : null}
          <label htmlFor="password" className="label">Password</label>
          <input id="password" type="password" className="field" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} aria-invalid={message('password') ? true : undefined} aria-describedby={message('password') ? 'password-error' : undefined} />
          {message('password') ? <p className="error" id="password-error">{message('password')}</p> : null}
          <button type="submit" className="button primary">Sign in</button>
        </form>
        <div role="status" aria-label="Sign-in announcements" aria-live="polite" className="announcements">{status}</div>
      </Column>
    </main>
  );
}
