import type { ComponentChildren } from 'preact';
import { useId, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { api, HttpError } from '../api.ts';
import { navigate } from '../router.ts';
import { AppBar } from '../ui/AppBar.tsx';
import { Icon } from '../ui/Icon.tsx';
import { Link } from '../ui/Link.tsx';
import { Spinner } from '../ui/Spinner.tsx';
import { usePageHeading } from '../ui/usePageHeading.ts';

type Mode = 'signup' | 'signin';

/** The published form-level sentences, by error code. */
const FORM_ERRORS: Partial<Record<string, string>> = {
  username_taken: 'That username is taken.',
  bad_credentials: 'Wrong username or password.',
  rate_limited: 'Too many sign-in attempts. Try again in a minute.',
};

interface Failure {
  band: string | null;
  fields: Record<string, string>;
}

function AccountForm({ mode }: { mode: Mode }) {
  const signup = mode === 'signup';
  const heading = usePageHeading();
  const ids = useId();
  const username = useRef<HTMLInputElement>(null);
  const password = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<Failure>({ band: null, fields: {} });
  const [focusField, setFocusField] = useState<'username' | 'password' | null>(null);

  useLayoutEffect(() => {
    if (focusField === 'username') username.current?.focus();
    else if (focusField === 'password') password.current?.focus();
  }, [focusField, failure]);

  const submit = async (event: Event): Promise<void> => {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setFailure({ band: null, fields: {} });
    setFocusField(null);
    try {
      await api('POST', signup ? '/api/auth/signup' : '/api/auth/login', {
        username: username.current?.value ?? '',
        password: password.current?.value ?? '',
      });
      navigate('/maps');
    } catch (error) {
      if (error instanceof HttpError) {
        const band = FORM_ERRORS[error.code] ?? (Object.keys(error.fields).length > 0 ? null : error.message);
        setFailure({ band, fields: error.fields });
        setFocusField(error.fields.username ? 'username' : error.fields.password ? 'password' : null);
      } else {
        setFailure({ band: 'Something went wrong. Check your connection and try again.', fields: {} });
      }
      setPending(false);
    }
  };

  const usernameError = failure.fields.username;
  const passwordError = failure.fields.password;

  return (
    <div class="auth-page">
      <AppBar />
      <main class="auth-main">
        <div class="auth-card">
          <h1 ref={heading} tabIndex={-1}>
            {signup ? 'Create your account' : 'Welcome back'}
          </h1>
          <p class="auth-lead">{signup ? 'Start a map from one idea and invite a few people to grow it with you.' : 'Sign in to pick your maps up where you left them.'}</p>
          {failure.band ? (
            <div class="notice auth-notice" role="alert">
              <Icon name="circle-alert" size={20} />
              <div>
                <p class="notice-title">{failure.band}</p>
              </div>
            </div>
          ) : null}
          <form class="auth-form" onSubmit={(event) => void submit(event)} noValidate>
            <Field id={`${ids}-u`} label="Username" error={usernameError} hint={signup ? 'Lowercase letters, digits or underscores.' : undefined}>
              <input
                ref={username}
                id={`${ids}-u`}
                class="input"
                type="text"
                name="username"
                autocomplete="username"
                autocapitalize="none"
                spellcheck={false}
                required
                aria-invalid={usernameError ? 'true' : undefined}
                aria-describedby={describe(`${ids}-u`, usernameError, signup)}
              />
            </Field>
            <Field id={`${ids}-p`} label="Password" error={passwordError} hint={signup ? 'At least 8 characters.' : undefined}>
              <input
                ref={password}
                id={`${ids}-p`}
                class="input"
                type="password"
                name="password"
                autocomplete={signup ? 'new-password' : 'current-password'}
                required
                aria-invalid={passwordError ? 'true' : undefined}
                aria-describedby={describe(`${ids}-p`, passwordError, signup)}
              />
            </Field>
            <button type="submit" class="btn btn-primary btn-lg btn-block auth-submit" disabled={pending} aria-busy={pending ? 'true' : undefined}>
              <span class="btn-label">{signup ? 'Create account' : 'Sign in'}</span>
              {pending ? <Spinner /> : null}
            </button>
          </form>
          <p class="auth-switch">
            {signup ? 'Already have an account? ' : 'New to Sprigmap? '}
            <Link href={signup ? '/signin' : '/signup'} class="link">
              {signup ? 'Sign in instead' : 'Create an account'}
            </Link>
          </p>
        </div>
        <svg class="auth-ribbon auth-ribbon-left" viewBox="0 0 160 300" aria-hidden="true" focusable="false">
          <path d="M-20 40C50 40 70 90 124 90" fill="none" stroke="var(--c-indigo)" stroke-width="38" stroke-linecap="round" />
          <path d="M-20 130C50 130 70 170 124 170" fill="none" stroke="var(--c-azure)" stroke-width="38" stroke-linecap="round" />
          <path d="M-20 220C50 220 70 250 124 250" fill="none" stroke="var(--c-teal)" stroke-width="38" stroke-linecap="round" />
        </svg>
        <svg class="auth-ribbon auth-ribbon-right" viewBox="0 0 160 300" aria-hidden="true" focusable="false">
          <path d="M180 40C110 40 90 90 36 90" fill="none" stroke="var(--c-violet)" stroke-width="38" stroke-linecap="round" />
          <path d="M180 130C110 130 90 170 36 170" fill="none" stroke="var(--c-magenta)" stroke-width="38" stroke-linecap="round" />
          <path d="M180 220C110 220 90 250 36 250" fill="none" stroke="var(--c-orange)" stroke-width="38" stroke-linecap="round" />
        </svg>
      </main>
    </div>
  );
}

const describe = (id: string, error: string | undefined, hinted: boolean): string | undefined => {
  const parts = [error ? `${id}-e` : null, hinted ? `${id}-h` : null].filter((p): p is string => p !== null);
  return parts.length > 0 ? parts.join(' ') : undefined;
};

function Field({ id, label, error, hint, children }: { id: string; label: string; error: string | undefined; hint: string | undefined; children: ComponentChildren }) {
  return (
    <div class="field">
      <label class="field-label" for={id}>
        {label}
      </label>
      {children}
      {hint ? (
        <p class="field-hint" id={`${id}-h`}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p class="field-error" id={`${id}-e`}>
          <Icon name="circle-alert" size={18} />
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );
}

export function SignUp() {
  return <AccountForm mode="signup" />;
}

export function SignIn() {
  return <AccountForm mode="signin" />;
}
