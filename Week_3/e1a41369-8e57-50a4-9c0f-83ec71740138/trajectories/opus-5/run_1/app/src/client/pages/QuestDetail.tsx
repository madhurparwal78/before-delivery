import { useEffect, useState } from 'react';
import type { Quest } from '../../shared/types.js';
import { tenths1 } from '../../shared/format.js';
import { api } from '../api.js';
import { strikeLine } from '../components/PartyRail.js';

export function NotFound(): JSX.Element {
  return (
    <main className="not-found">
      <h1 className="page-title">Quest not found</h1>
      <p>This quest does not exist or is not yours to see.</p>
    </main>
  );
}

export function QuestDetail({ questId }: { questId: string }): JSX.Element {
  const [quest, setQuest] = useState<Quest | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    setMissing(false);
    setQuest(null);
    void api
      .quest(questId)
      .then((answer) => setQuest(answer))
      .catch(() => setMissing(true));
  }, [questId]);

  if (missing) return <NotFound />;
  if (!quest) return <main className="quest-detail" />;

  return (
    <main className="quest-detail">
      <h1 className="page-title">{quest.name}</h1>
      <p className="quest-state">{`State: ${quest.state}`}</p>
      <ul className="damage-list" role="list" aria-label="Member damage">
        {quest.members.map((member) => (
          <li key={member.username}>
            <span>{member.username}</span> <span className="tabular">{tenths1(member.damage)}</span>
          </li>
        ))}
      </ul>
      <ul className="strike-list" role="list" aria-label="Strikes">
        {quest.events.map((event) => (
          <li key={event.id} className="strike-line">
            <span>{strikeLine(event, quest.boss)}</span>
          </li>
        ))}
      </ul>
    </main>
  );
}
