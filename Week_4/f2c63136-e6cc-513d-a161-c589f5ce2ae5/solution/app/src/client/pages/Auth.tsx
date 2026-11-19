import { useState } from 'preact/hooks';
import { Link } from '../router.tsx';
import { Button, Screen } from '../ui.tsx';
import { api, ApiError } from '../api.ts';
import { actionStatus } from '../store.ts';
import { TextField, useAction } from './shared.tsx';
import './auth.css';

export function Signup() {
  const [form, setForm] = useState({ email: '', username: '', name: '', password: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { busy, run } = useAction();
  const set = (key: keyof typeof form) => (value: string) => setForm((current) => ({ ...current, [key]: value }));
  return (
    <Screen>
      <div className="bento auth-card">
        <h1>Open a workspace</h1>
        <p className="muted lead">Create your account, then confirm your email to log in.</p>
        <form
          noValidate
          onSubmit={async (event) => {
            event.preventDefault();
            setErrors({});
            const result = await run('Working...', 'Your account is created. The confirmation email is on its way.', () => api('POST', '/api/signup', form));
            if (result.ok) setForm({ email: '', username: '', name: '', password: '' });
            else setErrors(result.fields);
          }}
        >
          <TextField label="Email" type="email" autoComplete="email" value={form.email} onValue={set('email')} error={errors.email} />
          <TextField label="Username" type="text" autoComplete="username" autoCapitalize="none" value={form.username} onValue={set('username')} error={errors.username} />
          <TextField label="Full name" type="text" autoComplete="name" value={form.name} onValue={set('name')} error={errors.name} />
          <TextField label="Password" type="text" className="secret-input" autoComplete="new-password" value={form.password} onValue={set('password')} error={errors.password} />
          <Button kind="primary" type="submit" busy={busy}>Create account</Button>
        </form>
        <p className="auth-foot">Already have an account? <Link href="/login">Log in</Link></p>
      </div>
    </Screen>
  );
}

/** Only same-origin relative paths are followed after login. */
function nextPath(): string {
  const next = new URLSearchParams(window.location.search).get('next');
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/inbox';
}

export function Login() {
  const [form, setForm] = useState({ email: '', password: '' });
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Screen>
      <div className="bento auth-card">
        <h1>Log in</h1>
        <p className="muted lead">Welcome back to your stacks.</p>
        {failure ? <div role="alert" className="form-alert">{failure}</div> : null}
        <form
          noValidate
          onSubmit={async (event) => {
            event.preventDefault();
            setFailure(null);
            setBusy(true);
            actionStatus.set('Working...');
            try {
              await api('POST', '/api/login', form);
              window.location.assign(nextPath());
            } catch (error) {
              actionStatus.set('');
              setBusy(false);
              if (error instanceof ApiError && error.body.error) setFailure(error.body.error);
            }
          }}
        >
          <TextField label="Email" type="email" autoComplete="email" value={form.email} onValue={(email) => setForm({ ...form, email })} />
          <TextField label="Password" type="text" className="secret-input" autoComplete="current-password" value={form.password} onValue={(password) => setForm({ ...form, password })} />
          <Button kind="primary" type="submit" busy={busy}>Log in</Button>
        </form>
        <p className="auth-foot">New here? <Link href="/signup">Open a workspace</Link></p>
      </div>
    </Screen>
  );
}

export function Confirm({ token }: { token: string }) {
  const [done, setDone] = useState(false);
  const { busy, run } = useAction();
  return (
    <Screen>
      <div className="bento auth-card confirm-done">
        <h1>Confirm your email</h1>
        {done ? (
          <p>Your email is confirmed. <Link href="/login">Log in</Link></p>
        ) : (
          <>
            <p className="muted">One step left before you can log in.</p>
            <Button kind="primary" busy={busy} onClick={async () => setDone((await run('Working...', 'Your email is confirmed.', () => api('POST', '/api/confirm', { token }))).ok)}>
              Confirm email
            </Button>
          </>
        )}
      </div>
    </Screen>
  );
}
