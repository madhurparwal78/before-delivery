import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { announce } from '../announce';
import { useConfig } from '../clock';
import { formatDate } from '../format';
import { useLive } from '../live';
import type { Visibility } from '../types';
import { Alert, EmptyState, LinkButton } from '../ui';
import '../settings/settings.css';

interface BlockedMember {
  id: string;
  name: string;
  handle: string;
  blocked_at: string;
}

const OPTIONS: Array<{ value: Visibility; label: string; meaning: string }> = [
  { value: 'public', label: 'Public', meaning: 'Every member sees your whole profile.' },
  { value: 'connections', label: 'Connections only', meaning: 'Only your connections see your sections. Others see your name, headline and degree.' },
  { value: 'private', label: 'Private', meaning: 'Only your connections see your name and headline. Everyone else gets nothing.' },
];

export default function Settings() {
  const config = useConfig();
  const [visibility, setVisibility] = useState<Visibility | null>(null);
  const [blocked, setBlocked] = useState<BlockedMember[] | null>(null);
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);

  const loadBlocked = useCallback(async (): Promise<void> => {
    setBlocked((await api.get<{ blocked: BlockedMember[] }>('/api/blocks')).blocked);
  }, []);

  useEffect(() => {
    void api.get<{ visibility: Visibility }>('/api/me').then((me) => setVisibility(me.visibility));
    void loadBlocked();
  }, [loadBlocked]);
  useLive(['graph', 'reconnected'], () => void loadBlocked());

  const choose = async (next: Visibility): Promise<void> => {
    setProblem('');
    setVisibility(next);
    try {
      await api.patch('/api/me/settings', { visibility: next });
      announce('Profile announcements', 'Visibility saved.');
    } catch {
      setProblem('Something went wrong. Try again.');
    }
  };

  const unblock = async (member: BlockedMember): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setProblem('');
    try {
      await api.delete(`/api/blocks/${member.id}`);
      announce('Network announcements', `Unblocked ${member.name}.`);
      await loadBlocked();
    } catch {
      setProblem('Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="settings">
      <h1 className="page-title">Settings</h1>
      <Alert>{problem}</Alert>

      <section className="settings-section" aria-labelledby="visibility-heading">
        <h2 id="visibility-heading">Profile visibility</h2>
        {/* Rendered before the stored choice arrives, so nothing below moves when it does. */}
        <div role="radiogroup" aria-labelledby="visibility-heading" className="visibility-options">
          {OPTIONS.map((option) => (
            <label key={option.value} className="choice surface">
              <input
                type="radio"
                name="visibility"
                value={option.value}
                checked={visibility === option.value}
                disabled={!visibility}
                aria-labelledby={`choice-${option.value}`}
                aria-describedby={`choice-${option.value}-meaning`}
                onChange={() => void choose(option.value)}
              />
              <span className="choice-text">
                <span id={`choice-${option.value}`} className="choice-label">
                  {option.label}
                </span>
                <span id={`choice-${option.value}-meaning`} className="muted">
                  {option.meaning}
                </span>
              </span>
            </label>
          ))}
        </div>
      </section>

      <section className="settings-section settings-blocked" aria-labelledby="blocked-heading">
        <h2 id="blocked-heading">Blocked members</h2>
        {blocked && blocked.length === 0 ? <EmptyState sentence="You haven't blocked anyone." /> : null}
        {blocked && blocked.length > 0 ? (
          <ul aria-label="Blocked members" className="plain-list blocked-list">
            {blocked.map((member) => (
              <li key={member.id} className="surface blocked-item">
                <p className="blocked-name">{member.name}</p>
                <p className="muted">Blocked {formatDate(member.blocked_at, config.time_zone)}</p>
                <LinkButton aria-label={`Unblock ${member.name}`} disabled={busy} onClick={() => void unblock(member)}>
                  Unblock
                </LinkButton>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </div>
  );
}
