import { useEffect, useState } from 'preact/hooks';
import { useLocation, useRoute } from 'preact-iso';
import { PublicLayout } from '../components/Chrome';
import { Spinner, TextField } from '../components/ui';
import { api, ApiError } from '../api';
import { useAuth } from '../store';

interface AuthAnswer {
  token: string;
}

export function Login() {
  const { route, query } = useLocation();
  const auth = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [problem, setProblem] = useState('');
  const [sending, setSending] = useState(false);

  const submit = async (event: Event) => {
    event.preventDefault();
    setSending(true);
    setProblem('');
    try {
      const answer = await api<AuthAnswer>('/api/auth/login', { method: 'POST', body: { email, password } });
      await auth.signIn(answer.token);
      route(query.next ?? '/studio');
    } catch (error) {
      setProblem(
        error instanceof ApiError && error.code ? error.code : 'Email or password is incorrect.'
      );
    } finally {
      setSending(false);
    }
  };

  return (
    <PublicLayout>
      <section class="shell section" style="max-width:460px">
        <h1 style="font-size:clamp(2rem,4vw,2.6rem)">Welcome to Kinora</h1>
        <p>
          Don't have an account?{' '}
          <a class="text-link" href="/signup">
            Sign up for free
          </a>
        </p>
        <form onSubmit={submit} noValidate>
          {problem ? (
            <p class="alert" role="alert">
              {problem}
            </p>
          ) : null}
          <TextField
            label="Email"
            name="email"
            type="email"
            value={email}
            onInput={setEmail}
            autocomplete="email"
          />
          <TextField
            label="Password"
            name="password"
            type="password"
            value={password}
            onInput={setPassword}
            autocomplete="current-password"
          />
          <button type="submit" class="btn btn-accent btn-pill btn-big" disabled={sending}>
            {sending ? <Spinner /> : null}
            Log in
          </button>
        </form>
      </section>
    </PublicLayout>
  );
}

export function Signup() {
  const { route, query } = useLocation();
  const auth = useAuth();
  const [values, setValues] = useState({ name: '', email: '', password: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [sending, setSending] = useState(false);

  const set = (name: string) => (value: string) => setValues((current) => ({ ...current, [name]: value }));

  const submit = async (event: Event) => {
    event.preventDefault();
    setSending(true);
    setErrors({});
    try {
      const answer = await api<AuthAnswer>('/api/auth/signup', { method: 'POST', body: values });
      await auth.signIn(answer.token);
      route(query.next ?? '/studio');
    } catch (error) {
      if (error instanceof ApiError) {
        setErrors(error.status === 409 ? { email: error.code } : error.fieldErrors);
      }
    } finally {
      setSending(false);
    }
  };

  return (
    <PublicLayout>
      <section class="shell section" style="max-width:460px">
        <h1 style="font-size:clamp(2rem,4vw,2.6rem)">Create your account</h1>
        <p>
          Already have an account?{' '}
          <a class="text-link" href="/login">
            Log in
          </a>
        </p>
        <form onSubmit={submit} noValidate>
          <TextField
            label="Name"
            name="name"
            value={values.name}
            onInput={set('name')}
            error={errors.name}
            autocomplete="name"
          />
          <TextField
            label="Email"
            name="email"
            type="email"
            value={values.email}
            onInput={set('email')}
            error={errors.email}
            autocomplete="email"
          />
          <TextField
            label="Password"
            name="password"
            type="password"
            value={values.password}
            onInput={set('password')}
            error={errors.password}
            autocomplete="new-password"
          />
          <button type="submit" class="btn btn-accent btn-pill btn-big" disabled={sending}>
            {sending ? <Spinner /> : null}
            Sign up
          </button>
        </form>
      </section>
    </PublicLayout>
  );
}

interface InvitationView {
  workspace_name: string;
  email: string;
}

export function Invite() {
  const { params } = useRoute();
  const auth = useAuth();
  const token = params.token;
  const [invitation, setInvitation] = useState<InvitationView | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [values, setValues] = useState({ name: '', password: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [sending, setSending] = useState(false);
  const [joined, setJoined] = useState(false);

  useEffect(() => {
    api<InvitationView>(`/api/invitations/${token}`)
      .then(setInvitation)
      .catch(() => setInvalid(true));
  }, [token]);

  const set = (name: string) => (value: string) => setValues((current) => ({ ...current, [name]: value }));

  const submit = async (event: Event) => {
    event.preventDefault();
    setSending(true);
    setErrors({});
    try {
      const answer = await api<AuthAnswer>(`/api/invitations/${token}`, { method: 'POST', body: values });
      await auth.signIn(answer.token);
      setJoined(true);
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.status === 404) setInvalid(true);
        else setErrors(error.fieldErrors);
      }
    } finally {
      setSending(false);
    }
  };

  if (invalid) {
    return (
      <PublicLayout>
        <section class="shell section" style="max-width:520px">
          <h1 style="font-size:clamp(1.8rem,3.4vw,2.4rem)">This invitation is no longer valid.</h1>
          <a class="btn btn-light btn-pill" href="/">
            Back to home
          </a>
        </section>
      </PublicLayout>
    );
  }

  if (joined && invitation) {
    return (
      <PublicLayout>
        <div class="confirm-page">
          <h1>You're in. Welcome to {invitation.workspace_name}.</h1>
          <a class="btn btn-accent btn-pill btn-big" href="/studio">
            Open the studio
          </a>
        </div>
      </PublicLayout>
    );
  }

  if (!invitation) {
    return (
      <PublicLayout>
        <section class="shell section">
          <p>Loading the invitation…</p>
        </section>
      </PublicLayout>
    );
  }

  return (
    <PublicLayout>
      <section class="shell section" style="max-width:460px">
        <h1 style="font-size:clamp(1.9rem,3.6vw,2.5rem)">Join {invitation.workspace_name} on Kinora</h1>
        <form onSubmit={submit} noValidate>
          <div class="field">
            <label for="field-invited-email">Email</label>
            <input class="input" id="field-invited-email" name="invited_email" value={invitation.email} readonly />
          </div>
          <TextField
            label="Name"
            name="name"
            value={values.name}
            onInput={set('name')}
            error={errors.name}
            autocomplete="name"
          />
          <TextField
            label="Password"
            name="password"
            type="password"
            value={values.password}
            onInput={set('password')}
            error={errors.password}
            autocomplete="new-password"
          />
          <button type="submit" class="btn btn-accent btn-pill btn-big" disabled={sending}>
            {sending ? <Spinner /> : null}
            Join team
          </button>
        </form>
      </section>
    </PublicLayout>
  );
}
