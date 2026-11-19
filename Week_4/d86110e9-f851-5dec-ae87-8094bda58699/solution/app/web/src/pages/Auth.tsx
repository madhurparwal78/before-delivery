import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { api, ApiFailure } from '../api';
import { Link, navigate, useTitle } from '../router';
import { useShell } from '../shell';
import { Button, Problem } from '../ui';
import { NotFound } from './NotFound';
import '../build/styles/site.css';

interface Failure {
  message: string;
  field?: string;
}

function AuthPanel({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  useTitle(title);
  return (
    <section className="auth-panel panel-dark on-dark">
      <h1>{title}</h1>
      <div className="auth-card">{children}</div>
      {aside ? <p className="auth-aside">{aside}</p> : null}
    </section>
  );
}

function PasswordField({ value, onChange, autoComplete }: { value: string; onChange: (value: string) => void; autoComplete: string }) {
  return (
    <div className="field">
      <label htmlFor="field-password">Password</label>
      <input id="field-password" type="password" role="textbox" autoComplete={autoComplete} value={value} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}

function TextField({ name, label, type = 'text', value, onChange, autoComplete }: { name: string; label: string; type?: string; value: string; onChange: (value: string) => void; autoComplete?: string }) {
  return (
    <div className="field">
      <label htmlFor={`field-${name}`}>{label}</label>
      <input id={`field-${name}`} type={type} autoComplete={autoComplete} value={value} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}

function useSubmit(run: () => Promise<void>): { busy: boolean; failure: Failure | null; submit: (event: FormEvent) => void } {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const { raise } = useShell();
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    setBusy(true);
    setFailure(null);
    run()
      .catch((error: unknown) => {
        if (!(error instanceof ApiFailure)) throw error;
        if (error.status === 503) raise(`${error.message}. Your account was not created.`);
        else setFailure({ message: error.message, field: error.field });
      })
      .finally(() => setBusy(false));
  };
  return { busy, failure, submit };
}

export function SignUp() {
  const { say } = useShell();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { busy, failure, submit } = useSubmit(async () => {
    const answer = await api.post<{ message: string }>('/api/auth/sign-up', { name, email, password });
    say(answer.message);
  });
  return (
    <AuthPanel title="Create a workspace" aside={<>Already have an account? <Link to="/sign-in">Sign in</Link></>}>
      <form onSubmit={submit} noValidate>
        <Problem message={failure?.message ?? null} field={failure?.field} />
        <TextField name="name" label="Name" value={name} onChange={setName} autoComplete="name" />
        <TextField name="email" label="Email" type="email" value={email} onChange={setEmail} autoComplete="email" />
        <PasswordField value={password} onChange={setPassword} autoComplete="new-password" />
        <Button type="submit" busy={busy}>Create account</Button>
      </form>
    </AuthPanel>
  );
}

export function SignIn() {
  const { refreshMe } = useShell();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { busy, failure, submit } = useSubmit(async () => {
    const answer = await api.post<{ workspace_id: string }>('/api/auth/sign-in', { email, password });
    await refreshMe();
    navigate(`/w/${answer.workspace_id}`);
  });
  return (
    <AuthPanel title="Sign in" aside={<>New here? <Link to="/sign-up">Create a workspace</Link></>}>
      <form onSubmit={submit} noValidate>
        <Problem message={failure?.message ?? null} field={failure?.field ?? 'email'} />
        <TextField name="email" label="Email" type="email" value={email} onChange={setEmail} autoComplete="email" />
        <PasswordField value={password} onChange={setPassword} autoComplete="current-password" />
        <Button type="submit" busy={busy}>Sign in</Button>
      </form>
    </AuthPanel>
  );
}

export function Confirm({ token }: { token: string }) {
  const { refreshMe } = useShell();
  const [missing, setMissing] = useState(false);
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    api.post<{ workspace_id: string }>('/api/auth/confirm', { token }).then(
      async (answer) => {
        await refreshMe();
        navigate(`/w/${answer.workspace_id}`, { replace: true });
      },
      (error: unknown) => {
        if (error instanceof ApiFailure && error.status === 404) setMissing(true);
        else throw error;
      },
    );
  }, [token, refreshMe]);
  if (missing) return <NotFound />;
  return (
    <AuthPanel title="Confirming your email">
      <p>One moment while we open your workspace.</p>
    </AuthPanel>
  );
}

interface InviteInfo {
  workspace_name: string;
  email: string;
  role: string;
  has_account: boolean;
}

export function Invite({ token }: { token: string }) {
  const { refreshMe } = useShell();
  const [invite, setInvite] = useState<InviteInfo | null | 'missing'>(null);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const { busy, failure, submit } = useSubmit(async () => {
    const answer = await api.post<{ workspace_id: string }>(`/api/invites/${token}/accept`, { name, password });
    await refreshMe();
    navigate(`/w/${answer.workspace_id}`);
  });
  useEffect(() => {
    api.get<InviteInfo>(`/api/invites/${token}`).then(setInvite, (error: unknown) => {
      if (error instanceof ApiFailure && error.status === 404) setInvite('missing');
      else throw error;
    });
  }, [token]);
  if (invite === 'missing') return <NotFound />;
  if (invite === null) return null;
  return (
    <AuthPanel title={`Join ${invite.workspace_name}`}>
      <p>
        You were invited as {invite.role} using <strong>{invite.email}</strong>.
      </p>
      <form onSubmit={submit} noValidate>
        <Problem message={failure?.message ?? null} field={failure?.field ?? 'password'} />
        {invite.has_account ? null : <TextField name="name" label="Name" value={name} onChange={setName} autoComplete="name" />}
        <PasswordField value={password} onChange={setPassword} autoComplete={invite.has_account ? 'current-password' : 'new-password'} />
        <Button type="submit" busy={busy}>Join workspace</Button>
      </form>
    </AuthPanel>
  );
}
