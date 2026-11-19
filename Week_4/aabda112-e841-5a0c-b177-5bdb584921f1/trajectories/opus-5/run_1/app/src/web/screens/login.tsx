import { useEffect, useState, type JSX } from 'react';
import { api, get } from '../api';
import { InlineAlert, Pill } from '../ui';
import { messageOf } from './today';

export function LoginScreen(): JSX.Element {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const next = new URLSearchParams(window.location.search).get('next');

  const submit = async (): Promise<void> => {
    setBusy(true);
    try {
      const result = await api<{ landing: string }>('POST', '/api/session', {
        email,
        password,
        next,
      });
      window.location.assign(result.landing);
    } catch (error) {
      setFailure(messageOf(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="centred-page">
      <form
        className="centred-card"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <h1>Sign in</h1>
        <div className="field">
          <label htmlFor="login-email">Email</label>
          <input
            id="login-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="login-password">Password</label>
          <input
            id="login-password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>
        <Pill type="submit" busy={busy}>
          Sign in
        </Pill>
        <InlineAlert message={failure} />
      </form>
    </main>
  );
}

export function InviteScreen({ token }: { token: string }): JSX.Element {
  const [clinicName, setClinicName] = useState('');
  const [missing, setMissing] = useState(false);
  const [password, setPassword] = useState('');
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void get<{ clinicName: string }>(`/api/invitations/${token}`)
      .then((data) => setClinicName(data.clinicName))
      .catch(() => setMissing(true));
  }, [token]);

  if (missing) {
    return (
      <main className="centred-page">
        <div className="empty-card tint-sky">
          <p className="card-title">We couldn&apos;t find that page.</p>
          <Pill onClick={() => window.location.assign('/today')}>Back to today</Pill>
        </div>
      </main>
    );
  }

  return (
    <main className="centred-page">
      <form
        className="centred-card"
        onSubmit={(event) => {
          event.preventDefault();
          setBusy(true);
          void api('POST', `/api/invitations/${token}/accept`, { password })
            .then(() => window.location.assign('/today'))
            .catch((error) => setFailure(messageOf(error)))
            .finally(() => setBusy(false));
        }}
      >
        <h1>{`Join ${clinicName}`}</h1>
        <div className="field">
          <label htmlFor="invite-password">Password</label>
          <input
            id="invite-password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>
        <Pill type="submit" busy={busy}>
          Set password
        </Pill>
        <InlineAlert message={failure} />
      </form>
    </main>
  );
}
