import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import { api, ApiFailure, type Settings as SettingValues } from '../api';
import { navigate } from '../router';
import { changeSettings, forgetPlayer, signOut, type Store } from '../store';
import { Modal, Screen, restoreFocus } from '../ui';

const SWITCHES: [string, 'sound' | 'music' | 'leftHanded' | 'reducedMotion'][] = [
  ['Sound', 'sound'], ['Music', 'music'], ['Left-handed mode', 'leftHanded'], ['Reduced motion', 'reducedMotion'],
];
const THEMES: [string, SettingValues['theme']][] = [['Light', 'light'], ['Dark', 'dark'], ['System', 'system']];

export function Settings({ store }: { store: Store }): ReactNode {
  const { settings, auth } = store;
  const [deleting, setDeleting] = useState(false);
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [blocked, setBlocked] = useState<{ id: string; displayName: string }[] | null>(null);
  const opener = useRef<HTMLButtonElement>(null);

  if (auth === 'player' && blocked === null) {
    setBlocked([]);
    void api<{ blocked: { id: string; displayName: string }[] }>('GET', '/api/friends').then((body) => setBlocked(body.blocked)).catch(() => undefined);
  }
  const unblock = async (id: string): Promise<void> => {
    await api('DELETE', `/api/friends/${id}/block`);
    setBlocked((current) => (current ?? []).filter((person) => person.id !== id));
  };
  const closeDelete = (): void => {
    setDeleting(false);
    setMessage('');
    restoreFocus(opener.current);
  };
  const confirmDelete = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    try {
      await api('DELETE', '/api/me', { password });
      forgetPlayer();
      navigate('/home');
    } catch (error) {
      setMessage((error as ApiFailure).message);
    }
  };

  return (
    <Screen store={store} title="Settings">
      <div>
        {SWITCHES.map(([label, key]) => (
          <div className="setting" key={key}>
            <span id={`setting-${key}`}>{label}</span>
            <button type="button" role="switch" className="switch" aria-label={label} aria-checked={settings[key]} onClick={() => void changeSettings({ [key]: !settings[key] })} />
          </div>
        ))}
        <div className="setting">
          <label htmlFor="aim-sensitivity">Aim sensitivity</label>
          <input
            id="aim-sensitivity"
            type="range"
            style={{ maxWidth: 240 }}
            min={1}
            max={10}
            step={1}
            value={settings.aimSensitivity}
            onChange={(event) => void changeSettings({ aimSensitivity: Number(event.target.value) })}
          />
        </div>
        <div className="setting">
          <span>Theme</span>
          <div className="radio-row" role="radiogroup" aria-label="Theme">
            {THEMES.map(([label, value]) => (
              <label className="radio" key={value}>
                <input type="radio" name="theme" checked={settings.theme === value} onChange={() => void changeSettings({ theme: value })} />
                {label}
              </label>
            ))}
          </div>
        </div>
      </div>
      {auth === 'player' && (
        <>
          <div className="page-head">
            <h2>Blocked users</h2>
            <ul className="row-list" aria-label="Blocked users">
              {blocked?.map((person) => (
                <li key={person.id}>
                  <span>{person.displayName}</span>
                  <button type="button" onClick={() => void unblock(person.id)}>Unblock {person.displayName}</button>
                </li>
              ))}
            </ul>
          </div>
          <div className="home-actions">
            <button type="button" onClick={() => void signOut().then(() => navigate('/home'))}>Sign out</button>
            <button ref={opener} type="button" onClick={() => setDeleting(true)}>Delete account</button>
          </div>
        </>
      )}
      {deleting && (
        <Modal label="Delete account" role="alertdialog" onEscape={closeDelete}>
          <h2>Delete account</h2>
          <form className="sheet-actions" onSubmit={(event) => void confirmDelete(event)}>
            <div className="field">
              <label htmlFor="delete-password">Password</label>
              <input id="delete-password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} />
            </div>
            {message !== '' && <p className="field-error" role="status">{message}</p>}
            <button type="submit" className="primary">Delete my account</button>
            <button type="button" onClick={closeDelete}>Keep my account</button>
          </form>
        </Modal>
      )}
    </Screen>
  );
}
