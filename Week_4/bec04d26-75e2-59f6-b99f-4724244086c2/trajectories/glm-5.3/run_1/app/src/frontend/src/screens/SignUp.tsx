import { useState } from 'react';
import { api, ApiError } from '../lib/api';
import type { UserJson } from '../../../shared/types';
import { navigateTo } from '../lib/router';

export function SignUp({ onSignedIn }: { onSignedIn: (user: UserJson) => void }): React.ReactNode {
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await api.signUp({ display_name: displayName, email, password });
      const me = await api.me();
      onSignedIn(me.user);
    } catch (error) {
      if (error instanceof ApiError) {
        setErrors(error.errors);
      } else {
        setErrors({ email: 'Enter a valid email address.' });
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="auth-screen">
      <h1>Create your practice</h1>
      <form
        className="form form-narrow"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <Field label="Your name" error={errors.display_name}>
          <input
            type="text"
            name="display_name"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
          />
        </Field>
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
            autoComplete="new-password"
            onChange={(event) => setPassword(event.target.value)}
          />
        </Field>
        <button type="submit" className="button button-primary">
          {saving ? 'Saving' : 'Create practice'}
        </button>
      </form>
      <p>
        <a href="/sign-in" onClick={(event) => {
          event.preventDefault();
          navigateTo('/sign-in');
        }}>Sign in</a>
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
