import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { useApp } from '../app-context.js';
import { announce } from '../main.js';
import type { Profile } from '../types.js';

export const SettingsPage = (): JSX.Element => {
  const { me, liveEvents } = useApp();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [blocked, setBlocked] = useState<{ id: string; name: string; handle: string; blocked_at: string }[]>([]);

  const load = useCallback(async (): Promise<void> => {
    const [meProfile, blocks] = await Promise.all([
      api.get<Profile>('/api/me'),
      api.get<{ blocked: { id: string; name: string; handle: string; blocked_at: string }[] }>('/api/blocks'),
    ]);
    setProfile(meProfile);
    setBlocked(blocks.blocked);
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    return liveEvents.subscribe((event) => {
      if (event === 'blocked' || event === 'connection') void load();
    });
  }, [liveEvents, load]);

  const setVisibility = async (value: string): Promise<void> => {
    await api.patch('/api/me/settings', { visibility: value });
    announce('Profile announcements', 'Visibility saved.');
    await load();
  };

  const unblock = async (memberId: string, name: string): Promise<void> => {
    await api.delete(`/api/blocks/${memberId}`);
    announce('Network announcements', `Unblocked ${name}.`);
    await load();
  };

  return (
    <>
      <h1 className="profile-name">Settings</h1>
      <section aria-label="Profile visibility">
        <h2 aria-level={2}>Profile visibility</h2>
        <fieldset role="radiogroup" aria-label="Profile visibility">
          {(['public', 'connections', 'private'] as const).map((value) => (
            <label key={value}>
              <input
                type="radio"
                name="visibility"
                value={value}
                checked={(profile?.visibility ?? 'public') === value}
                onChange={() => { void setVisibility(value); }}
              />
              {value === 'public' ? 'Public' : value === 'connections' ? 'Connections only' : 'Private'}
            </label>
          ))}
        </fieldset>
      </section>
      <section aria-label="Blocked members">
        <h2 aria-level={2}>Blocked members</h2>
        {blocked.length === 0 ? (
          <p>You haven't blocked anyone.</p>
        ) : (
          <ul aria-label="Blocked members">
            {blocked.map((member) => (
              <li key={member.id}>
                {member.name}
                <button type="button" className="text-button" onClick={() => { void unblock(member.id, member.name); }}>
                  Unblock {member.name}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <p className="visually-hidden">Signed in as {me?.name}</p>
    </>
  );
};
