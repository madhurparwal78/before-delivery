import { useId, useState } from 'react';
import type { FieldError, User } from '../../shared/types.js';
import { ApiFailure, apiSend } from '../api.js';
import { useApp } from '../app.js';
import { WorkspaceHeader } from '../components/Header.js';

export function SignIn(): JSX.Element {
  const app = useApp();
  const base = useId();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  const submit = async (): Promise<void> => {
    setErrors([]);
    setMessage(null);
    try {
      const answer = await apiSend<{ user: User }>('POST', '/api/auth/signin', { email, password });
      app.setUser(answer.user);
      const returnTo = window.sessionStorage.getItem('brackenpad.return_to');
      window.sessionStorage.removeItem('brackenpad.return_to');
      app.navigate(returnTo ?? '/notebooks');
    } catch (error) {
      if (!(error instanceof ApiFailure)) throw error;
      if (error.status === 422) setErrors(error.fieldErrors);
      else setMessage(error.message);
    }
  };

  return (
    <div className="page">
      <WorkspaceHeader>
        <a
          className="header-link"
          href="/signup"
          onClick={(event) => {
            event.preventDefault();
            app.navigate('/signup');
          }}
        >
          Create an account
        </a>
      </WorkspaceHeader>
      <section className="band band-grey band-tall">
        <div className="container narrow">
          <div className="card form-card">
            <h1>Sign in</h1>
            {errors.length > 0 || message ? (
              <div className="error-summary" role="alert">
                <p>{errors.length > 0 ? 'Please fix the following:' : message}</p>
                {errors.length > 0 ? (
                  <ul>
                    {errors.map((error) => (
                      <li key={error.path}>
                        <a
                          href={`#${base}-${error.path}`}
                          onClick={(event) => {
                            event.preventDefault();
                            document.getElementById(`${base}-${error.path}`)?.focus();
                          }}
                        >
                          {error.message}
                        </a>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
            <form
              noValidate
              onSubmit={(event) => {
                event.preventDefault();
                void submit();
              }}
            >
              <div className="field">
                <label htmlFor={`${base}-email`}>Email</label>
                <input
                  id={`${base}-email`}
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor={`${base}-password`}>Password</label>
                <input
                  id={`${base}-password`}
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </div>
              <button type="submit" className="button-embossed">
                Sign in
              </button>
            </form>
            <p>
              <a
                className="inline-link"
                href="/signup"
                onClick={(event) => {
                  event.preventDefault();
                  app.navigate('/signup');
                }}
              >
                Create an account
              </a>
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
