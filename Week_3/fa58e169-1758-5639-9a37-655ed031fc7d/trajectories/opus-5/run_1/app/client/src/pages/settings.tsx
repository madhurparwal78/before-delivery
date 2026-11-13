import { useState } from 'react';
import { api, ApiFailure, type Account } from '../api';
import { useApp } from '../app';
import { Shell } from '../shell';

export function SettingsScreen(): JSX.Element {
  const { account, setAccount, navigate } = useApp();
  const [name, setName] = useState(account?.name ?? '');
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [status, setStatus] = useState('');
  const [reduceMotion, setReduceMotion] = useState(account?.reduceMotion === true);
  const [error, setError] = useState('');
  const [field, setField] = useState('');

  const fail = (failure: unknown): void => {
    if (failure instanceof ApiFailure) {
      setError(failure.body.message ?? '');
      setField(failure.body.field ?? '');
      setStatus('');
    }
  };

  const saveProfile = async (): Promise<void> => {
    try {
      const saved = await api.patch<Account>('/api/me', { name });
      setAccount(saved);
      setError('');
      setField('');
      setStatus('Saved.');
    } catch (failure) {
      fail(failure);
    }
  };

  const changePassword = async (): Promise<void> => {
    try {
      await api.post('/api/me/password', { current, next });
      setError('');
      setField('');
      setCurrent('');
      setNext('');
      setStatus('Saved.');
    } catch (failure) {
      fail(failure);
    }
  };

  const toggleMotion = async (on: boolean): Promise<void> => {
    setReduceMotion(on);
    const saved = await api.patch<Account>('/api/me', { reduceMotion: on });
    setAccount(saved);
    setStatus('Saved.');
  };

  const signOut = async (): Promise<void> => {
    await api.remove('/api/session');
    setAccount(null);
    navigate('/signin', true);
  };

  return (
    <Shell lead="Your account and this workspace.">
      <div className="form">
        <h1>Settings</h1>
        <label className="field">
          <span>Name</span>
          <input
            aria-label="Name"
            value={name}
            aria-invalid={field === 'name' ? 'true' : undefined}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <button type="button" onClick={saveProfile}>
          Save profile
        </button>
        <label className="field">
          <span>Current password</span>
          <input
            type="password"
            value={current}
            aria-invalid={field === 'current' ? 'true' : undefined}
            onChange={(event) => setCurrent(event.target.value)}
          />
        </label>
        <label className="field">
          <span>New password</span>
          <input
            type="password"
            value={next}
            aria-invalid={field === 'next' ? 'true' : undefined}
            onChange={(event) => setNext(event.target.value)}
          />
        </label>
        <button type="button" onClick={changePassword}>
          Change password
        </button>
        <label className="field checkbox">
          <input
            type="checkbox"
            checked={reduceMotion}
            onChange={(event) => void toggleMotion(event.target.checked)}
          />
          <span>Reduce motion</span>
        </label>
        <button type="button" onClick={signOut}>
          Sign out
        </button>
        <p role="status" aria-label="Settings" className="status-line">
          {status}
        </p>
        <p role="alert" aria-label="Settings error" className="alert">
          {error}
        </p>
      </div>
    </Shell>
  );
}
