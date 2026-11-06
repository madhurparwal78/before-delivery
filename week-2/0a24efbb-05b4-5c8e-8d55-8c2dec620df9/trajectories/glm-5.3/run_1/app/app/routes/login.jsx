import { useEffect, useRef, useState } from 'react';
import { useLoaderData, useNavigate, useSearchParams } from 'react-router';
import { isSafeNext } from '../lib/next.jsx';

export async function loader({ request }) {
  // an ended session cookie on /login shows the ended-session notice
  const { loadSession } = await import('../../src/server/sessions.js');
  const header = request.headers.get('cookie') || '';
  const cookies = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > -1) cookies[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  const token = cookies.rostara_session;
  if (!token) return { ended: false };
  const loaded = await loadSession(decodeURIComponent(token));
  return { ended: !loaded || loaded.kind !== 'ok' };
}

export default function Login() {
  const [params] = useSearchParams();
  const data = useLoaderData();
  const notice = params.get('signed-out') === '1'
    ? 'You are signed out.'
    : data.ended
      ? 'Your session has ended. Sign in again.'
      : null;
  return (
    <div className="login-wrap">
      <h1>Sign in to Rostara</h1>
      {notice && <p className="status-line" role="status">{notice}</p>}
      <LoginForm />
    </div>
  );
}

function LoginForm() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [workAddress, setWorkAddress] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const next = params.get('next');
  const safeNext = isSafeNext(next) ? next : null;
  const alertRef = useRef(null);

  useEffect(() => {
    if (error && alertRef.current) alertRef.current.focus();
  }, [error]);

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ work_address: workAddress, password }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error || 'The desk could not reach the server. Try again.');
        setPassword('');
        return;
      }
      navigate(safeNext || '/requests', { replace: true });
    } catch {
      setError('The desk could not reach the server. Try again.');
      setPassword('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="login-form" onSubmit={onSubmit} noValidate>
      {error && (
        <p className="form-error" role="alert" tabIndex={-1} ref={alertRef}>
          {error}
        </p>
      )}
      <div className="field">
        <label htmlFor="work_address">Work address</label>
        <input
          id="work_address"
          name="work_address"
          type="email"
          autoComplete="username"
          value={workAddress}
          onChange={(e) => setWorkAddress(e.target.value)}
          required
        />
      </div>
      <div className="field">
        <label htmlFor="password">Password</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </div>
      <button type="submit" className="primary" disabled={busy}>
        {busy ? 'Signing in' : 'Sign in'}
      </button>
    </form>
  );
}
