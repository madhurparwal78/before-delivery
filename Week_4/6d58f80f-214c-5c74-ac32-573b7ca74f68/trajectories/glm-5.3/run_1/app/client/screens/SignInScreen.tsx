import { useState } from 'preact/hooks';
import { api, ApiError } from '../lib/api.js';
import { useStore } from '../lib/store.js';
import { announce } from '../components/Announcements.tsx';

export function SignInScreen({ returnTo }: { returnTo: string }): preact.JSX.Element {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: Event): Promise<void> => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.signIn(email, password);
      window.location.href = returnTo;
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === 'invalid_credentials') { setError('Email or password is incorrect.'); announce('Email or password is incorrect.'); }
        else if (err.code === 'directory_unavailable') { setError('Sign-in is unavailable while the people directory is unreachable. Anyone already signed in can keep working.'); announce('Sign-in is unavailable while the people directory is unreachable. Anyone already signed in can keep working.'); }
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="signin-wrap">
      <div class="signin-card">
        <h1>Sign in to Lintel Drive</h1>
        <p class="sub">Lintelworks company file drive</p>
        <form onSubmit={e => void submit(e)}>
          <div class="field">
            <label for="email">Email</label>
            <input id="email" type="email" autocomplete="username" value={email} onInput={e => setEmail((e.target as HTMLInputElement).value)} />
          </div>
          <div class="field">
            <label for="password">Password</label>
            <input id="password" type="password" autocomplete="current-password" value={password} onInput={e => setPassword((e.target as HTMLInputElement).value)} />
          </div>
          {error && <p class="field-error" style="margin-bottom:10px;">{error}</p>}
          <button type="submit" class="btn-primary" style="width:100%;justify-content:center;height:34px;" disabled={busy}>Sign in</button>
        </form>
      </div>
    </div>
  );
}
