// Sign-in: shows exactly what the server's latest answer decided; the button is never disabled.
import { useState, type FormEvent } from 'react';
import { api, NetworkError } from '../api.ts';
import { COPY } from '../feedback.ts';
import { safeReturn } from '../../shared/returnAddress.ts';

const WRONG = "That email and password don't match.";
const LOCKED = 'Too many sign-in attempts. Wait a while, then try again.';

export function SignIn() {
  const params = new URLSearchParams(window.location.search);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState(params.get('reason') === 'signed-out' ? COPY.signedOut : '');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const r = await api<{ errors?: Record<string, string> }>('POST', '/api/auth/sign-in', { email, password });
      if (r.status === 200) {
        setMessage('');
        window.location.assign(safeReturn(params.get('return')) ?? '/today');
        return;
      }
      setErrors(r.status === 422 ? r.data.errors ?? {} : {});
      setMessage(r.status === 429 ? LOCKED : r.status === 401 ? WRONG : '');
    } catch (error) {
      if (error instanceof NetworkError) setMessage(COPY.notSaved);
    }
  };

  return (
    <main className="sign-in">
      <form className="sign-in-card" onSubmit={(e) => void submit(e)} noValidate>
        <p className="wordmark" aria-hidden="true">Quire</p>
        <h1>Sign in to Quire</h1>
        <div role="alert" className="alert-band">{message}</div>
        <div className="field">
          <label htmlFor="sign-in-email">Email</label>
          <input id="sign-in-email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)}
            aria-describedby={errors.email ? 'sign-in-email-error' : undefined} aria-invalid={errors.email ? true : undefined} />
          {errors.email && <p id="sign-in-email-error" className="field-error">{errors.email}</p>}
        </div>
        <div className="field">
          <label htmlFor="sign-in-password">Password</label>
          <input id="sign-in-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)}
            aria-describedby={errors.password ? 'sign-in-password-error' : undefined} aria-invalid={errors.password ? true : undefined} />
          {errors.password && <p id="sign-in-password-error" className="field-error">{errors.password}</p>}
        </div>
        <button type="submit" className="primary sign-in-submit">Sign in</button>
        <p className="sign-in-foot muted">Oakgall Press · a commonplace workspace</p>
      </form>
    </main>
  );
}
