import { useEffect, useRef, useState } from 'react';
import { api, isFailure } from '../api/client';
import { useSession, useAnnouncer } from '../api/session';
import { navigate } from '../shell';
import { GENERIC_ERROR, PendingButton, fieldErrors } from '../components';
import { KNOWN_TIME_ZONES } from '../../src-shared/domain';

const browserZone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
};

const ZoneSelect = ({ id, value, onChange }: { id: string; value: string; onChange: (zone: string) => void }): JSX.Element => (
  <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className="mono">
    {KNOWN_TIME_ZONES.map((zone) => (
      <option key={zone} value={zone}>
        {zone}
      </option>
    ))}
  </select>
);

export function SignInScreen(): JSX.Element {
  const { announce } = useAnnouncer();
  const { reload } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      await api.post('/api/auth/sign-in', { email, password });
      await reload();
      await new Promise((resolve) => setTimeout(resolve, 0));
      navigate('/');
      announce('');
    } catch (err) {
      const message = isFailure(err) && err.status === 401 ? "That email and password don't match." : GENERIC_ERROR;
      setError(message);
      announce(message);
    } finally {
      setPending(false);
    }
  };

  return (
    <main className="auth-page">
      <span className="product-name">Tidemark Daybook</span>
      <form className="auth-form" aria-label="Sign in" onSubmit={(e) => { void submit(e); }}>
        <h1>Sign in</h1>
        <div>
          <label htmlFor="signin-email">Email</label>
          <input id="signin-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div>
          <label htmlFor="signin-password">Password</label>
          <input id="signin-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>
        {error !== null ? <p className="field-error" id="signin-error">{error}</p> : null}
        <PendingButton type="submit" pending={pending} pendingLabel="Signing in…" className="primary">Sign in</PendingButton>
        <p className="switch-line">
          New here? <a href="/trial" onClick={(e) => { e.preventDefault(); navigate('/trial'); }}>Start a free trial</a>
        </p>
      </form>
    </main>
  );
}

export function TrialScreen(): JSX.Element {
  const { announce } = useAnnouncer();
  const { reload } = useSession();
  const [workspaceName, setWorkspaceName] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [timeZone, setTimeZone] = useState(browserZone);
  const [pending, setPending] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({});

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setPending(true);
    setFields({});
    try {
      const res = await api.post<{ billing: 'registered' | 'queued'; workspace: { trialEndsAt: string } }>(
        '/api/workspaces',
        { workspaceName, ownerName, email, password, timeZone },
      );
      await reload();
      await new Promise((resolve) => setTimeout(resolve, 0));
      navigate('/');
      const end = new Date(res.workspace.trialEndsAt);
      const label = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: timeZone ?? 'UTC' }).format(end);
      if (res.billing === 'queued') {
        announce('Workspace created. Billing is unreachable, so your seat will be registered when it\u2019s back.');
      } else {
        announce(`Workspace created. Your trial ends on ${label}.`);
      }
    } catch (err) {
      if (isFailure(err)) {
        if (err.code === 'email_taken') {
          announce('That email already has a Daybook.');
          setFields({ email: 'That email already has a Daybook.' });
        } else {
          announce(GENERIC_ERROR);
          setFields(err.fields ?? {});
        }
      } else {
        announce(GENERIC_ERROR);
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <main className="auth-page">
      <span className="product-name">Tidemark Daybook</span>
      <form className="auth-form" aria-label="Start your trial" onSubmit={(e) => { void submit(e); }}>
        <h1>Start your trial</h1>
        <div>
          <label htmlFor="trial-workspace">Workspace name</label>
          <input id="trial-workspace" value={workspaceName} onChange={(e) => setWorkspaceName(e.target.value)} required maxLength={80} />
          {fields.workspaceName !== undefined ? <p className="field-error" id="err-workspace">{fields.workspaceName}</p> : null}
        </div>
        <div>
          <label htmlFor="trial-name">Your name</label>
          <input id="trial-name" value={ownerName} onChange={(e) => setOwnerName(e.target.value)} required maxLength={80} />
          {fields.ownerName !== undefined ? <p className="field-error" id="err-owner">{fields.ownerName}</p> : null}
        </div>
        <div>
          <label htmlFor="trial-email">Email</label>
          <input id="trial-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          {fields.email !== undefined ? <p className="field-error" id="err-email">{fields.email}</p> : null}
        </div>
        <div>
          <label htmlFor="trial-password">Password</label>
          <input id="trial-password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={10} />
          {fields.password !== undefined ? <p className="field-error" id="err-password">{fields.password}</p> : null}
        </div>
        <div>
          <label htmlFor="trial-zone">Time zone</label>
          <ZoneSelect id="trial-zone" value={timeZone} onChange={setTimeZone} />
        </div>
        <PendingButton type="submit" pending={pending} pendingLabel="Creating workspace…" className="primary">Start free trial</PendingButton>
        <p className="switch-line">
          Already have an account? <a href="/signin" onClick={(e) => { e.preventDefault(); navigate('/signin'); }}>Sign in</a>
        </p>
      </form>
    </main>
  );
}

export function JoinScreen({ token }: { token: string }): JSX.Element {
  const { announce } = useAnnouncer();
  const { reload } = useSession();
  const [workspaceName, setWorkspaceName] = useState('');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [timeZone, setTimeZone] = useState(browserZone);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  useEffect(() => {
    void api
      .get<{ workspaceName: string; email: string }>(`/api/invitations/${token}`)
      .then((res) => {
        setWorkspaceName(res.workspaceName);
        setEmail(res.email);
      })
      .catch((err: unknown) => {
        if (isFailure(err) && err.code === 'invitation_used') setNotice('This invite has already been used.');
        else setNotice(GENERIC_ERROR);
      });
  }, [token]);

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setPending(true);
    setFields({});
    try {
      await api.post(`/api/invitations/${token}/accept`, { name, password, timeZone });
      await reload();
      await new Promise((resolve) => setTimeout(resolve, 0));
      navigate('/');
      announce('');
    } catch (err) {
      if (isFailure(err)) {
        if (err.code === 'invitation_used') {
          setNotice('This invite has already been used.');
          announce('This invite has already been used.');
        } else {
          setFields(err.fields ?? {});
          announce(GENERIC_ERROR);
        }
      } else {
        announce(GENERIC_ERROR);
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <main className="auth-page">
      <span className="product-name">Tidemark Daybook</span>
      <form className="auth-form" aria-label={workspaceName === '' ? `Join workspace` : `Join ${workspaceName}`} onSubmit={(e) => { void submit(e); }}>
        <h1>{workspaceName === '' ? 'Join' : `Join ${workspaceName}`}</h1>
        {notice !== null ? <p className="field-error" id="join-error">{notice}</p> : null}
        {notice === null ? (
          <>
            <p>Joining as {email}</p>
            <div>
              <label htmlFor="join-name">Your name</label>
              <input id="join-name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} />
              {fields.name !== undefined ? <p className="field-error" id="err-join-name">{fields.name}</p> : null}
            </div>
            <div>
              <label htmlFor="join-password">Password</label>
              <input id="join-password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={10} />
              {fields.password !== undefined ? <p className="field-error" id="err-join-password">{fields.password}</p> : null}
            </div>
            <div>
              <label htmlFor="join-zone">Time zone</label>
              <ZoneSelect id="join-zone" value={timeZone} onChange={setTimeZone} />
            </div>
            <PendingButton type="submit" pending={pending} pendingLabel="Joining…" className="primary">Join workspace</PendingButton>
          </>
        ) : null}
      </form>
    </main>
  );
}
