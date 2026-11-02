import { useState, type ReactElement } from 'react';
import { accountCopy } from '../../../shared/copy.js';
import { ApiCallError, api, type SessionUser } from '../api.js';
import { Link, useRouter } from '../router.js';
import { useShop } from '../state/shop.js';

function nextPath(search: string): string {
  const next = new URLSearchParams(search).get('next');
  return next === null || !next.startsWith('/') ? '/account' : next;
}

export function SignIn(): ReactElement {
  const { setUser, refreshCart } = useShop();
  const { navigate, search } = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState('');

  const submit = async () => {
    setStatus('');
    try {
      const payload = await api.post<{ user: SessionUser }>('/api/auth/sign-in', {
        email,
        password,
      });
      setUser(payload.user);
      void refreshCart();
      navigate(payload.user.role === 'customer' ? nextPath(search) : '/office/queue');
    } catch (error) {
      if (!(error instanceof ApiCallError)) throw error;
      if (error.failure.error === 'invalid_credentials') setStatus(accountCopy.invalidCredentials);
      else if (error.failure.error === 'accounts_unavailable') setStatus(accountCopy.outage);
      else setStatus(error.failure.message);
    }
  };

  return (
    <div className="page paper narrow">
      <h1>Sign in</h1>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div className="field">
          <label htmlFor="sign-in-email">Email</label>
          <input
            id="sign-in-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="sign-in-password">Password</label>
          <input
            id="sign-in-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>
        <button type="submit" className="button button--primary">
          Sign in
        </button>
      </form>
      <p role="status" aria-live="polite" aria-label="Account status" className="live-region">
        {status}
      </p>
      <p>
        New to Ceibo? <Link to="/sign-up">Create an account</Link>.
      </p>
    </div>
  );
}

export function SignUp(): ReactElement {
  const { setUser, refreshCart } = useShop();
  const { navigate, search } = useRouter();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const submit = async () => {
    setStatus('');
    setErrors({});
    try {
      const payload = await api.post<{ user: SessionUser }>('/api/auth/sign-up', {
        email,
        password,
        name,
      });
      setUser(payload.user);
      void refreshCart();
      navigate(nextPath(search));
    } catch (error) {
      if (!(error instanceof ApiCallError)) throw error;
      if (error.failure.error === 'email_taken') setStatus(accountCopy.emailTaken);
      else if (error.failure.error === 'accounts_unavailable') setStatus(accountCopy.outage);
      else if (error.failure.fields !== undefined) setErrors(error.failure.fields);
      else setStatus(error.failure.message);
    }
  };

  return (
    <div className="page paper narrow">
      <h1>Create account</h1>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div className="field">
          <label htmlFor="sign-up-name">Name</label>
          <input
            id="sign-up-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          {errors.name === undefined ? null : <p className="field__error">{errors.name}</p>}
        </div>
        <div className="field">
          <label htmlFor="sign-up-email">Email</label>
          <input
            id="sign-up-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          {errors.email === undefined ? null : <p className="field__error">{errors.email}</p>}
        </div>
        <div className="field">
          <label htmlFor="sign-up-password">Password</label>
          <input
            id="sign-up-password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          {errors.password === undefined ? null : <p className="field__error">{errors.password}</p>}
        </div>
        <button type="submit" className="button button--primary">
          Create account
        </button>
      </form>
      <p role="status" aria-live="polite" aria-label="Account status" className="live-region">
        {status}
      </p>
      <p>
        Already have an account? <Link to="/sign-in">Sign in</Link>.
      </p>
    </div>
  );
}
