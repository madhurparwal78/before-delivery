import { useState } from 'react';
import { api, ApiError } from '../lib/api';
import type { UserJson } from '../../../shared/types';
import { navigateTo } from '../lib/router';

const FIELD_MESSAGES: Record<string, string> = {
  email: 'Email or password is wrong.',
};

export function SignIn({ onSignedIn }: { onSignedIn: (user: UserJson) => void }): React.ReactNode {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const result = await api.signIn({ email, password });
      onSignedIn(result.user);
    } catch (error) {
      if (error instanceof ApiError) {
        setErrors(
          Object.fromEntries(
            Object.entries(error.errors).map(([key, value]) => [key, value !== '' ? value : (FIELD_MESSAGES[key] ?? '')]),
          ),
        );
      } else {
        setErrors({ email: 'Email or password is wrong.' });
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="auth-screen">
      <h1>Sign in</h1>
      <form
        className="form form-narrow"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <Field label="Email" error={errors.email}>
          <input
            type="email"
            name="email"
            value={email}
            autoComplete="email"
            onChange={(event) => setEmail(event.target.value)}
          />
        </Field>
        <Field label="Password" error={errors.password}>
          <input
            type="password"
            name="password"
            value={password}
            autoComplete="current-password"
            onChange={(event) => setPassword(event.target.value)}
          />
        </Field>
        <button type="submit" className="button button-primary">
          {saving ? 'Saving' : 'Sign in'}
        </button>
      </form>
      <p>
        <a href="/sign-up" onClick={(event) => {
          event.preventDefault();
          navigateTo('/sign-up');
        }}>Create a practice</a>
      </p>
    </main>
  );
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }): React.ReactNode {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {error !== undefined && error !== '' ? <span className="field-error">{error}</span> : null}
    </label>
  );
}
