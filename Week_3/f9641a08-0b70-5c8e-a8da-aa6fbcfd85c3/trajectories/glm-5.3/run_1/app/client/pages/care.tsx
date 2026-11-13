import { useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { api, ApiFailure } from '../lib/api.js';
import { navigate } from '../lib/router.js';
import { store } from '../lib/store.js';
import { announce } from '../app.js';
import { CONFIG, holdText, yearsText } from '../lib/format.js';

export function Care(): JSX.Element {
  return (
    <div class="care-page">
      <h1>Care</h1>
      <p>Your bag is held for {holdText(CONFIG.reservation_ttl_seconds)} once you press Pay.</p>
      <p>Returns are open for {CONFIG.return_window_days} days after delivery.</p>
      <p>Trial returns are open for {CONFIG.trial_window_days} days after delivery on luggage, backpacks and totes.</p>
      <p>Luggage is covered for {yearsText(CONFIG.warranty_years_luggage)} from delivery.</p>
      <p>Backpacks and totes are covered for {yearsText(CONFIG.warranty_years_bags)} from delivery.</p>
      <p>Wallets and accessories are covered for {yearsText(CONFIG.warranty_years_accessories)} from delivery.</p>
    </div>
  );
}

export function SignIn(): JSX.Element {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: Event): Promise<void> => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/session', { email, password });
      await store.refreshAll();
      const params = new URL(location.href).searchParams;
      const next = params.get('next');
      navigate(next !== null && next.startsWith('/') ? next : '/account', true);
    } catch (err) {
      if (err instanceof ApiFailure) setError(err.body.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="auth-page">
      <h1>Sign in</h1>
      <form onSubmit={submit} novalidate>
        <label>
          <span>Email</span>
          <input type="email" value={email} onInput={(e) => setEmail((e.target as HTMLInputElement).value)} autocomplete="email" />
        </label>
        <label>
          <span>Password</span>
          <input type="password" value={password} onInput={(e) => setPassword((e.target as HTMLInputElement).value)} autocomplete="current-password" />
        </label>
        <button class="primary" disabled={busy}>{busy ? 'Checking' : 'Sign in'}</button>
        {error !== null ? <p role="alert" class="field-error">{error}</p> : null}
        <p><a href="/register" onClick={(e) => { e.preventDefault(); navigate('/register'); }}>Create an account</a></p>
      </form>
    </div>
  );
}

export function Register(): JSX.Element {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const submit = async (e: Event): Promise<void> => {
    e.preventDefault();
    setBusy(true);
    setFields({});
    try {
      await api.post('/api/accounts', { name, email, password });
      await store.refreshAll();
      navigate('/account', true);
    } catch (err) {
      if (err instanceof ApiFailure) {
        setFields(err.body.fields ?? { email: err.body.message });
        announce('cart-updates', err.body.message);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="auth-page">
      <h1>Create account</h1>
      <form onSubmit={submit} novalidate>
        <label>
          <span>Name</span>
          <input type="text" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} aria-describedby={fields.name !== undefined ? 'name-error' : undefined} />
          {fields.name !== undefined ? <p id="name-error" class="field-error" role="alert">{fields.name}</p> : null}
        </label>
        <label>
          <span>Email</span>
          <input type="email" value={email} onInput={(e) => setEmail((e.target as HTMLInputElement).value)} aria-describedby={fields.email !== undefined ? 'email-error' : undefined} />
          {fields.email !== undefined ? <p id="email-error" class="field-error" role="alert">{fields.email}</p> : null}
        </label>
        <label>
          <span>Password</span>
          <input type="password" value={password} onInput={(e) => setPassword((e.target as HTMLInputElement).value)} aria-describedby={fields.password !== undefined ? 'password-error' : undefined} />
          {fields.password !== undefined ? <p id="password-error" class="field-error" role="alert">{fields.password}</p> : null}
        </label>
        <button class="primary" disabled={busy}>{busy ? 'Checking' : 'Create account'}</button>
      </form>
    </div>
  );
}
