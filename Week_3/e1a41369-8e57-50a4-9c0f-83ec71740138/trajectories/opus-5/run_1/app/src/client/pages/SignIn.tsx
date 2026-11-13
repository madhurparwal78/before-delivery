import { useState } from 'react';
import { ApiFailure, api } from '../api.js';
import { navigate } from '../router.js';
import { GENERIC_ERROR, connectLive, loadEverything, showAlert } from '../store.js';

export const SIGN_IN_FAILURE = 'Wrong username or password.';

export function SignIn(): JSX.Element {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const enter = (mode: 'in' | 'new'): void => {
    setBusy(true);
    setFieldErrors({});
    showAlert(null);
    const work = mode === 'in' ? api.login(username, password) : api.signup(username, password);
    void work
      .then(async () => {
        await loadEverything();
        connectLive();
        navigate('/board');
      })
      .catch((failure: unknown) => {
        if (failure instanceof ApiFailure) {
          if (failure.status === 401) showAlert(SIGN_IN_FAILURE);
          else if (failure.status === 409) setFieldErrors({ username: 'That username is taken.' });
          else if (failure.status === 422) setFieldErrors(failure.fieldErrors);
          else showAlert(GENERIC_ERROR);
        } else showAlert(GENERIC_ERROR);
      })
      .finally(() => setBusy(false));
  };

  return (
    <main className="signin">
      <section className="signin-field">
        <h1 className="signin-title">Deedfall</h1>
        <div className="field">
          <label htmlFor="username">Username</label>
          <input
            id="username"
            type="text"
            autoComplete="username"
            value={username}
            onChange={(event) => setUsername(event.currentTarget.value)}
          />
          {fieldErrors.username ? (
            <p className="field-error" role="alert">
              {fieldErrors.username}
            </p>
          ) : null}
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.currentTarget.value)}
          />
          {fieldErrors.password ? (
            <p className="field-error" role="alert">
              {fieldErrors.password}
            </p>
          ) : null}
        </div>
        <div className="signin-actions">
          <button type="button" className="primary" disabled={busy} onClick={() => enter('in')}>
            Sign in
          </button>
          <button type="button" disabled={busy} onClick={() => enter('new')}>
            Create account
          </button>
        </div>
      </section>
    </main>
  );
}
