import { useEffect, useState, type FormEvent } from 'react';
import { ApiError, api, get } from '../lib/api';
import { useEnv } from '../lib/env';
import { useRouter } from '../lib/router';
import { Field, Pill, Banner, describedBy } from '../components/ui';
import type { Me } from '../lib/env';

function Centered({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="centered">
      <div className="auth-card">
        <h1>{title}</h1>
        {children}
      </div>
    </main>
  );
}

export function Login() {
  const { navigate, search } = useRouter();
  const { reloadMe } = useEnv();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const next = new URLSearchParams(search).get('next');
      const result = await api<{ landing: string }>('POST', '/api/session', { body: { email, password, ...(next ? { next } : {}) } });
      await reloadMe();
      navigate(result.landing, { replace: true });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Centered title="Sign in">
      <form onSubmit={submit} noValidate>
        <Field id="login-email" label="Email">
          <input id="login-email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field id="login-password" label="Password">
          <input id="login-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Banner message={error} />
        <Pill type="submit" busy={busy}>
          Sign in
        </Pill>
      </form>
    </Centered>
  );
}

export function Invite({ token }: { token: string }) {
  const { navigate } = useRouter();
  const { reloadMe } = useEnv();
  const [info, setInfo] = useState<{ clinicName: string; email: string; name: string } | null>();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    get<{ clinicName: string; email: string; name: string }>(`/api/invitations/${token}`).then(setInfo, () => setInfo(null));
  }, [token]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await api<{ user: Me }>('POST', `/api/invitations/${token}/accept`, { body: { password } });
      await reloadMe();
      navigate('/today', { replace: true });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  };
  if (info === undefined) return null;
  if (info === null) {
    return (
      <Centered title="We couldn't find that page.">
        <p>This invitation link has been used or replaced. Ask your manager for a new one.</p>
      </Centered>
    );
  }
  return (
    <Centered title={`Join ${info.clinicName}`}>
      <p className="muted">
        {info.name}, choose a password for {info.email}.
      </p>
      <form onSubmit={submit} noValidate>
        <Field id="invite-password" label="Password" error={error}>
          <input id="invite-password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} {...describedBy('invite-password', error)} />
        </Field>
        <Pill type="submit" busy={busy}>
          Set password
        </Pill>
      </form>
    </Centered>
  );
}
