import { useState, type FormEvent } from 'react';
import type { Auth } from '../../shared/api';
import { apiPath, request } from '../api';
import { FIELD_COPY, OUTAGE_COPY, refusalCopy } from '../copy';
import { useTitle } from '../hooks';
import { Link, safeNext, useRouter } from '../router';
import { useApp } from '../state';
import { codePoints, ErrorSummary, Field, type FieldErrors } from '../components/forms';

// Sign in and sign up. Both return to `next` when it is a same-origin path.

function useNext(): string | null {
  const { place } = useRouter();
  return new URLSearchParams(place.search).get('next');
}

function withNext(path: string, next: string | null): string {
  return next === null ? path : `${path}?next=${encodeURIComponent(next)}`;
}

function validEmail(email: string): boolean {
  const at = email.indexOf('@');
  return at > 0 && at === email.lastIndexOf('@') && email.slice(at + 1).includes('.');
}

export function SignInPage() {
  useTitle('Sign in');
  const { signedIn, setAccountMessage } = useApp();
  const { navigate } = useRouter();
  const next = useNext();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    const found: FieldErrors = {};
    if (email.trim() === '') found.email = FIELD_COPY.email;
    if (password === '') found.password = FIELD_COPY.signinPassword;
    setErrors(found);
    if (Object.keys(found).length > 0) {
      setAttempt((count) => count + 1);
      return;
    }
    setBusy(true);
    setAccountMessage('Signing in…');
    const result = await request<Auth>(apiPath('/auth/login'), { method: 'POST', body: { email, password } });
    setBusy(false);
    if (result.ok) {
      signedIn(result.data, `Welcome back, ${result.data.account.name}.`);
      navigate(safeNext(next));
      return;
    }
    if (result.error.code === 'invalid' && result.error.fields) {
      setAccountMessage('');
      setErrors({ ...(result.error.fields.email ? { email: FIELD_COPY.email } : {}), ...(result.error.fields.password ? { password: FIELD_COPY.signinPassword } : {}) });
      setAttempt((count) => count + 1);
      return;
    }
    setAccountMessage(result.error.code === 'unavailable' ? OUTAGE_COPY : refusalCopy(result.error.code));
  };

  return (
    <section className="page page-narrow auth-page">
      <h1 className="page-title">Sign in</h1>
      <p className="helper">Sign in to save sessions, reserve workshop seats and send your contest guess.</p>
      <form className="form" noValidate onSubmit={(event) => void submit(event)}>
        <ErrorSummary errors={errors} ids={{ email: 'signin-email', password: 'signin-password' }} attempt={attempt} />
        <Field id="signin-email" label="Email" type="email" autoComplete="email" value={email} error={errors.email} onChange={(event) => setEmail(event.target.value)} />
        <Field
          id="signin-password"
          label="Password"
          type="password"
          autoComplete="current-password"
          value={password}
          error={errors.password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <button type="submit" className="btn btn-primary btn-wide" aria-disabled={busy ? 'true' : undefined}>
          Sign in
        </button>
      </form>
      <p className="auth-switch">
        New to Keel Outpost? <Link to={withNext('/signup', next)}>Create an account</Link>
      </p>
    </section>
  );
}

export function SignUpPage() {
  useTitle('Create an account');
  const { signedIn, setAccountMessage } = useApp();
  const { navigate } = useRouter();
  const next = useNext();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    const found: FieldErrors = {};
    const nameLength = codePoints(name);
    if (nameLength < 1 || nameLength > 80 || name.trim() === '' || name.includes('\n') || name.includes('\r')) found.name = FIELD_COPY.name;
    if (!validEmail(email)) found.email = FIELD_COPY.email;
    const passwordLength = codePoints(password);
    if (passwordLength < 8 || passwordLength > 200) found.password = FIELD_COPY.password;
    setErrors(found);
    if (Object.keys(found).length > 0) {
      setAttempt((count) => count + 1);
      return;
    }
    setBusy(true);
    setAccountMessage('Creating account…');
    const result = await request<Auth>(apiPath('/auth/signup'), { method: 'POST', body: { name, email, password } });
    setBusy(false);
    if (result.ok) {
      signedIn(result.data, `Welcome, ${result.data.account.name}.`);
      navigate(safeNext(next));
      return;
    }
    const code = result.error.code;
    if (code === 'email_taken' || code === 'invalid') {
      setAccountMessage('');
      const fields = result.error.fields ?? {};
      setErrors(
        code === 'email_taken'
          ? { email: refusalCopy('email_taken') }
          : {
              ...(fields.name ? { name: FIELD_COPY.name } : {}),
              ...(fields.email ? { email: FIELD_COPY.email } : {}),
              ...(fields.password ? { password: FIELD_COPY.password } : {}),
            },
      );
      setAttempt((count) => count + 1);
      return;
    }
    setAccountMessage(code === 'unavailable' ? OUTAGE_COPY : refusalCopy(code));
  };

  return (
    <section className="page page-narrow auth-page">
      <h1 className="page-title">Create an account</h1>
      <p className="helper">One account lets you save sessions, reserve seats and join waitlists for full rooms.</p>
      <form className="form" noValidate onSubmit={(event) => void submit(event)}>
        <ErrorSummary errors={errors} ids={{ name: 'signup-name', email: 'signup-email', password: 'signup-password' }} attempt={attempt} />
        <Field id="signup-name" label="Name" type="text" autoComplete="name" value={name} error={errors.name} onChange={(event) => setName(event.target.value)} />
        <Field id="signup-email" label="Email" type="email" autoComplete="email" value={email} error={errors.email} onChange={(event) => setEmail(event.target.value)} />
        <Field
          id="signup-password"
          label="Password"
          type="password"
          autoComplete="new-password"
          value={password}
          error={errors.password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <button type="submit" className="btn btn-primary btn-wide" aria-disabled={busy ? 'true' : undefined}>
          Create account
        </button>
      </form>
      <p className="auth-switch">
        Already registered? <Link to={withNext('/signin', next)}>Sign in instead</Link>
      </p>
    </section>
  );
}
