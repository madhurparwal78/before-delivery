import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { OwnAccount } from '../../shared/types.js';
import { ApiError, api } from '../api.js';
import { announce } from '../announce.js';
import { Link, navigate, useSearch } from '../router.js';
import { useSession } from '../session.js';
import { ResendButton } from '../shell.js';
import { Button, Field, Skeleton, pageTitle, useFocusFirstInvalid } from '../ui.js';
import './pages.css';

/** Only same-site paths may be followed after sign-in or setup. */
export function safeNext(next: string | null, fallback: string): string {
  return next !== null && next.startsWith('/') && !next.startsWith('//') ? next : fallback;
}

const fieldsOf = (error: unknown): Record<string, string> => (error instanceof ApiError ? error.fields : {});

export function SignUpPage(_props: Record<string, unknown>): React.JSX.Element {
  pageTitle('Create account');
  const { refresh } = useSession();
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [tries, setTries] = useState(0);
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const form = useRef<HTMLFormElement>(null);
  useFocusFirstInvalid(form, tries);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    try {
      const account = await api<OwnAccount>('POST', '/api/auth/signup', { email, username, password });
      setErrors({});
      setSentTo(account.email);
      await refresh();
    } catch (error) {
      const fields = fieldsOf(error);
      if (Object.keys(fields).length > 0) {
        setErrors(fields);
        setTries((n) => n + 1);
      } else {
        announce("We couldn't create the account. Try again.", true);
      }
    } finally {
      setBusy(false);
    }
  };

  if (sentTo !== null) {
    return (
      <div className="narrow form-card">
        <h1>Check your inbox</h1>
        <p>We sent a confirmation link to {sentTo}.</p>
        <p className="muted">Open the link to confirm your address. Until then you can read and join communities, but not vote or post.</p>
        <ResendButton />
      </div>
    );
  }
  return (
    <div className="narrow form-card">
      <h1>Create account</h1>
      <form ref={form} onSubmit={(e) => void submit(e)} noValidate>
        <Field label="Email" error={errors.email}>
          {(p) => <input {...p} type="email" name="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />}
        </Field>
        <Field label="Username" error={errors.username}>
          {(p) => <input {...p} type="text" name="username" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} />}
        </Field>
        <Field label="Password" error={errors.password}>
          {(p) => <input {...p} type="password" name="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />}
        </Field>
        <div className="form-actions">
          <Button type="submit" variant="primary" busy={busy} disabled={busy}>{busy ? 'Creating account...' : 'Create account'}</Button>
        </div>
      </form>
      <p>Already have an account? <Link to="/login">Sign in</Link></p>
    </div>
  );
}

export function LogInPage(_props: Record<string, unknown>): React.JSX.Element {
  pageTitle('Sign in');
  const { refresh } = useSession();
  const next = useSearch().get('next');
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [needsCode, setNeedsCode] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [tries, setTries] = useState(0);
  const [busy, setBusy] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  useFocusFirstInvalid(form, tries);
  const codeBox = useRef<HTMLInputElement>(null);
  useEffect(() => { if (needsCode) codeBox.current?.focus(); }, [needsCode]);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    try {
      await api<OwnAccount>('POST', '/api/auth/login', needsCode ? { login, password, totp: code } : { login, password });
      await refresh();
      navigate(safeNext(next, '/'));
    } catch (error) {
      if (!(error instanceof ApiError)) {
        announce("We couldn't sign you in. Try again.", true);
      } else if (error.code === 'TOTP_REQUIRED') {
        setNeedsCode(true);
        setErrors({});
      } else if (error.fields.totp) {
        setErrors({ totp: error.fields.totp });
        setTries((n) => n + 1);
      } else if (error.code === 'RATE_LIMITED') {
        announce('Too many failed sign-ins. Try again later or reset your password.', true);
      } else if (error.code === 'SUSPENDED') {
        announce('This account is suspended', true);
      } else if (error.code === 'UNAUTHENTICATED') {
        announce('Email or password is incorrect', true);
      } else {
        announce("We couldn't sign you in. Try again.", true);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="narrow form-card">
      <h1>Sign in</h1>
      <form ref={form} onSubmit={(e) => void submit(e)} noValidate>
        {!needsCode ? (
          <>
            <Field label="Email or username">
              {(p) => <input {...p} type="text" name="login" autoComplete="username" value={login} onChange={(e) => setLogin(e.target.value)} />}
            </Field>
            <Field label="Password">
              {(p) => <input {...p} type="password" name="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />}
            </Field>
          </>
        ) : (
          <Field label="Authentication code" error={errors.totp} hint="Enter the 6-digit code from your authenticator app">
            {(p) => <input {...p} ref={codeBox} type="text" name="totp" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} />}
          </Field>
        )}
        <div className="form-actions">
          <Button type="submit" variant="primary" busy={busy} disabled={busy}>
            {needsCode ? 'Verify' : busy ? 'Signing in...' : 'Sign in'}
          </Button>
        </div>
      </form>
      <p><Link to="/forgot">Forgot your password?</Link></p>
      <p>New here? <Link to="/signup">Create account</Link></p>
    </div>
  );
}

export function VerifyPage(_props: Record<string, unknown>): React.JSX.Element {
  pageTitle('Confirm your email');
  const { refresh } = useSession();
  const token = useSearch().get('token');
  const [state, setState] = useState<'checking' | 'done' | 'expired'>('checking');
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (token === null) {
      setState('expired');
      return;
    }
    api('POST', '/api/auth/verify', { token }).then(
      async () => { setState('done'); await refresh(); },
      () => setState('expired'),
    );
  }, [token, refresh]);

  return (
    <div className="narrow form-card">
      {state === 'checking' && <p>Checking your link...</p>}
      {state === 'done' && (
        <>
          <h1>Email confirmed</h1>
          <p>Your address is confirmed. You can vote, post and reply now.</p>
          <p><Link to="/">Go to the home feed</Link></p>
        </>
      )}
      {state === 'expired' && (
        <>
          <h1>This link has expired or was already used</h1>
          <p>Sign in and use “Resend email” to get a fresh link.</p>
          <p><Link to="/login">Sign in</Link></p>
        </>
      )}
    </div>
  );
}

export function ForgotPage(_props: Record<string, unknown>): React.JSX.Element {
  pageTitle('Reset your password');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    try {
      await api('POST', '/api/auth/password-reset', { email });
      setSent(true);
    } catch {
      announce("We couldn't send the link. Try again.", true);
    } finally {
      setBusy(false);
    }
  };
  if (sent) {
    return (
      <div className="narrow form-card">
        <h1>Check your inbox</h1>
        <p>If that address has an account, a reset link is on its way.</p>
      </div>
    );
  }
  return (
    <div className="narrow form-card">
      <h1>Reset your password</h1>
      <form onSubmit={(e) => void submit(e)} noValidate>
        <Field label="Email">
          {(p) => <input {...p} type="email" name="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />}
        </Field>
        <div className="form-actions">
          <Button type="submit" variant="primary" busy={busy} disabled={busy}>{busy ? 'Sending...' : 'Send reset link'}</Button>
        </div>
      </form>
    </div>
  );
}

export function ResetPage(_props: Record<string, unknown>): React.JSX.Element {
  pageTitle('Choose a new password');
  const token = useSearch().get('token') ?? '';
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [tries, setTries] = useState(0);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  useFocusFirstInvalid(form, tries);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    try {
      await api('POST', '/api/auth/password-reset/confirm', { token, newPassword: password });
      setDone(true);
    } catch (error) {
      const fields = fieldsOf(error);
      if (fields.token) {
        setErrors({ token: 'This link has expired or was already used' });
      } else if (fields.newPassword) {
        setErrors({ newPassword: fields.newPassword });
        setTries((n) => n + 1);
      } else {
        announce("We couldn't update the password. Try again.", true);
      }
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className="narrow form-card">
        <h1>Password updated</h1>
        <p>Every session was signed out. Sign in with your new password.</p>
        <p><Link to="/login" className="btn btn-primary">Sign in</Link></p>
      </div>
    );
  }
  return (
    <div className="narrow form-card">
      <h1>Choose a new password</h1>
      {errors.token && <div className="banner banner-warn"><p>{errors.token}</p><p><Link to="/forgot">Send a new reset link</Link></p></div>}
      <form ref={form} onSubmit={(e) => void submit(e)} noValidate>
        <Field label="New password" error={errors.newPassword}>
          {(p) => <input {...p} type="password" name="newPassword" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />}
        </Field>
        <div className="form-actions">
          <Button type="submit" variant="primary" busy={busy} disabled={busy}>Set new password</Button>
        </div>
      </form>
    </div>
  );
}

export function TwoFactorPage(_props: Record<string, unknown>): React.JSX.Element {
  pageTitle('Two-factor authentication');
  const { user, loading, refresh } = useSession();
  const next = useSearch().get('next');
  const [secret, setSecret] = useState<string | null>(null);
  const [alreadyOn, setAlreadyOn] = useState(false);
  const [code, setCode] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [tries, setTries] = useState(0);
  const [busy, setBusy] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const started = useRef(false);
  useFocusFirstInvalid(form, tries);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      navigate(`/login?next=${encodeURIComponent(location.pathname + location.search)}`, true);
      return;
    }
    if (started.current) return;
    started.current = true;
    api<{ secret: string }>('POST', '/api/me/totp/setup').then(
      (setup) => setSecret(setup.secret),
      (error: unknown) => {
        if (error instanceof ApiError && error.code === 'CONFLICT') setAlreadyOn(true);
        else announce("Two-factor setup isn't available right now", true);
      },
    );
  }, [loading, user]);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    try {
      await api('POST', '/api/me/totp/enable', { code });
      announce('Two-factor authentication is on');
      await refresh();
      navigate(safeNext(next, '/settings'));
    } catch (error) {
      if (error instanceof ApiError && error.status === 422) {
        setErrors({ code: "That code didn't match" });
        setTries((n) => n + 1);
      } else {
        announce("We couldn't turn on two-factor authentication. Try again.", true);
      }
    } finally {
      setBusy(false);
    }
  };

  if (loading || (!secret && !alreadyOn)) return <Skeleton rows={2} />;
  if (alreadyOn) {
    return (
      <div className="narrow form-card">
        <h1>Two-factor authentication is on</h1>
        <p><Link to={safeNext(next, '/settings')}>Continue</Link></p>
      </div>
    );
  }
  return (
    <div className="narrow form-card">
      <h1>Set up two-factor authentication</h1>
      <p>Add this secret to an authenticator app, then enter the 6-digit code it shows.</p>
      <p id="totp-label" className="field-label">Secret</p>
      <code id="totp-secret" className="secret" aria-labelledby="totp-label">{secret}</code>
      <form ref={form} onSubmit={(e) => void submit(e)} noValidate>
        <Field label="Authentication code" error={errors.code}>
          {(p) => <input {...p} type="text" name="code" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} />}
        </Field>
        <div className="form-actions">
          <Button type="submit" variant="primary" busy={busy} disabled={busy}>Turn on two-factor authentication</Button>
        </div>
      </form>
    </div>
  );
}

export function SettingsPage(_props: Record<string, unknown>): React.JSX.Element {
  pageTitle('Settings');
  const { user, loading } = useSession();
  useEffect(() => {
    if (!loading && !user) navigate('/login?next=%2Fsettings', true);
  }, [loading, user]);
  if (!user) return <Skeleton rows={2} />;
  return (
    <div className="narrow form-card">
      <h1>Settings</h1>
      <dl className="kv">
        <dt>Username</dt>
        <dd>{user.username}</dd>
      </dl>
      <p className="muted">Usernames can't be changed</p>
      <h2>Two-factor authentication</h2>
      {user.totpEnabled
        ? <p>Two-factor authentication is on.</p>
        : <p><Link to="/settings/2fa">Set up two-factor authentication</Link></p>}
    </div>
  );
}
