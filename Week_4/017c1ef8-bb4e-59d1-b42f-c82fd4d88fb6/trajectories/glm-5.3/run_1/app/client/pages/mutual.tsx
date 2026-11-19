import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { useApp } from '../app-context.js';
import type { PersonCard } from '../types.js';
import { degreeLabel } from '../format.js';

export const MutualPage = ({ handle }: { handle: string }): JSX.Element => {
  const { navigate, liveEvents } = useApp();
  const [data, setData] = useState<{ count: number; members: PersonCard[] } | null>(null);
  const [missing, setMissing] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    try {
      const result = await api.get<{ count: number; members: PersonCard[] }>(`/api/profiles/${handle}/mutual`);
      setData(result);
      setMissing(false);
    } catch {
      setMissing(true);
    }
  }, [handle]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    return liveEvents.subscribe((event) => {
      if (event === 'connection' || event === 'blocked' || event === 'clock') void load();
    });
  }, [liveEvents, load]);

  if (missing) {
    return (
      <div className="big-empty">
        <h2>This profile isn't available</h2>
        <a href="/feed" onClick={(e) => { e.preventDefault(); navigate('/feed'); }}>Go to Home</a>
      </div>
    );
  }
  return (
    <>
      <h1 className="profile-name">Mutual connections with {handle}</h1>
      <ul aria-label="Mutual connections">
        {(data?.members ?? []).map((member) => (
          <li key={member.id} className="person-card" data-member-id={member.id} data-degree={member.degree} data-connection-state={member.connection_state}>
            <a href={`/in/${member.handle}`} onClick={(e) => { e.preventDefault(); navigate(`/in/${member.handle}`); }}>{member.name}</a>
            <p className="entry-headline">{member.headline}</p>
            <span className="degree-label-badge" data-degree-badge data-degree={member.degree}>{degreeLabel(member.degree)}</span>
          </li>
        ))}
      </ul>
    </>
  );
};
