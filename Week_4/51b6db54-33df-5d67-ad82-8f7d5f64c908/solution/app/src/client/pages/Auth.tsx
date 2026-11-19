import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { api, refusal, type ApiResult } from '../api';
import { navigate } from '../router';
import { loadMe } from '../session';
import { notify, raise, clearAlerts } from '../ui';
import { Shell } from './Shell';

const nextPath = (): string => {
  const next = new URLSearchParams(location.search).get('next');
  return next?.startsWith('/') && !next.startsWith('//') ? next : '/projects';
};

function FieldError({ text }: { text?: string }): JSX.Element | null {
  return text ? <p class="field-error">{text}</p> : null;
}

export function SignUp(): JSX.Element {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [email, setEmail] = useState('');
  const [waiting, setWaiting] = useState(false);

  const create = async (event: Event): Promise<void> => {
    event.preventDefault();
    const form = new FormData(event.currentTarget as HTMLFormElement);
    clearAlerts();
    setPending(true);
    const result = await api('POST', '/api/auth/signup', { name: form.get('name'), email: form.get('email'), password: form.get('password') });
    setPending(false);
    if (!result.ok) return fail(result);
    setErrors({});
    setEmail(String(form.get('email')));
    setWaiting(true);
    notify(`We are sending your code to ${String(form.get('email'))}`);
  };

  const fail = (result: ApiResult): void => {
    const { message, fields } = refusal(result);
    setErrors(fields);
    raise(message);
  };

  const submitCode = async (event: Event): Promise<void> => {
    event.preventDefault();
    const form = new FormData(event.currentTarget as HTMLFormElement);
    clearAlerts();
    setPending(true);
    const result = await api('POST', '/api/auth/confirm', { email, code: form.get('code') });
    setPending(false);
    if (!result.ok) return fail(result);
    await loadMe();
    navigate(nextPath());
  };

  return (
    <Shell>
      <main class="narrow">
        <h1 class="page-title">Create your account</h1>
        <form class="card" onSubmit={(event) => void create(event)} noValidate>
          <label class="field-label">
            Name
            <input class="input" name="name" type="text" autocomplete="name" required aria-invalid={errors.name ? 'true' : undefined} />
          </label>
          <FieldError text={errors.name} />
          <label class="field-label">
            Email
            <input class="input" name="email" type="email" autocomplete="email" required aria-invalid={errors.email ? 'true' : undefined} />
          </label>
          <FieldError text={errors.email} />
          <label class="field-label">
            Password
            <input class="input" name="password" type="password" autocomplete="new-password" required aria-invalid={errors.password ? 'true' : undefined} />
          </label>
          <FieldError text={errors.password} />
          <button class="pill" type="submit" disabled={pending}>
            Create account
          </button>
        </form>
        {waiting && (
          <form class="card" onSubmit={(event) => void submitCode(event)} noValidate>
            <label class="field-label">
              Code
              <input class="input" name="code" type="text" inputMode="numeric" autocomplete="one-time-code" required data-autofocus aria-invalid={errors.code ? 'true' : undefined} />
            </label>
            <FieldError text={errors.code} />
            <button class="pill" type="submit" disabled={pending}>
              Confirm
            </button>
          </form>
        )}
        <p class="aside">
          Already have an account?{' '}
          <a href="/signin" data-route>
            Sign in
          </a>
        </p>
      </main>
    </Shell>
  );
}

export function SignIn(): JSX.Element {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const submit = async (event: Event): Promise<void> => {
    event.preventDefault();
    const form = new FormData(event.currentTarget as HTMLFormElement);
    clearAlerts();
    setPending(true);
    const result = await api('POST', '/api/auth/login', { email: form.get('email'), password: form.get('password') });
    setPending(false);
    if (!result.ok) {
      const { message, fields } = refusal(result);
      setErrors(fields);
      raise(message);
      return;
    }
    await loadMe();
    navigate(nextPath());
  };
  return (
    <Shell>
      <main class="narrow">
        <h1 class="page-title">Sign in</h1>
        <form class="card" onSubmit={(event) => void submit(event)} noValidate>
          <label class="field-label">
            Email
            <input class="input" name="email" type="email" autocomplete="email" required aria-invalid={errors.email ? 'true' : undefined} />
          </label>
          <FieldError text={errors.email} />
          <label class="field-label">
            Password
            <input class="input" name="password" type="password" autocomplete="current-password" required aria-invalid={errors.password ? 'true' : undefined} />
          </label>
          <FieldError text={errors.password} />
          <button class="pill" type="submit" disabled={pending}>
            Sign in
          </button>
        </form>
        <p class="aside">
          New to Celmate?{' '}
          <a href="/signup" data-route>
            Create an account
          </a>
        </p>
      </main>
    </Shell>
  );
}
