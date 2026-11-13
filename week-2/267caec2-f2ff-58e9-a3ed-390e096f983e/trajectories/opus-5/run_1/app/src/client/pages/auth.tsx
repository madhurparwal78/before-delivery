import type { JSX } from 'preact';
import { useRef, useState } from 'preact/hooks';
import { api, DeskError } from '../api';
import type { PageProps } from '../main';
import { useShell } from '../shell';
import { Field, GridLines, useFeedback, usePending } from '../ui';
import type { User } from '../types';

function nextPath(): string {
  const next = new URLSearchParams(window.location.search).get('next');
  return next === null || next === '' ? '/' : next;
}

function homeFor(user: User): string {
  if (user.role === 'director') return '/director';
  if (user.role === 'juror') return '/jury';
  return '/studio';
}

export function SignIn({ navigate, reloadUser }: PageProps): JSX.Element {
  useShell('Cutline Jury Desk', null);
  const feedback = useFeedback();
  const [pending, run] = usePending();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const emailRef = useRef<HTMLInputElement>(null);

  const submit = async (event: Event): Promise<void> => {
    event.preventDefault();
    feedback.say('Signing in…');
    const result = await run(() => api<{ user: User }>('POST', '/api/session', { email, password }));
    if (result === undefined) {
      emailRef.current?.focus();
      return;
    }
    await reloadUser();
    feedback.clear();
    const wanted = nextPath();
    navigate(wanted === '/' ? homeFor(result.user) : wanted);
  };

  return (
    <div class="grid">
      <GridLines />
      <form class="span-6 stack" onSubmit={(event) => void submit(event)}>
        <h1>Sign in</h1>
        <Field label="Email" id="signin-email">
          <input
            id="signin-email"
            type="email"
            autocomplete="email"
            ref={emailRef}
            value={email}
            onInput={(event) => setEmail((event.target as HTMLInputElement).value)}
          />
        </Field>
        <Field label="Password" id="signin-password">
          <input
            id="signin-password"
            type="password"
            autocomplete="current-password"
            value={password}
            onInput={(event) => setPassword((event.target as HTMLInputElement).value)}
          />
        </Field>
        <div class="row-flex">
          <button class="btn" type="submit" disabled={pending}>
            {pending ? 'Signing in…' : 'Sign in'}
          </button>
          <a
            href="/signup"
            onClick={(event) => {
              event.preventDefault();
              navigate('/signup');
            }}
          >
            Create a studio account
          </a>
        </div>
      </form>
    </div>
  );
}

export function SignUp({ navigate, reloadUser }: PageProps): JSX.Element {
  useShell('Cutline Jury Desk', null);
  const feedback = useFeedback();
  const [pending, run] = usePending();
  const [form, setForm] = useState({ studioName: '', contactName: '', email: '', password: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const change = (field: string) => (event: Event) =>
    setForm({ ...form, [field]: (event.target as HTMLInputElement).value });

  const submit = async (event: Event): Promise<void> => {
    event.preventDefault();
    setErrors({});
    feedback.say('Creating your studio…');
    const result = await run(async () => {
      try {
        return await api<{ user: User }>('POST', '/api/studios', form);
      } catch (error) {
        if (error instanceof DeskError && Object.keys(error.fields).length > 0) {
          setErrors(error.fields);
          const first = Object.keys(error.fields)[0];
          document.getElementById(`signup-${first}`)?.focus();
        }
        throw error;
      }
    });
    if (result === undefined) return;
    await reloadUser();
    feedback.say('Studio account created.');
    navigate('/studio');
  };

  return (
    <div class="grid">
      <GridLines />
      <form class="span-6 stack" onSubmit={(event) => void submit(event)}>
        <h1>Create a studio account</h1>
        <Field label="Studio name" id="signup-studioName" error={errors.studioName}>
          <input id="signup-studioName" type="text" value={form.studioName} onInput={change('studioName')} />
        </Field>
        <Field label="Contact name" id="signup-contactName" error={errors.contactName}>
          <input id="signup-contactName" type="text" value={form.contactName} onInput={change('contactName')} />
        </Field>
        <Field label="Email" id="signup-email" error={errors.email}>
          <input id="signup-email" type="email" value={form.email} onInput={change('email')} />
        </Field>
        <Field label="Password" id="signup-password" error={errors.password}>
          <input id="signup-password" type="password" value={form.password} onInput={change('password')} />
        </Field>
        <div>
          <button class="btn" type="submit" disabled={pending}>
            {pending ? 'Creating your studio…' : 'Create studio account'}
          </button>
        </div>
      </form>
    </div>
  );
}
