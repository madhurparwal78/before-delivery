// The signed-out screens: one centred column on the indigo ground, no island.
import type { ComponentChildren } from 'preact';
import { useLayoutEffect, useState } from 'preact/hooks';
import { api } from './api';
import { Mark } from './icons';
import { navigate, query, signIn } from './store';
import { Button, Field, invalid, useBusy, type FieldErrors } from './ui';

function zoneList(current: string): string[] {
  const zones = new Set(Intl.supportedValuesOf('timeZone'));
  zones.add('UTC');
  if (current) zones.add(current);
  return [...zones].sort();
}

const browserZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

export function ZoneSelect({ id, value, error, onChange }: { id: string; value: string; error?: string | undefined; onChange: (zone: string) => void }) {
  return (
    <Field id={id} label="Time zone" error={error}>
      <select id={id} value={value} onChange={(e) => onChange(e.currentTarget.value)} {...invalid(id, error)}>
        {zoneList(value).map((z) => (
          <option key={z} value={z}>
            {z}
          </option>
        ))}
      </select>
    </Field>
  );
}

function Screen({ title, lede, children }: { title: string; lede?: string; children: ComponentChildren }) {
  return (
    <main class="public-screen">
      <div class="column">
        <p class="wordmark">
          <Mark />
          Saltreach
        </p>
        <h1>{title}</h1>
        {lede && <p class="lede">{lede}</p>}
        {children}
      </div>
    </main>
  );
}

function Link({ href, children }: { href: string; children: ComponentChildren }) {
  return (
    <a
      class="link"
      href={href}
      onClick={(e) => {
        e.preventDefault();
        navigate(href);
      }}
    >
      {children}
    </a>
  );
}

export function SignUp() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [timeZone, setTimeZone] = useState(browserZone);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, run] = useBusy();
  const submit = (e: Event): void => {
    e.preventDefault();
    void run({
      pending: 'Creating your island…',
      run: () => api.post('/api/auth/signup', { email, password, displayName, timeZone }),
      success: () => `Check your inbox at ${email}. Your confirmation link may take a few minutes to arrive.`,
      fields: setErrors,
    });
  };
  return (
    <Screen title="Make your island" lede="One village on the salt flats, raided while you sleep and replayed tick by tick.">
      <form onSubmit={submit} noValidate>
        <Field id="su-email" label="Email" error={errors.email}>
          <input id="su-email" type="email" autocomplete="email" value={email} onInput={(e) => setEmail(e.currentTarget.value)} {...invalid('su-email', errors.email)} />
        </Field>
        <Field id="su-password" label="Password" error={errors.password}>
          <input id="su-password" type="password" autocomplete="new-password" value={password} onInput={(e) => setPassword(e.currentTarget.value)} {...invalid('su-password', errors.password)} />
        </Field>
        <Field id="su-name" label="Display name" error={errors.displayName}>
          <input id="su-name" type="text" autocomplete="nickname" value={displayName} onInput={(e) => setDisplayName(e.currentTarget.value)} {...invalid('su-name', errors.displayName)} />
        </Field>
        <ZoneSelect id="su-zone" value={timeZone} error={errors.timeZone} onChange={setTimeZone} />
        <div class="form-actions">
          <Button type="submit" variant="primary" busy={busy}>
            Create island
          </Button>
        </div>
      </form>
      <nav class="aside-links" aria-label="Account">
        <Link href="/signin">Sign in instead</Link>
      </nav>
    </Screen>
  );
}

export function SignIn() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, run] = useBusy();
  const [resending, resend] = useBusy();
  const submit = (e: Event): void => {
    e.preventDefault();
    void run({
      pending: 'Signing in…',
      run: () => signIn(email, password),
      errors: { invalid_credentials: "That email and password don't match an account." },
      fields: setErrors,
    }).then((me) => {
      if (me) navigate(me.role === 'operator' ? '/ops' : '/');
    });
  };
  const sendLink = (): void => {
    void resend({
      pending: 'Sending…',
      run: () => api.post('/api/auth/resend-verification', { email }),
      success: () => `A fresh confirmation link is on its way to ${email}. It may take a few minutes.`,
      fields: setErrors,
    });
  };
  return (
    <Screen title="Back to the flats" lede="Sign in to tend your island.">
      <form onSubmit={submit} noValidate>
        <Field id="si-email" label="Email" error={errors.email}>
          <input id="si-email" type="email" autocomplete="email" value={email} onInput={(e) => setEmail(e.currentTarget.value)} {...invalid('si-email', errors.email)} />
        </Field>
        <Field id="si-password" label="Password" error={errors.password}>
          <input id="si-password" type="password" autocomplete="current-password" value={password} onInput={(e) => setPassword(e.currentTarget.value)} {...invalid('si-password', errors.password)} />
        </Field>
        <div class="form-actions">
          <Button type="submit" variant="primary" busy={busy}>
            Sign in
          </Button>
          <Button busy={resending} onClick={sendLink}>
            Send a new confirmation link
          </Button>
        </div>
      </form>
      <nav class="aside-links" aria-label="Account">
        <Link href="/forgot">Forgot password?</Link>
        <Link href="/signup">Create an account</Link>
      </nav>
    </Screen>
  );
}

export function Forgot() {
  const [email, setEmail] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, run] = useBusy();
  const submit = (e: Event): void => {
    e.preventDefault();
    void run({
      pending: 'Sending…',
      run: () => api.post('/api/auth/forgot', { email }),
      success: () => `A reset link is on its way to ${email}. It works once and expires soon.`,
      fields: setErrors,
    });
  };
  return (
    <Screen title="Reset your password" lede="We'll mail a link that works once.">
      <form onSubmit={submit} noValidate>
        <Field id="fg-email" label="Email" error={errors.email}>
          <input id="fg-email" type="email" autocomplete="email" value={email} onInput={(e) => setEmail(e.currentTarget.value)} {...invalid('fg-email', errors.email)} />
        </Field>
        <div class="form-actions">
          <Button type="submit" variant="primary" busy={busy}>
            Send reset link
          </Button>
        </div>
      </form>
      <nav class="aside-links" aria-label="Account">
        <Link href="/signin">Sign in</Link>
      </nav>
    </Screen>
  );
}

export function Reset() {
  const token = query('token') ?? '';
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, run] = useBusy();
  const submit = (e: Event): void => {
    e.preventDefault();
    void run({
      pending: 'Saving…',
      run: () => api.post('/api/auth/reset', { token, password }),
      success: () => 'Password changed. Sign in with your new password.',
      errors: { invalid_token: 'This reset link has expired or was already used.' },
      fields: setErrors,
    });
  };
  return (
    <Screen title="Choose a new password" lede="Use 10 to 128 characters. Every signed-in tab will be signed out.">
      <form onSubmit={submit} noValidate>
        <Field id="rs-password" label="New password" error={errors.password}>
          <input id="rs-password" type="password" autocomplete="new-password" value={password} onInput={(e) => setPassword(e.currentTarget.value)} {...invalid('rs-password', errors.password)} />
        </Field>
        {errors.token && <p class="field-error">{errors.token}</p>}
        <div class="form-actions">
          <Button type="submit" variant="primary" busy={busy}>
            Set new password
          </Button>
        </div>
      </form>
      <nav class="aside-links" aria-label="Account">
        <Link href="/signin">Sign in</Link>
        <Link href="/forgot">Request a new link</Link>
      </nav>
    </Screen>
  );
}

export function Verify() {
  const [errors, setErrors] = useState<FieldErrors>({});
  const [, run] = useBusy();
  useLayoutEffect(() => {
    void run({
      pending: 'Confirming…',
      run: () => api.post('/api/auth/verify', { token: query('token') ?? '' }),
      success: () => 'Email confirmed. Your island is ready.',
      errors: { invalid_token: 'This link has expired or was already used. Request a new one from the sign-in screen.' },
      fields: setErrors,
    });
  }, []);
  return (
    <Screen title="Confirming your email" lede="Your confirmation link opens your island to raids and clans.">
      {errors.token && <p class="field-error">{errors.token}</p>}
      <nav class="aside-links" aria-label="Account">
        <Link href="/signin">Go to sign in</Link>
      </nav>
    </Screen>
  );
}
