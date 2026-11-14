import { useLayoutEffect, useState } from 'preact/hooks';
import { api, ApiFailure, failureText, fieldErrorsOf } from '../api.js';
import { useApp } from '../app-context.js';
import { ErrorCell, Field, FormErrors, FormStatus } from '../components/forms.js';
import { Loading, NotFound } from '../components/shell.js';

export function SigninForm({ idPrefix = 'signin' }: { idPrefix?: string }) {
  const { reloadMe, navigate } = useApp();
  const [status, setStatus] = useState('');
  const [failure, setFailure] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  return (
    <form
      aria-label="Sign in"
      class="stack"
      onSubmit={async (event) => {
        event.preventDefault();
        setStatus('Signing in...');
        setFailure('');
        try {
          await api('POST', '/api/session', { email, password });
          setStatus('');
          await reloadMe();
          const next = new URLSearchParams(location.search).get('next');
          navigate(next && next.startsWith('/') && !next.startsWith('//') ? next : '/');
        } catch (error) {
          setStatus('');
          setFailure(failureText(error));
        }
      }}
    >
      <Field id={`${idPrefix}-email`} label="Email" type="email" autocomplete="email" value={email} onInput={(e) => setEmail(e.currentTarget.value)} />
      <Field
        id={`${idPrefix}-password`}
        label="Password"
        type="password"
        autocomplete="current-password"
        value={password}
        onInput={(e) => setPassword(e.currentTarget.value)}
      />
      <button type="submit" class="primary">
        Sign in
      </button>
      <FormStatus text={status} />
      <ErrorCell label="Sign in error" text={failure} />
    </form>
  );
}

export function SigninPage() {
  return (
    <section class="cell single">
      <h1>Sign in</h1>
      <SigninForm />
      <p>
        New here? <a href="/signup">Create an account</a>
      </p>
    </section>
  );
}

const SIGNUP_FIELDS = {
  name: { id: 'signup-name', label: 'Name' },
  email: { id: 'signup-email', label: 'Email' },
  password: { id: 'signup-password', label: 'Password' },
};

export function SignupPage() {
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [status, setStatus] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState('');
  return (
    <section class="cell single">
      <h1>Create an account</h1>
      <form
        aria-label="Create account"
        class="stack"
        noValidate
        onSubmit={async (event) => {
          event.preventDefault();
          setStatus('Saving...');
          setErrors({});
          setFailure('');
          try {
            await api('POST', '/api/signup', form);
            setStatus('Check your email to verify your account.');
          } catch (error) {
            setStatus('');
            const fields = fieldErrorsOf(error);
            if (fields) setErrors(fields);
            else setFailure(failureText(error));
          }
        }}
      >
        <FormErrors errors={errors} fields={SIGNUP_FIELDS} />
        <Field id="signup-name" label="Name" autocomplete="name" error={errors.name} value={form.name} onInput={(e) => setForm({ ...form, name: e.currentTarget.value })} />
        <Field id="signup-email" label="Email" type="email" autocomplete="email" error={errors.email} value={form.email} onInput={(e) => setForm({ ...form, email: e.currentTarget.value })} />
        <Field
          id="signup-password"
          label="Password"
          type="password"
          autocomplete="new-password"
          error={errors.password}
          value={form.password}
          onInput={(e) => setForm({ ...form, password: e.currentTarget.value })}
        />
        <button type="submit" class="primary">
          Create account
        </button>
        <FormStatus text={status} />
        <ErrorCell label="Sign up error" text={failure} />
      </form>
    </section>
  );
}

export function VerifyPage() {
  const [result, setResult] = useState<'pending' | 'verified' | 'expired' | 'missing'>('pending');
  useLayoutEffect(() => {
    const token = new URLSearchParams(location.search).get('token') ?? '';
    api('POST', '/api/verify', { token })
      .then(() => setResult('verified'))
      .catch((error: unknown) => setResult(error instanceof ApiFailure && error.status === 410 ? 'expired' : 'missing'));
  }, []);
  if (result === 'pending') return <Loading />;
  if (result === 'missing') return <NotFound />;
  return (
    <section class="cell single">
      <h1>{result === 'verified' ? 'Email verified.' : 'This verification link has expired.'}</h1>
      {result === 'verified' ? (
        <p>
          <a href="/signin">Sign in</a>
        </p>
      ) : (
        <p>
          <a href="/signup">Sign up again</a> to get a new link.
        </p>
      )}
    </section>
  );
}

const INVITE_FIELDS = {
  name: { id: 'invite-name', label: 'Name' },
  password: { id: 'invite-password', label: 'Password' },
};

export function InvitePage({ token }: { token: string }) {
  const { reloadMe, navigate } = useApp();
  const [info, setInfo] = useState<{ class: string; email: string } | null>(null);
  const [closed, setClosed] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [form, setForm] = useState({ name: '', password: '' });
  const [status, setStatus] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState('');
  useLayoutEffect(() => {
    api<{ class: string; email: string }>('GET', `/api/invitations/${encodeURIComponent(token)}`)
      .then(setInfo)
      .catch((error: unknown) => {
        if (error instanceof ApiFailure && error.status === 410) setClosed(error.body.message ?? '');
        else setMissing(true);
      });
  }, [token]);
  if (missing) return <NotFound />;
  if (closed !== null) {
    return (
      <section class="cell single">
        <h1>Invitation</h1>
        <p class="hatched-cell">{closed}</p>
      </section>
    );
  }
  if (!info) return <Loading />;
  return (
    <section class="cell single">
      <h1>Join {info.class}</h1>
      <p>
        Invitation for <strong>{info.email}</strong>. If you already have an account, use its password.
      </p>
      <form
        aria-label="Join class"
        class="stack"
        noValidate
        onSubmit={async (event) => {
          event.preventDefault();
          setStatus('Joining...');
          setErrors({});
          setFailure('');
          try {
            const result = await api<{ classId: string }>('POST', `/api/invitations/${encodeURIComponent(token)}/accept`, form);
            await reloadMe();
            navigate(`/classes/${result.classId}`);
          } catch (error) {
            setStatus('');
            const fields = fieldErrorsOf(error);
            if (fields) setErrors(fields);
            else setFailure(failureText(error));
          }
        }}
      >
        <FormErrors errors={errors} fields={INVITE_FIELDS} />
        <Field id="invite-name" label="Name" autocomplete="name" error={errors.name} value={form.name} onInput={(e) => setForm({ ...form, name: e.currentTarget.value })} />
        <Field
          id="invite-password"
          label="Password"
          type="password"
          autocomplete="new-password"
          error={errors.password}
          value={form.password}
          onInput={(e) => setForm({ ...form, password: e.currentTarget.value })}
        />
        <button type="submit" class="primary">
          Join class
        </button>
        <FormStatus text={status} />
        <ErrorCell label="Join error" text={failure} />
      </form>
    </section>
  );
}
