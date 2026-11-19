import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, ApiError } from '../api';
import { PersonCard } from '../components/PersonCard';
import { useLive } from '../live';
import type { PersonCard as PersonCardData, Profile } from '../types';
import { EmptyState } from '../ui';

interface Mutuals {
  name: string;
  members: PersonCardData[];
}

/** `/in/<handle>/mutual`: the connections the viewer shares with that member, in the published order. */
export default function Mutual() {
  const { handle = '' } = useParams();
  const [data, setData] = useState<Mutuals | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    try {
      const [profile, mutual] = await Promise.all([api.get<Profile>(`/api/profiles/${handle}`), api.get<{ count: number; members: PersonCardData[] }>(`/api/profiles/${handle}/mutual`)]);
      setData({ name: profile.name, members: mutual.members });
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) setUnavailable(true);
    }
  }, [handle]);

  useEffect(() => {
    void load();
  }, [load]);
  useLive(['graph', 'network', 'reconnected'], () => void load());

  if (unavailable) return <EmptyState heading="h1" sentence="This profile isn't available" action={{ label: 'Go to Home', to: '/feed' }} />;
  if (!data) return null;
  return (
    <div className="stack">
      <h1 className="page-title">{`Mutual connections with ${data.name}`}</h1>
      <ul className="plain-list stack" aria-label="Mutual connections">
        {data.members.map((member) => (
          <PersonCard key={member.id} card={member} />
        ))}
      </ul>
    </div>
  );
}
