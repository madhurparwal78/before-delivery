import { useEffect, useState } from 'react';
import type { Player, Quest } from '../../shared/types.js';
import { api } from '../api.js';
import { navigate } from '../router.js';

export function localDateIn(instant: string, zone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(instant));
  const read = (type: string): string => parts.find((part) => part.type === type)?.value ?? '';
  return `${read('year')}-${read('month')}-${read('day')}`;
}

export function historyLine(quest: Quest, zone: string): string {
  const ended = quest.endedAt ? localDateIn(quest.endedAt, zone) : '';
  return `${quest.boss}, ${quest.state}, ended ${ended}`;
}

export function History({ player }: { player: Player }): JSX.Element {
  const [quests, setQuests] = useState<Quest[]>([]);

  useEffect(() => {
    void api.history().then((answer) => setQuests(answer.quests));
  }, []);

  return (
    <main className="history-page">
      <h1 className="page-title">Quest history</h1>
      {quests.length === 0 ? (
        <p className="empty-line">No finished quests yet.</p>
      ) : (
        <ul className="history-list" role="list" aria-label="Quest history">
          {quests.map((quest) => (
            <li key={quest.id}>
              <a
                href={`/quests/${quest.id}`}
                onClick={(event) => {
                  event.preventDefault();
                  navigate(`/quests/${quest.id}`);
                }}
              >
                {quest.name}
              </a>
              <span className="history-result">{historyLine(quest, player.timeZone)}</span>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
