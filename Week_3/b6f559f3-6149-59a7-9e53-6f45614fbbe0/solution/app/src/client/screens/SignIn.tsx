import { useEffect, useState, type FormEvent } from 'react';
import '../styles/pages.css';
import { api, ApiError } from '../api';
import { MESSAGES } from '../../shared/messages';
import { navigate } from '../router';
import { useSession } from '../session';
import { WorkspaceFooter, WorkspaceHeader } from '../ui/Chrome';

export function SignIn() {
  const session = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (session.status === 'in') navigate('/projects', true);
  }, [session.status]);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await api.post('/api/session', { email, password });
      await session.refresh();
    } catch (failure) {
      setError(failure instanceof ApiError && failure.status === 401 ? MESSAGES.badCredentials : failure instanceof ApiError ? failure.message : MESSAGES.badCredentials);
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <WorkspaceHeader />
      <main className="auth-page">
        <form className="panel auth-panel" onSubmit={(event) => void submit(event)} noValidate>
          <h1>
            Sign <span className="serif-word">in</span>
          </h1>
          <p className="muted">Use your email and password to open your projects.</p>
          <label className="field-label">
            Email
            <input type="email" role="textbox" name="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label className="field-label">
            Password
            <input type="password" role="textbox" name="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          {error && (
            <p className="notice" role="alert">
              {error}
            </p>
          )}
          <button type="submit" className="btn btn-primary" disabled={pending} aria-busy={pending}>
            {pending ? MESSAGES.signingIn : 'Sign in'}
          </button>
        </form>
      </main>
      <WorkspaceFooter />
    </>
  );
}
