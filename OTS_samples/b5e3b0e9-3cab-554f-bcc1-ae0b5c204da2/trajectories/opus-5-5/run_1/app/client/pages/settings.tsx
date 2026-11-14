import { useState } from 'preact/hooks';
import { api, failureText, fieldErrorsOf, type Me } from '../api.js';
import { useApp } from '../app-context.js';
import { ErrorCell, Field, FormErrors, FormStatus } from '../components/forms.js';

const FIELDS = {
  name: { id: 'settings-name', label: 'Name' },
  currentPassword: { id: 'settings-current', label: 'Current password' },
  newPassword: { id: 'settings-new', label: 'New password' },
  reduceMotion: { id: 'settings-motion', label: 'Reduce motion' },
};

export function SettingsPage() {
  const { me, setMe } = useApp();
  const [name, setName] = useState(me?.name ?? '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [reduceMotion, setReduceMotion] = useState(me?.reduceMotion ?? false);
  const [status, setStatus] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState('');
  if (!me) return null;
  return (
    <section class="cell single">
      <h1>Settings</h1>
      <p class="muted">{me.email}</p>
      <form
        aria-label="Settings"
        class="stack"
        noValidate
        onSubmit={async (event) => {
          event.preventDefault();
          setStatus('Saving...');
          setErrors({});
          setFailure('');
          try {
            const body: Record<string, unknown> = { name, reduceMotion };
            if (newPassword) Object.assign(body, { currentPassword, newPassword });
            setMe(await api<Me>('PATCH', '/api/me', body));
            setCurrentPassword('');
            setNewPassword('');
            setStatus('Settings saved.');
          } catch (error) {
            setStatus('');
            const fields = fieldErrorsOf(error);
            if (fields) setErrors(fields);
            else setFailure(failureText(error));
          }
        }}
      >
        <FormErrors errors={errors} fields={FIELDS} />
        <Field id="settings-name" label="Name" error={errors.name} value={name} onInput={(e) => setName(e.currentTarget.value)} />
        <Field
          id="settings-current"
          label="Current password"
          type="password"
          autocomplete="current-password"
          error={errors.currentPassword}
          value={currentPassword}
          onInput={(e) => setCurrentPassword(e.currentTarget.value)}
        />
        <Field
          id="settings-new"
          label="New password"
          type="password"
          autocomplete="new-password"
          error={errors.newPassword}
          value={newPassword}
          onInput={(e) => setNewPassword(e.currentTarget.value)}
        />
        <div class="field check">
          <input id="settings-motion" type="checkbox" checked={reduceMotion} onChange={(e) => setReduceMotion(e.currentTarget.checked)} />
          <label for="settings-motion">Reduce motion</label>
        </div>
        <button type="submit" class="primary">
          Save settings
        </button>
        <FormStatus text={status} />
        <ErrorCell label="Settings error" text={failure} />
      </form>
    </section>
  );
}
