import { useState } from 'react';
import { api, type SessionUser } from './api.js';
import type { JSX } from 'react';

interface AuthPageProps {
  mode: 'signin' | 'signup';
  me: SessionUser | null;
  navigate: (path: string) => void;
  onSignedIn: (user: SessionUser) => void;
}

type ApiErrorBody = { error?: string; errors?: Record<string, string> };

export function AuthPage({ mode, navigate, onSignedIn }: AuthPageProps): JSX.Element {
  const [step, setStep] = useState<'credentials' | 'code'>('credentials');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [alert, setAlert] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  const isSignup = mode === 'signup';

  const submit = async () => {
    setBusy(true);
    setErrors({});
    setAlert('');
    try {
      if (isSignup && step === 'credentials') {
        await api('/api/auth/signup', { method: 'POST', body: JSON.stringify({ display_name: displayName, email, password }) });
        setStep('code');
        setNotice(`We sent a 6-digit code to ${email}.`);
        setBusy(false);
        return;
      }
      if (isSignup && step === 'code') {
        const r = await api<{ user: SessionUser }>('/api/auth/verify', {
          method: 'POST',
          body: JSON.stringify({ email, code }),
        });
        onSignedIn(r.user);
        navigate('/');
        setBusy(false);
        return;
      }
      const r = await api<{ user: SessionUser }>('/api/auth/signin', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      onSignedIn(r.user);
      navigate('/');
      setBusy(false);
    } catch (err) {
      const e = err as Error & { status: number; body: ApiErrorBody };
      if (e.status === 503) {
        setAlert('We can\'t send your code right now. Try again in a few minutes.');
      } else if (e.status === 401) {
        setAlert('That email and password don\'t match.');
      } else if (e.status === 403) {
        setAlert('Confirm your email first.');
      } else if (e.body?.errors) {
        setErrors(e.body.errors);
      }
      setBusy(false);
    }
  };

  return (
    <main className="auth-page">
      <h1>{isSignup ? 'Create your account' : 'Sign in'}</h1>
      {isSignup && step === 'code' ? (
        <>
          <p className="hint">{notice}</p>
          <label>
            <span className="hint">Code</span>
            <input
              className="field"
              name="Code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              autoFocus
              inputMode="numeric"
            />
          </label>
          <p className="field-msg">{errors.code ?? ''}</p>
          <button className="btn" name="Confirm email" onClick={submit} disabled={busy}>
            Confirm email
          </button>
        </>
      ) : (
        <>
          {isSignup && (
            <label>
              <span className="hint">Display name</span>
              <input
                className="field"
                name="Display name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                autoFocus
              />
              <p className="field-msg">{errors.display_name ?? ''}</p>
            </label>
          )}
          <label>
            <span className="hint">Email</span>
            <input className="field" name="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <p className="field-msg">{errors.email ?? ''}</p>
          </label>
          <label>
            <span className="hint">Password</span>
            <input
              className="field"
              name="Password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <p className="field-msg">{errors.password ?? ''}</p>
          </label>
          <button className="btn" name={isSignup ? 'Create account' : 'Sign in'} onClick={submit} disabled={busy}>
            {isSignup ? 'Create account' : 'Sign in'}
          </button>
        </>
      )}
      <div className="alert" data-shown={alert ? 'true' : 'false'} role="alert">
        {alert}
      </div>
      <p className="hint">
        {isSignup ? (
          <a href="/signin">Sign in instead</a>
        ) : (
          <a href="/signup">Create an account</a>
        )}
      </p>
    </main>
  );
}
