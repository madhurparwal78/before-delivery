import { useState } from 'react';
import { ApiError, request } from '../lib/api.js';
import { ProblemMark } from '../components/Mark.js';
import { useRoute, useUser } from '../lib/store.js';
import type { User } from '../lib/types.js';
import type { JSX } from 'react';

function nextPath(search: URLSearchParams): string {
  const next = search.get('next');
  return next === null || !next.startsWith('/') ? '/' : next;
}

export function SignInScreen(): JSX.Element {
  const route = useRoute();
  const { refresh } = useUser();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [problem, setProblem] = useState('');

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setProblem('');
    try {
      await request<{ user: User }>('/api/auth/signin', {
        method: 'POST',
        body: { email, password },
      });
      await refresh();
      route.navigate(nextPath(route.query));
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      setProblem("That email and password don't match.");
    }
  };

  return (
    <section className="narrow ground-paper">
      <h1 className="display">Sign in</h1>
      <ProblemMark label="Sign-in problem" text={problem} />
      <form onSubmit={(event) => void submit(event)}>
        <div className="field">
          <label htmlFor="signin-email">Email</label>
          <input
            id="signin-email"
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
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>
        <button type="submit" className="primary">
          Sign in
        </button>
      </form>
      <a
        href="/register"
        onClick={(event) => {
          event.preventDefault();
          route.navigate(`/register${route.query.get('next') === null ? '' : `?next=${encodeURIComponent(route.query.get('next') as string)}`}`);
        }}
      >
        Create an account
      </a>
    </section>
  );
}

export function RegisterScreen(): JSX.Element {
  const route = useRoute();
  const { refresh } = useUser();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [problem, setProblem] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setProblem('');
    setFields({});
    try {
      await request<{ user: User }>('/api/auth/register', {
        method: 'POST',
        body: { name, email, password },
      });
      await refresh();
      route.navigate(nextPath(route.query));
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      if (error.failure.code === 'email_taken') {
        setProblem('An account with this email already exists.');
        return;
      }
      const messages: Record<string, string> = {};
      if (error.failure.fields['name'] !== undefined) messages['name'] = 'Enter your name.';
      if (error.failure.fields['email'] !== undefined) messages['email'] = 'Enter a valid email address.';
      if (error.failure.fields['password'] !== undefined) {
        messages['password'] = 'Use a password of 10 to 200 characters.';
      }
      setFields(messages);
      setProblem(Object.values(messages)[0] ?? 'Check the details and try again.');
    }
  };

  return (
    <section className="narrow ground-paper">
      <h1 className="display">Create account</h1>
      <ProblemMark label="Sign-in problem" text={problem} />
      <form onSubmit={(event) => void submit(event)}>
        <div className="field">
          <label htmlFor="register-name">Name</label>
          <input
            id="register-name"
            type="text"
            autoComplete="name"
            aria-describedby={fields['name'] !== undefined ? 'register-name-error' : undefined}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          {fields['name'] !== undefined ? (
            <p className="field-error" id="register-name-error">
              {fields['name']}
            </p>
          ) : null}
        </div>
        <div className="field">
          <label htmlFor="register-email">Email</label>
          <input
            id="register-email"
            type="email"
            autoComplete="email"
            aria-describedby={fields['email'] !== undefined ? 'register-email-error' : undefined}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          {fields['email'] !== undefined ? (
            <p className="field-error" id="register-email-error">
              {fields['email']}
            </p>
          ) : null}
        </div>
        <div className="field">
          <label htmlFor="register-password">Password</label>
          <input
            id="register-password"
            type="password"
            autoComplete="new-password"
            aria-describedby={fields['password'] !== undefined ? 'register-password-error' : undefined}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          {fields['password'] !== undefined ? (
            <p className="field-error" id="register-password-error">
              {fields['password']}
            </p>
          ) : null}
        </div>
        <button type="submit" className="primary">
          Create account
        </button>
      </form>
    </section>
  );
}
