import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { PreviewSetting } from '../../shared/types';
import { formatDate } from '../lib/format';
import { changeUsername, saveProfile, saveSettings, unblockPeer } from '../store/actions';
import { ApiFailure } from '../store/api';
import { useStore } from '../store/state';
import { Avatar } from '../ui/Avatar';
import { Chip, Slip, useAvailability } from '../ui/Field';
import { EmptySheet } from '../ui/Sheet';

const PREVIEWS: { value: PreviewSetting; label: string }[] = [
  { value: 'name_and_letter', label: 'Name and letter' },
  { value: 'name_only', label: 'Name only' },
  { value: 'none', label: 'No name or letter' },
];

const GENERIC = 'Something went wrong. Try again.';

function ProfilePanel() {
  const profile = useStore((state) => state.myProfile);
  const [name, setName] = useState(profile?.displayName ?? '');
  const [photo, setPhoto] = useState<File | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (profile) setName((current) => current || profile.displayName);
  }, [profile]);

  async function save(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (name.trim() === '') {
      setProblem('Enter a display name.');
      field.current?.focus();
      return;
    }
    setBusy(true);
    try {
      const result = await saveProfile(name.trim(), photo);
      setProblem(result.photoSaved ? null : "Your photo couldn't be saved. You can add it in Settings later.");
      if (result.photoSaved) setPhoto(null);
    } catch {
      setProblem(GENERIC);
    }
    setBusy(false);
  }

  return (
    <form className="panel" onSubmit={(event) => void save(event)}>
      <h2 className="panel__title">Profile</h2>
      <Avatar profile={profile} size={64} />
      <label className="field" htmlFor="display-name">
        Display name
      </label>
      <div className="well">
        <input ref={field} id="display-name" type="text" value={name} aria-describedby={problem ? 'profile-problem' : undefined} onChange={(event) => setName(event.target.value)} maxLength={40} />
      </div>
      {problem && <Slip id="profile-problem">{problem}</Slip>}
      <div className="panel__buttons">
        <button type="button" className="button button--quiet" onClick={() => picker.current?.click()}>
          {profile?.photo || photo ? 'Change photo' : 'Add a photo'}
        </button>
        {photo && <span className="panel__file">{photo.name}</span>}
        <button type="submit" className="button button--ink" aria-busy={busy || undefined} disabled={busy}>
          Save profile
        </button>
      </div>
      <input ref={picker} type="file" accept="image/jpeg,image/png,image/webp" aria-label="Photo" hidden onChange={(event) => setPhoto(event.target.files?.[0] ?? null)} />
    </form>
  );
}

function UsernamePanel() {
  const current = useStore((state) => state.me!.username);
  const [value, setValue] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const availability = useAvailability(value);

  async function change(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setProblem(null);
    try {
      await changeUsername(value.toLowerCase());
      setValue('');
    } catch (error) {
      if (error instanceof ApiFailure && error.code === 'username_cooldown') {
        setProblem(`You can change your username again on ${formatDate(String(error.body.retry_at))}.`);
      } else if (error instanceof ApiFailure && error.status === 422 && (error.body.fields as Record<string, string> | undefined)?.username === 'same') {
        setProblem("That's already your username.");
      } else if (error instanceof ApiFailure && error.code === 'username_taken') {
        setProblem('Taken');
      } else setProblem(GENERIC);
    }
    setBusy(false);
  }

  return (
    <form className="panel" onSubmit={(event) => void change(event)}>
      <h2 className="panel__title">Username</h2>
      <p className="panel__note">Your username is {current}.</p>
      <label className="field" htmlFor="new-username">
        New username
      </label>
      <div className="well">
        <input
          id="new-username"
          type="text"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={value}
          aria-describedby={problem ? 'username-problem' : undefined}
          onChange={(event) => {
            setValue(event.target.value);
            setProblem(null);
          }}
        />
      </div>
      <Chip text={availability.chip} />
      {problem && <Slip id="username-problem">{problem}</Slip>}
      <button type="submit" className="button button--ink" aria-busy={busy || undefined} disabled={busy}>
        Change username
      </button>
    </form>
  );
}

export function SettingsScreen() {
  const me = useStore((state) => state.me!);
  const blocks = useStore((state) => state.blocks);
  return (
    <div className="list">
      <h1 className="list__title">Settings</h1>
      <a className="jump-link" href="#blocked-contacts">
        Blocked contacts
      </a>
      <ProfilePanel />
      <UsernamePanel />
      <section className="panel">
        <h2 className="panel__title">Letters</h2>
        <label className="switch">
          <input type="checkbox" role="switch" checked={me.settings.read_receipts} onChange={(event) => void saveSettings({ read_receipts: event.target.checked })} />
          <span>Read receipts</span>
        </label>
        <div role="radiogroup" aria-label="Notification preview" className="choices">
          {PREVIEWS.map((preview) => (
            <label key={preview.value} className="choice">
              <input type="radio" name="preview" value={preview.value} checked={me.settings.preview === preview.value} onChange={() => void saveSettings({ preview: preview.value })} />
              <span>{preview.label}</span>
            </label>
          ))}
        </div>
      </section>
      <section className="panel" id="blocked-contacts">
        <h2 className="panel__title">Blocked contacts</h2>
        {blocks.length === 0 ? (
          <EmptySheet>You haven&apos;t blocked anyone.</EmptySheet>
        ) : (
          <ul className="blocked" aria-label="Blocked contacts">
            {blocks.map((block) => (
              <li key={block.account_id}>
                <span>{block.username}</span>
                <button type="button" className="button button--ink" onClick={() => void unblockPeer(block.account_id)}>
                  Unblock {block.username}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
