import { useEffect, useState } from 'react';
import { STUDIO_TIME_ZONES } from '../../shared/api';
import { copy } from '../../shared/copy';
import { ApiFailure, errorCopy, request } from '../api';
import { AppLink, Announcements, announce, navigate, Wordmark } from '../shell';

function storeEmail(email: string): void {
  window.sessionStorage.setItem('corbel-pending-email', email);
}

function pendingEmail(): string {
  return window.sessionStorage.getItem('corbel-pending-email') ?? '';
}

export function SignupPage(): JSX.Element {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [timeZone, setTimeZone] = useState('UTC');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setPending(true);
    setErrors({});
    setFormError(null);
    try {
      const result = await request<{ email_status: 'sent' | 'not_sent' }>('POST', '/api/auth/signup', {
        name,
        email,
        password,
        time_zone: timeZone,
      });
      storeEmail(email);
      window.sessionStorage.setItem('corbel-mail-status', result.email_status);
      navigate('/check-inbox');
    } catch (failure) {
      if (failure instanceof ApiFailure && failure.errors !== null) setErrors(failure.errors);
      else if (failure instanceof ApiFailure) setFormError(errorCopy(failure));
      setPending(false);
    }
  };

  return (
    <div className="auth-page">
      <Announcements />
      <div className="auth-card">
        <AppLink to="/">
          <Wordmark />
        </AppLink>
        <h1>Create account</h1>
        <form aria-label="Create account" onSubmit={submit} noValidate>
          {formError !== null ? <div className="alert" role="alert">{formError}</div> : null}
          <div className="field">
            <label htmlFor="signup-name">Name</label>
            <input
              id="signup-name"
              name="name"
              autoComplete="name"
              value={name}
              aria-invalid={errors.name !== undefined}
              aria-describedby={errors.name !== undefined ? 'signup-name-error' : undefined}
              onChange={(event) => setName(event.target.value)}
            />
            {errors.name !== undefined ? (
              <span className="field-error" id="signup-name-error">
                {errors.name}
              </span>
            ) : null}
          </div>
          <div className="field">
            <label htmlFor="signup-email">Email</label>
            <input
              id="signup-email"
              name="email"
              type="email"
              autoComplete="email"
              value={email}
              aria-invalid={errors.email !== undefined}
              aria-describedby={errors.email !== undefined ? 'signup-email-error' : undefined}
              onChange={(event) => setEmail(event.target.value)}
            />
            {errors.email !== undefined ? (
              <span className="field-error" id="signup-email-error">
                {errors.email}
              </span>
            ) : null}
          </div>
          <div className="field">
            <label htmlFor="signup-password">Password</label>
            <input
              id="signup-password"
              name="password"
              type="password"
              autoComplete="new-password"
              value={password}
              aria-invalid={errors.password !== undefined}
              aria-describedby={errors.password !== undefined ? 'signup-password-error' : undefined}
              onChange={(event) => setPassword(event.target.value)}
            />
            {errors.password !== undefined ? (
              <span className="field-error" id="signup-password-error">
                {errors.password}
              </span>
            ) : null}
          </div>
          <div className="field">
            <label htmlFor="signup-zone">Studio time zone</label>
            <select
              id="signup-zone"
              name="time_zone"
              value={timeZone}
              aria-invalid={errors.time_zone !== undefined}
              onChange={(event) => setTimeZone(event.target.value)}
            >
              {STUDIO_TIME_ZONES.map((zone) => (
                <option key={zone} value={zone}>
                  {zone}
                </option>
              ))}
            </select>
            {errors.time_zone !== undefined ? <span className="field-error">{errors.time_zone}</span> : null}
          </div>
          <button type="submit" className="btn" disabled={pending}>
            {pending ? copy.account.createPending : 'Create account'}
          </button>
        </form>
        <p style={{ marginTop: '1rem' }}>
          Already drafting with us? <AppLink to="/signin">Sign in</AppLink>
        </p>
      </div>
    </div>
  );
}

function ResendButton(props: { email: string; label: string }): JSX.Element {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(
    window.sessionStorage.getItem('corbel-mail-status') === 'not_sent'
      ? copy.account.confirmationMailNotSent
      : null,
  );

  const send = async (): Promise<void> => {
    setPending(true);
    try {
      await request('POST', '/api/auth/verify/resend', { email: props.email });
      const text = copy.account.resendAccepted(props.email);
      setMessage(text);
      announce(text);
      window.sessionStorage.setItem('corbel-mail-status', 'sent');
    } catch (failure) {
      if (failure instanceof ApiFailure) {
        setMessage(errorCopy(failure, 'verify'));
        announce(errorCopy(failure, 'verify'));
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      {message !== null ? <p role="alert">{message}</p> : null}
      <button type="button" className="btn btn-outline" disabled={pending} onClick={() => void send()}>
        {props.label}
      </button>
    </>
  );
}

export function CheckInboxPage(): JSX.Element {
  const email = pendingEmail();
  return (
    <div className="auth-page">
      <Announcements />
      <div className="auth-card">
        <h1>{copy.account.checkInboxHeading}</h1>
        <p>{copy.account.checkInboxBody(email)}</p>
        <ResendButton email={email} label="Send a new link" />
      </div>
    </div>
  );
}

export function VerifyPage(props: { token: string }): JSX.Element {
  const [state, setState] = useState<
    { kind: 'pending' } | { kind: 'done'; email: string } | { kind: 'failed'; message: string; email: string }
  >({ kind: 'pending' });

  useEffect(() => {
    request<{ verified: boolean; email: string }>('POST', '/api/auth/verify', { token: props.token })
      .then((result) => {
        setState({ kind: 'done', email: result.email });
        storeEmail(result.email);
      })
      .catch((failure: unknown) => {
        if (failure instanceof ApiFailure) {
          setState({
            kind: 'failed',
            message:
              failure.code === 'not_found' ? copy.account.verifyUnknown : errorCopy(failure, 'verify'),
            email: String(failure.extra.email ?? ''),
          });
        }
      });
  }, [props.token]);

  return (
    <div className="auth-page">
      <Announcements />
      <div className="auth-card">
        {state.kind === 'pending' ? <p>Checking your link…</p> : null}
        {state.kind === 'done' ? (
          <>
            <h1>{copy.account.verifyConfirmed}</h1>
            <AppLink to="/signin" className="btn">
              Sign in
            </AppLink>
          </>
        ) : null}
        {state.kind === 'failed' ? (
          <>
            <h1>{state.message}</h1>
            {state.message === copy.account.verifyUnknown ? null : (
              <ResendButton email={state.email} label="Send a new link" />
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}

export function SigninPage(): JSX.Element {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [unconfirmed, setUnconfirmed] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setPending(true);
    setFormError(null);
    setUnconfirmed(null);
    try {
      await request('POST', '/api/auth/signin', { email, password });
      navigate('/drawings');
    } catch (failure) {
      if (failure instanceof ApiFailure) {
        setFormError(errorCopy(failure));
        if (failure.code === 'unverified') setUnconfirmed(String(failure.extra.email ?? email));
      }
      setPending(false);
    }
  };

  return (
    <div className="auth-page">
      <Announcements />
      <div className="auth-card">
        <AppLink to="/">
          <Wordmark />
        </AppLink>
        <h1>Sign in</h1>
        <form aria-label="Sign in" onSubmit={submit} noValidate>
          {formError !== null ? (
            <div className="alert" role="alert">
              {formError}
            </div>
          ) : null}
          <div className="field">
            <label htmlFor="signin-email">Email</label>
            <input
              id="signin-email"
              name="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="signin-password">Password</label>
            <input
              id="signin-password"
              name="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
          <button type="submit" className="btn" disabled={pending}>
            {pending ? copy.account.signInPending : 'Sign in'}
          </button>
          {unconfirmed !== null ? <ResendButton email={unconfirmed} label="Resend link" /> : null}
        </form>
        <p style={{ marginTop: '1rem' }}>
          New here? <AppLink to="/signup">Create account</AppLink>
        </p>
      </div>
    </div>
  );
}

export function OpenLinkPage(): JSX.Element {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  const open = (event: React.FormEvent): void => {
    event.preventDefault();
    const match = /\/s\/([A-Za-z0-9_-]+)/.exec(value.trim());
    const token = match !== null ? match[1]! : value.trim();
    if (token === '') {
      setError(copy.access.unknownHeading);
      return;
    }
    navigate(`/s/${token}`);
  };

  return (
    <div className="auth-page">
      <Announcements />
      <div className="auth-card">
        <AppLink to="/">
          <Wordmark />
        </AppLink>
        <h1>Open a shared drawing</h1>
        <form onSubmit={open} noValidate>
          {error !== null ? (
            <div className="alert" role="alert">
              {error}
            </div>
          ) : null}
          <div className="field">
            <label htmlFor="open-link">Share link</label>
            <input id="open-link" value={value} onChange={(event) => setValue(event.target.value)} />
          </div>
          <button type="submit" className="btn">
            Open
          </button>
        </form>
      </div>
    </div>
  );
}
