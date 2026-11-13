import { useRef, useState } from 'react';
import { SIGNIN_OUTAGE } from '../../shared/copy.ts';
import { api, RequestFailed } from '../api.ts';
import { LiveRegion, useAnnounce } from '../live.tsx';
import { navigate } from '../router.tsx';
import { useApp } from '../state.tsx';

export const SignIn = () => {
  const { setMe } = useApp();
  const announce = useAnnounce();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [teamName, setTeamName] = useState('');
  const [pending, setPending] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const fields = useRef<Record<string, HTMLInputElement | null>>({});

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setPending(true);
    setFieldErrors({});
    try {
      const account =
        mode === 'signup'
          ? await api.signUp(email, password, teamName)
          : await api.signIn(email, password);
      setMe(account);
      navigate(mode === 'signup' ? '/transfers' : '/team', { replace: true });
    } catch (error) {
      if (!(error instanceof RequestFailed)) throw error;
      if (error.status === 503) announce('Account', SIGNIN_OUTAGE);
      else if (error.status === 401) announce('Account', 'Email or password is wrong.');
      else if (error.status === 409) announce('Account', 'An account with this email already exists.');
      else if (error.body.fields !== undefined) {
        setFieldErrors(error.body.fields);
        announce('Account', Object.values(error.body.fields).join(' '));
      } else announce('Account', error.body.message);
    } finally {
      setPending(false);
    }
  };

  const describe = (field: string): string | undefined =>
    fieldErrors[field] === undefined ? undefined : `${field}-error`;

  return (
    <main className="signin">
      <section className="card">
        <h1>{mode === 'signin' ? 'Sign in' : 'Create account'}</h1>
        <form onSubmit={submit}>
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            value={email}
            aria-describedby={describe('email')}
            ref={(node) => {
              fields.current.email = node;
            }}
            onChange={(event) => setEmail(event.target.value)}
          />
          {fieldErrors.email !== undefined && (
            <p id="email-error" className="field-error">
              {fieldErrors.email}
            </p>
          )}

          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            value={password}
            aria-describedby={describe('password')}
            ref={(node) => {
              fields.current.password = node;
            }}
            onChange={(event) => setPassword(event.target.value)}
          />
          {fieldErrors.password !== undefined && (
            <p id="password-error" className="field-error">
              {fieldErrors.password}
            </p>
          )}

          {mode === 'signup' && (
            <>
              <label htmlFor="team_name">Team name</label>
              <input
                id="team_name"
                type="text"
                value={teamName}
                aria-describedby={describe('team_name')}
                ref={(node) => {
                  fields.current.team_name = node;
                }}
                onChange={(event) => setTeamName(event.target.value)}
              />
              {fieldErrors.team_name !== undefined && (
                <p id="team_name-error" className="field-error">
                  {fieldErrors.team_name}
                </p>
              )}
            </>
          )}

          <button type="submit" disabled={pending}>
            {mode === 'signin'
              ? pending
                ? 'Signing in…'
                : 'Sign in'
              : pending
                ? 'Creating account…'
                : 'Create account'}
          </button>
        </form>
        {mode === 'signin' ? (
          <a
            href="/signin"
            onClick={(event) => {
              event.preventDefault();
              setMode('signup');
            }}
          >
            Create an account
          </a>
        ) : (
          <a
            href="/signin"
            onClick={(event) => {
              event.preventDefault();
              setMode('signin');
            }}
          >
            I have an account
          </a>
        )}
        <div className="account-region">
          <LiveRegion name="Account" />
          <ul className="error-links">
            {Object.entries(fieldErrors).map(([field, message]) => (
              <li key={field}>
                <a
                  href={`#${field}`}
                  onClick={(event) => {
                    event.preventDefault();
                    fields.current[field]?.focus();
                  }}
                >
                  {message}
                </a>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </main>
  );
};
