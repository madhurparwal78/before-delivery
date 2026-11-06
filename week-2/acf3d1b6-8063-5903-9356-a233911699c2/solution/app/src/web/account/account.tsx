import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { checkJoin, checkSignup, type FieldErrors } from '../../shared/rules.js';
import { api } from '../api.js';
import type { Invitation } from '../data.js';
import { Wordmark } from '../public/chrome.js';
import { Art } from '../ui/art.js';
import { ErrorSummary, TextField } from '../ui/field.js';
import { Spinner } from '../ui/spinner.js';

function AccountLayout({ children, phrase }: { children: ComponentChildren; phrase: string }) {
  return (
    <div class="account">
      <header class="account-header">
        <Wordmark />
      </header>
      <main id="main" class="account-main">
        <div class="account-card">{children}</div>
        <Art phrase={phrase} aspect="9:16" class="account-art" />
      </main>
    </div>
  );
}

function focusFirst(errors: FieldErrors, prefix: string) {
  const first = Object.keys(errors)[0];
  if (first) document.getElementById(`${prefix}-${first}`)?.focus();
}

export function SignupPage() {
  const [values, setValues] = useState({ name: '', email: '', password: '' });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  const set = (field: keyof typeof values) => (event: Event) =>
    setValues((current) => ({ ...current, [field]: (event.currentTarget as HTMLInputElement).value }));

  const submit = async (event: Event) => {
    event.preventDefault();
    const checked = checkSignup(values);
    if (!checked.ok) {
      setErrors(checked.errors);
      return focusFirst(checked.errors, 'signup');
    }
    setBusy(true);
    const reply = await api('POST', '/auth/signup', values);
    if (reply.ok) return location.assign('/studio');
    setBusy(false);
    const found = reply.status === 409 ? { email: 'An account with this email already exists.' } : reply.errors ?? {};
    setErrors(found);
    focusFirst(found, 'signup');
  };

  return (
    <AccountLayout phrase="Create your account, soft violet dawn over still water">
      <h1 class="heading">Create your account</h1>
      <p class="account-line">
        Already have an account? <a href="/login" class="text-link">Log in</a>
      </p>
      <form class="stack" noValidate onSubmit={submit}>
        <ErrorSummary count={Object.keys(errors).length} />
        <TextField id="signup-name" label="Name" autocomplete="name" value={values.name} onInput={set('name')} error={errors.name} />
        <TextField id="signup-email" label="Email" type="email" autocomplete="email" value={values.email} onInput={set('email')} error={errors.email} />
        <TextField
          id="signup-password"
          label="Password"
          type="password"
          autocomplete="new-password"
          value={values.password}
          onInput={set('password')}
          error={errors.password}
        />
        <p class="hint">At least 10 characters.</p>
        <button type="submit" class="button button-accent button-large button-block" disabled={busy} aria-disabled={busy ? 'true' : undefined}>
          {busy && <Spinner />}
          Sign up
        </button>
      </form>
    </AccountLayout>
  );
}

export function LoginPage() {
  const [values, setValues] = useState({ email: '', password: '' });
  const [refusal, setRefusal] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (field: keyof typeof values) => (event: Event) =>
    setValues((current) => ({ ...current, [field]: (event.currentTarget as HTMLInputElement).value }));

  const submit = async (event: Event) => {
    event.preventDefault();
    setBusy(true);
    const reply = await api('POST', '/auth/login', values);
    if (reply.ok) return location.assign('/studio');
    setBusy(false);
    setRefusal(reply.error ?? 'Email or password is incorrect.');
  };

  return (
    <AccountLayout phrase="Welcome to Kinora, a lantern-lit harbour at night">
      <h1 class="heading">Welcome to Kinora</h1>
      <p class="account-line">
        Don't have an account? <a href="/signup" class="text-link">Sign up for free</a>
      </p>
      <form class="stack" noValidate onSubmit={submit}>
        <p class="form-alert form-refusal" role="alert" id="login-refusal">
          {refusal}
        </p>
        <TextField
          id="login-email"
          label="Email"
          type="email"
          autocomplete="email"
          value={values.email}
          onInput={set('email')}
          aria-describedby={refusal ? 'login-refusal' : undefined}
        />
        <TextField
          id="login-password"
          label="Password"
          type="password"
          autocomplete="current-password"
          value={values.password}
          onInput={set('password')}
          aria-describedby={refusal ? 'login-refusal' : undefined}
        />
        <button type="submit" class="pill pill-dark pill-large button-block" disabled={busy} aria-disabled={busy ? 'true' : undefined}>
          {busy && <Spinner />}
          Log in
        </button>
      </form>
    </AccountLayout>
  );
}

export function InvitePage({ token, initial }: { token: string; initial: Invitation | null | undefined }) {
  const [invitation, setInvitation] = useState(initial);
  const [values, setValues] = useState({ name: '', password: '' });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  const [joined, setJoined] = useState(false);

  useEffect(() => {
    if (invitation !== undefined) return;
    api<Invitation>('GET', `/invitations/${encodeURIComponent(token)}`).then((reply) =>
      setInvitation(reply.ok ? reply.data : null),
    );
  }, [token]);

  const set = (field: keyof typeof values) => (event: Event) =>
    setValues((current) => ({ ...current, [field]: (event.currentTarget as HTMLInputElement).value }));

  const submit = async (event: Event) => {
    event.preventDefault();
    const checked = checkJoin(values);
    if (!checked.ok) {
      setErrors(checked.errors);
      return focusFirst(checked.errors, 'join');
    }
    setBusy(true);
    const reply = await api('POST', `/invitations/${encodeURIComponent(token)}`, values);
    setBusy(false);
    if (reply.ok) return setJoined(true);
    if (reply.status === 404) return setInvitation(null);
    setErrors(reply.status === 409 ? { email: 'That person already has an account or an invitation.' } : reply.errors ?? {});
  };

  if (invitation && joined) {
    return (
      <AccountLayout phrase="You're in, warm lights gathering over a calm bay">
        <h1 class="heading">You're in. Welcome to {invitation.workspace_name}.</h1>
        <p class="account-line">Your seat added its credits to the team's shared balance.</p>
        <a class="button button-dark button-large" href="/studio">Open the studio</a>
      </AccountLayout>
    );
  }
  if (invitation === null) {
    return (
      <AccountLayout phrase="An invitation that has faded, a pale empty shore">
        <h1 class="heading">This invitation is no longer valid.</h1>
        <p class="account-line">Ask the workspace owner to send you a new invitation.</p>
        <a class="button button-light" href="/">Back to home</a>
      </AccountLayout>
    );
  }
  return (
    <AccountLayout phrase="Join the team, soft bands of violet and amber light">
      {invitation && (
        <>
          <h1 class="heading">Join {invitation.workspace_name} on Kinora</h1>
          <form class="stack" noValidate onSubmit={submit}>
            <ErrorSummary count={Object.keys(errors).length} />
            <TextField id="join-email" label="Email" type="email" value={invitation.email} readOnly error={errors.email} />
            <TextField id="join-name" label="Name" autocomplete="name" value={values.name} onInput={set('name')} error={errors.name} />
            <TextField
              id="join-password"
              label="Password"
              type="password"
              autocomplete="new-password"
              value={values.password}
              onInput={set('password')}
              error={errors.password}
            />
            <p class="hint">At least 10 characters.</p>
            <button type="submit" class="button button-accent button-large button-block" disabled={busy} aria-disabled={busy ? 'true' : undefined}>
              {busy && <Spinner />}
              Join team
            </button>
          </form>
        </>
      )}
    </AccountLayout>
  );
}
