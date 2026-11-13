import { useEffect, useState } from 'react';
import { api, fmt1, MINUS, type Quest } from './api.js';
import { useStore } from './store.js';

/** Quest history (DP-48). */
export function HistoryPage() {
  const [quests, setQuests] = useState<Quest[]>([]);
  const [error, setError] = useState('');
  const store = useStore();

  useEffect(() => {
    api.history()
      .then((r) => setQuests(r.quests))
      .catch(() => setError('Something went wrong. Try again.'));
  }, []);

  return (
    <section className="history-page">
      <h1 className="page-title">Quest history</h1>
      {error && <div className="alert-strip" role="alert">{error}</div>}
      {quests.length === 0 ? (
        <p className="empty-sentence">No finished quests yet.</p>
      ) : (
        <ul className="quest-history" aria-label="Quest history">
          {quests.map((q) => (
            <li key={q.id} className="history-row">
              <a href={`/quests/${q.id}`}>{q.name}</a>
              <span className="history-entry">
                {q.boss}, {q.state}, ended {historyDate(q.endedAt, store.player?.timeZone ?? 'UTC')}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function historyDate(ended: string | null, zone: string): string {
  if (!ended) return '';
  return new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ended));
}

/** One quest's detail page (DP-48, DP-50). */
export function QuestPage({ questId }: { questId: string }) {
  const store = useStore();
  const [quest, setQuest] = useState<Quest | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.quest(questId)
      .then((q) => setQuest(q))
      .catch((err) => {
        if ((err as { status?: number }).status === 404) setNotFound(true);
        else setError('Something went wrong. Try again.');
      });
  }, [questId]);

  if (notFound) {
    return (
      <section className="quest-notfound">
        <h1 className="page-title">Quest not found</h1>
        <p className="body">This quest does not exist or is not yours to see.</p>
      </section>
    );
  }
  if (error) {
    return (
      <section className="quest-notfound">
        <div className="alert-strip" role="alert">{error}</div>
      </section>
    );
  }
  if (!quest) return null;

  return (
    <section className="quest-page">
      <h1 className="page-title">{quest.name}</h1>
      <p className="quest-state-line">State: {quest.state}</p>
      <h2 className="section-title">Member damage</h2>
      <ul className="member-damage" aria-label="Member damage">
        {quest.members.map((m) => (
          <li key={m.username} className="history-row">
            <span>{m.username}</span>
            <span className="tabular">{fmt1(m.damage)}</span>
          </li>
        ))}
      </ul>
      <h2 className="section-title">Strikes</h2>
      <ul className="strike-list" aria-label="Strikes">
        {quest.events.map((e) => (
          <li key={e.id} className="strike-line">
            {e.kind === 'strike'
              ? `${e.username} ${MINUS}${e.amount.toFixed(1)}`
              : `${quest.boss} struck back for ${e.amount.toFixed(1)} (${e.username} missed ${e.missed})`}
          </li>
        ))}
      </ul>
      <p className="quest-dates">
        Invited {dateOf(quest.invitedAt)} · Started {quest.startedAt ? dateOf(quest.startedAt) : '—'} · Ended {quest.endedAt ? dateOf(quest.endedAt) : '—'}
      </p>
    </section>
  );
}

function dateOf(iso: string): string {
  return iso.slice(0, 10);
}
