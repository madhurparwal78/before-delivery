import { useState } from 'react';
import { api, ApiError } from '../lib/api';
import type { MeJson } from '../../../shared/types';
import { TopBar } from '../components/TopBar';
import type { Session } from '../lib/session';

const HOURS = Array.from({ length: 16 }, (_, index) => index + 6);

function hourLabel(hour: number): string {
  const display = hour === 12 ? 12 : hour > 12 ? hour - 12 : hour;
  const ampm = hour < 12 ? 'am' : 'pm';
  return `${display}:00 ${ampm}`;
}

export function SettingsScreen({ me, announce }: { me: MeJson; announce: (line: string) => void }): React.ReactNode {
  const [hour, setHour] = useState(String(me.reminder_hour));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const session: Session = { me, signOut: async () => {} };

  const submit = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await api.saveReminderHour(Number(hour));
      setErrors({});
      announce('Reminder hour saved.');
    } catch (error) {
      if (error instanceof ApiError) setErrors(error.errors);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <TopBar session={session} route={{ path: '/settings', navigate: () => {} }} />
      <main className="page settings-page">
        <h1 className="page-title">Settings</h1>
        <h2>Settings</h2>
        <form
          className="form form-narrow"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <label className="field">
            <span className="field-label">Reminder hour</span>
            <select value={hour} onChange={(event) => setHour(event.target.value)}>
              {HOURS.map((value) => (
                <option key={value} value={value}>{hourLabel(value)}</option>
              ))}
            </select>
            {errors.reminder_hour !== undefined ? <span className="field-error">{errors.reminder_hour}</span> : null}
          </label>
          <button type="submit" className="button button-primary">
            {saving ? 'Saving' : 'Save reminder hour'}
          </button>
        </form>
      </main>
    </>
  );
}
