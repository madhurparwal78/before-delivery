import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useConfig, useNow } from '../clock';
import { PersonCard, type CardAction } from '../components/PersonCard';
import { relativeTime } from '../format';
import { useLive } from '../live';
import { useNavCounts } from '../navcounts';
import { SentGrid } from '../network/SentGrid';
import type { Network as NetworkData, PersonCard as PersonCardData } from '../types';
import { EmptyState } from '../ui';
import '../network/network.css';

/** Where focus goes after Accept or Ignore: the same button of the next invitation, else the one before, else the heading. */
interface FocusPlan {
  memberId: string | null;
  button: 'Accept' | 'Ignore';
}

export default function Network() {
  const config = useConfig();
  const now = useNow();
  const counts = useNavCounts();
  const [data, setData] = useState<NetworkData | null>(null);
  const [plan, setPlan] = useState<FocusPlan | null>(null);
  const received = useRef<PersonCardData[]>([]);
  received.current = data?.received ?? [];

  const load = useCallback(async (): Promise<void> => {
    setData(await api.get<NetworkData>('/api/network'));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);
  useLive(['network', 'graph', 'reconnected'], () => void load());

  useEffect(() => {
    if (!plan || !data) return;
    if (plan.memberId === null) document.getElementById('invitations-heading')?.focus();
    else {
      const card = document.querySelector(`[aria-label="Invitations"] [data-member-id="${plan.memberId}"]`);
      card?.querySelector<HTMLElement>(`button[aria-label^="${plan.button} "]`)?.focus();
    }
    setPlan(null);
  }, [data, plan]);

  const answered = (action: CardAction, card: PersonCardData): void => {
    if (action !== 'accept' && action !== 'ignore') return;
    const list = received.current;
    const index = list.findIndex((item) => item.id === card.id);
    const neighbour = list[index + 1] ?? list[index - 1];
    const button = action === 'accept' ? 'Accept' : 'Ignore';
    void load().then(() => {
      setPlan({ memberId: neighbour?.id ?? null, button });
      counts.refresh();
    });
  };

  if (!data) return <h1 className="page-title">My network</h1>;

  return (
    <div className="network">
      <h1 className="page-title">My network</h1>

      <p className="net-summary">
        <span className="net-count t-display" data-connections-count>
          {data.connections.length}
        </span>
        <span className="t-larger">{data.connections.length === 1 ? 'connection' : 'connections'}</span>
      </p>

      <section className="net-section net-invitations" aria-labelledby="invitations-heading">
        <p className="net-count t-display" aria-hidden="true">
          {data.received.length}
        </p>
        <h2 id="invitations-heading" tabIndex={-1}>
          Invitations
        </h2>
        {data.received.length > 0 ? (
          <ul aria-label="Invitations" className="plain-list net-list">
            {data.received.map((card) => (
              <PersonCard
                key={card.id}
                card={card}
                note={card.requested_at ? relativeTime(card.requested_at, now, config.time_zone) : undefined}
                onAct={answered}
              />
            ))}
          </ul>
        ) : (
          <EmptyState sentence="No pending invitations." action={{ label: 'Search for people', to: '/search?type=people&q=' }} />
        )}
      </section>

      <section className="net-section net-sent" aria-labelledby="sent-invitations-heading">
        <p className="net-count t-display" aria-hidden="true">
          {data.sent.length}
        </p>
        <h2 id="sent-invitations-heading" tabIndex={-1}>
          Sent invitations
        </h2>
        {data.sent.length > 0 ? (
          <SentGrid
            rows={data.sent}
            onWithdrawn={(ids) => setData((current) => (current ? { ...current, sent: current.sent.filter((card) => !ids.includes(card.id)) } : current))}
            reload={() => void load()}
          />
        ) : (
          <EmptyState sentence="No pending invitations." />
        )}
      </section>

      <section className="net-section net-connections" aria-labelledby="connections-heading">
        <h2 id="connections-heading" tabIndex={-1}>
          Connections
        </h2>
        <ul aria-label="Connections" className="plain-list net-list">
          {data.connections.map((card) => (
            <PersonCard
              key={card.id}
              card={card}
              note={card.connected_at ? `Connected ${relativeTime(card.connected_at, now, config.time_zone)}` : undefined}
            />
          ))}
        </ul>
      </section>
    </div>
  );
}
