import { type ReactNode, useEffect, useState } from 'react';
import type { Me } from '../../shared/types.js';
import { ApiError, api } from '../lib/api.js';
import { copy, errorCopy } from '../lib/copy.js';
import { Link, navigate, useLocation } from '../lib/router.js';
import { store } from '../lib/store.js';
import { Bean } from '../lib/ui.js';

interface CardProps {
  title: string;
  children: ReactNode;
}

function AccountCard({ title, children }: CardProps) {
  return (
    <div className="account-page">
      <p className="product-name">
        <Bean hue={200} size={38} />
        Pratfall Cup
        <Bean hue={310} size={38} />
      </p>
      <main className="card account-card">
        <h1>{title}</h1>
        {children}
      </main>
    </div>
  );
}

interface FieldProps {
  label: string;
  type?: string;
  value: string;
  error?: string;
  autoComplete?: string;
  onChange: (value: string) => void;
}

function Field({ label, type = 'text', value, error, autoComplete, onChange }: FieldProps) {
  const id = `field-${label.toLowerCase().replace(/[^a-z]+/g, '-')}`;
  return (
    <p className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type={type}
        value={value}
        autoComplete={autoComplete}
        aria-describedby={error === undefined ? undefined : `${id}-error`}
        aria-invalid={error === undefined ? undefined : true}
        onChange={(event) => onChange(event.target.value)}
      />
      {error === undefined ? null : (
        <span className="field-error" id={`${id}-error`}>
          {error}
        </span>
      )}
    </p>
  );
}

interface NoticesProps {
  notice: string;
}

export function Notices({ notice }: NoticesProps) {
  return (
    <div role="status" aria-label="Notices" aria-live="polite" className="notices">
      {notice}
    </div>
  );
}

export function SignUpPage() {
  const [email, setEmail] = useState('');
  const [handle, setHandle] = useState('');
  const [password, setPassword] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState('');
  const [pendingCopy, setPendingCopy] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (): Promise<void> => {
    setBusy(true);
    setPendingCopy(copy.creatingAccount);
    setFields({});
    try {
      const payload = await api.post<{ user: Me; verificationEmail: 'sent' | 'failed' }>(
        '/api/auth/signup',
        { email, handle, password },
      );
      await store.load();
      store.notice(
        payload.verificationEmail === 'sent'
          ? copy.accountCreatedMailSent(payload.user.email)
          : copy.accountCreatedMailFailed,
      );
      navigate('/');
    } catch (error) {
      if (error instanceof ApiError && error.code === 'validation_failed') {
        setFields(error.fields);
        setNotice(copy.checkFields);
      } else if (error instanceof ApiError && error.code === 'email_taken') {
        setFields({ email: copy.emailTaken });
        setNotice(copy.checkFields);
      } else if (error instanceof ApiError && error.code === 'handle_taken') {
        setFields({ handle: copy.handleTaken });
        setNotice(copy.checkFields);
      } else {
        setNotice(errorCopy(error));
      }
      setBusy(false);
      setPendingCopy('');
    }
  };

  return (
    <AccountCard title="Create account">
      <Notices notice={notice} />
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <Field
          label="Email"
          type="email"
          value={email}
          error={fields.email}
          autoComplete="email"
          onChange={setEmail}
        />
        <Field
          label="Handle"
          value={handle}
          error={fields.handle}
          autoComplete="username"
          onChange={setHandle}
        />
        <Field
          label="Password"
          type="password"
          value={password}
          error={fields.password}
          autoComplete="new-password"
          onChange={setPassword}
        />
        <button type="submit" className="primary" disabled={busy} aria-busy={busy}>
          Create account
        </button>
        {pendingCopy === '' ? null : <p className="pending-copy">{pendingCopy}</p>}
      </form>
      <p className="card-footer">
        <Link to="/signin">Already have an account? Sign in</Link>
      </p>
    </AccountCard>
  );
}

export function SignInPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [notice, setNotice] = useState('');
  const [pendingCopy, setPendingCopy] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (): Promise<void> => {
    setBusy(true);
    setPendingCopy(copy.signingIn);
    try {
      await api.post('/api/auth/login', { email, password });
      await store.load();
      navigate('/');
    } catch (error) {
      setNotice(errorCopy(error, { invalid_credentials: copy.signInFailed }));
      setBusy(false);
      setPendingCopy('');
    }
  };

  return (
    <AccountCard title="Sign in">
      <Notices notice={notice} />
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <Field label="Email" type="email" value={email} autoComplete="email" onChange={setEmail} />
        <Field
          label="Password"
          type="password"
          value={password}
          autoComplete="current-password"
          onChange={setPassword}
        />
        <button type="submit" className="primary" disabled={busy} aria-busy={busy}>
          Sign in
        </button>
        {pendingCopy === '' ? null : <p className="pending-copy">{pendingCopy}</p>}
      </form>
      <p className="card-footer">
        <Link to="/forgot-password">Forgot password?</Link>
      </p>
      <p className="card-footer">
        <Link to="/signup">Create an account</Link>
      </p>
    </AccountCard>
  );
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState('');
  const [pendingCopy, setPendingCopy] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (): Promise<void> => {
    setBusy(true);
    setPendingCopy(copy.sending);
    setFields({});
    try {
      await api.post('/api/auth/password-reset', { email });
      setNotice(copy.resetLinkSent);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'validation_failed') {
        setFields(error.fields);
        setNotice(copy.checkFields);
      } else {
        setNotice(errorCopy(error, { mail_unavailable: copy.mailDown }));
      }
    }
    setBusy(false);
    setPendingCopy('');
  };

  return (
    <AccountCard title="Forgot password">
      <Notices notice={notice} />
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <Field
          label="Email"
          type="email"
          value={email}
          error={fields.email}
          autoComplete="email"
          onChange={setEmail}
        />
        <button type="submit" className="primary" disabled={busy} aria-busy={busy}>
          Send reset link
        </button>
        {pendingCopy === '' ? null : <p className="pending-copy">{pendingCopy}</p>}
      </form>
      <p className="card-footer">
        <Link to="/signin">Back to sign in</Link>
      </p>
    </AccountCard>
  );
}

export function ResetPasswordPage() {
  const { search } = useLocation();
  const token = search.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState('');
  const [pendingCopy, setPendingCopy] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (): Promise<void> => {
    setBusy(true);
    setPendingCopy(copy.saving);
    setFields({});
    try {
      await api.post('/api/auth/password-reset/confirm', { token, password });
      setNotice(copy.passwordChanged);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'validation_failed') {
        setFields({ password: copy.passwordField });
        setNotice(copy.checkFields);
      } else {
        setNotice(
          errorCopy(error, {
            link_expired: copy.linkExpired,
            link_invalid: copy.linkInvalid,
          }),
        );
      }
    }
    setBusy(false);
    setPendingCopy('');
  };

  return (
    <AccountCard title="Set a new password">
      <Notices notice={notice} />
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <Field
          label="New password"
          type="password"
          value={password}
          error={fields.password}
          autoComplete="new-password"
          onChange={setPassword}
        />
        <button type="submit" className="primary" disabled={busy} aria-busy={busy}>
          Set new password
        </button>
        {pendingCopy === '' ? null : <p className="pending-copy">{pendingCopy}</p>}
      </form>
      <p className="card-footer">
        <Link to="/signin">Back to sign in</Link>
      </p>
    </AccountCard>
  );
}

export function VerifyPage() {
  const { search } = useLocation();
  const token = search.get('token') ?? '';
  const [message, setMessage] = useState(copy.checkingLink);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const run = async (): Promise<void> => {
      try {
        await api.post('/api/auth/verify', { token });
        if (!cancelled) {
          setMessage(copy.emailVerified);
          setDone(true);
        }
      } catch (error) {
        if (cancelled) return;
        setMessage(
          errorCopy(error, { link_expired: copy.linkExpired, link_invalid: copy.linkInvalid }),
        );
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <AccountCard title="Verify your email">
      <section aria-label="Verification" className="verification">
        <p>{message}</p>
      </section>
      <Notices notice={message} />
      <p className="card-footer">
        {done ? (
          <a href="/" className="primary button-link">
            Go to Pratfall Cup
          </a>
        ) : (
          <Link to="/signin">Back to sign in</Link>
        )}
      </p>
    </AccountCard>
  );
}
