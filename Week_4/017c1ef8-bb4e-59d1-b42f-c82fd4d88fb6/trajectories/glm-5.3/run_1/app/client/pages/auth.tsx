import { useState } from 'react';
import { api } from '../api.js';
import { useApp } from '../app-context.js';

const alertFor = (body: unknown): string | null => {
  const b = body as { error?: string; fields?: Record<string, string> };
  if (b?.error === 'invalid_credentials') return 'That email and password don\'t match.';
  if (b?.error === 'unconfirmed') return 'Confirm your email first. We sent you a code.';
  return null;
};

export const AuthPages = ({ mode, redirect }: { mode: 'join' | 'confirm' | 'signin'; redirect?: string }): JSX.Element => {
  const { refreshMe, navigate } = useApp();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [handle, setHandle] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);

  const afterAuth = async (): Promise<void> => {
    await refreshMe();
    navigate(redirect && redirect !== '/signin' ? redirect : '/feed');
  };

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    setPending(true);
    try {
      if (mode === 'join') {
        const result = await api.post<{ status: string }>('/api/auth/signup', { email, password, name, handle });
        if (result.status === 'confirmation_sent') {
          navigate('/confirm');
          window.sessionStorage.setItem('pw-confirm-email', email);
        }
      } else if (mode === 'confirm') {
        const emailToUse = email || window.sessionStorage.getItem('pw-confirm-email') || '';
        await api.post('/api/auth/confirm', { email: emailToUse, code });
        await afterAuth();
      } else {
        await api.post('/api/auth/signin', { email, password });
        await afterAuth();
      }
    } catch (err) {
      const e2 = err as { status?: number; body?: unknown };
      const fields = (e2.body as { fields?: Record<string, string> } | undefined)?.fields;
      if (fields) setFieldErrors(fields);
      setError(alertFor(e2.body) ?? 'Something went wrong. Try again.');
    } finally {
      setPending(false);
    }
  };

  const topAlert = error || Object.values(fieldErrors)[0] || null;

  return (
    <div className="auth-page">
      {topAlert && (
        <div role="alert" className="form-alert">
          <p>{topAlert}</p>
          {Object.entries(fieldErrors).length > 0 && (
            <ul>
              {Object.entries(fieldErrors).map(([field, message]) => (
                <li key={field}>
                  <a href={`#${field}`}>{message}</a>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <form onSubmit={(e) => { void submit(e); }} noValidate>
        {mode === 'join' && (
          <>
            <label className="label" htmlFor="name">Name</label>
            <input id="name" className="field" value={name} onChange={(e) => setName(e.target.value)} />
            {fieldErrors.name && <div role="alert">{fieldErrors.name}</div>}
            <label className="label" htmlFor="email">Email</label>
            <input id="email" className="field" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            {fieldErrors.email && <div role="alert">{fieldErrors.email}</div>}
            <label className="label" htmlFor="handle">Handle</label>
            <input id="handle" className="field" value={handle} onChange={(e) => setHandle(e.target.value)} />
            {fieldErrors.handle && <div role="alert">{fieldErrors.handle}</div>}
            <label className="label" htmlFor="password">Password</label>
            <input id="password" className="field" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
            {fieldErrors.password && <div role="alert">{fieldErrors.password}</div>}
            <button type="submit" className="pink-button" disabled={pending}>Create account</button>
          </>
        )}
        {mode === 'confirm' && (
          <>
            <label className="label" htmlFor="confirm-email">Email</label>
            <input
              id="confirm-email" className="field" type="email" value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={window.sessionStorage.getItem('pw-confirm-email') ?? ''}
            />
            <label className="label" htmlFor="code">Confirmation code</label>
            <input id="code" className="field" inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} />
            {fieldErrors.code && <div role="alert">{fieldErrors.code}</div>}
            <button type="submit" className="pink-button" disabled={pending}>Confirm</button>
          </>
        )}
        {mode === 'signin' && (
          <>
            <label className="label" htmlFor="email">Email</label>
            <input id="email" className="field" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <label className="label" htmlFor="password">Password</label>
            <input id="password" className="field" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
            <button type="submit" className="pink-button" disabled={pending}>Sign in</button>
          </>
        )}
      </form>
    </div>
  );
};
