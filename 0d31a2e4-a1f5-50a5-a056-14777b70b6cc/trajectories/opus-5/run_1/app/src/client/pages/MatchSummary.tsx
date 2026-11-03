import { useEffect, useState } from 'react';
import { roundKindLabel } from '../../shared/rounds.js';
import type { Match } from '../../shared/types.js';
import { api } from '../lib/api.js';
import { Link } from '../lib/router.js';
import { Bean } from '../lib/ui.js';

export function MatchSummaryPage({ matchId }: { matchId: number }) {
  const [match, setMatch] = useState<Match | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    const run = async (): Promise<void> => {
      try {
        const payload = await api.get<{ match: Match }>(`/api/matches/${matchId}`);
        setMatch(payload.match);
      } catch {
        setMissing(true);
      }
    };
    void run();
  }, [matchId]);

  if (missing) {
    return (
      <section className="card">
        <h1>Match not found</h1>
      </section>
    );
  }
  if (match === null) return <section className="card">Loading match…</section>;

  const handleOf = (userId: number): string =>
    match.participants.find((user) => user.id === userId)?.handle ?? `#${userId}`;
  const hueOf = (userId: number): number =>
    match.participants.find((user) => user.id === userId)?.hue ?? 200;

  return (
    <div className="match-summary">
      <section className="card">
        <h1>{`Cup #${match.id}`}</h1>
        <p>
          {match.state === 'finished'
            ? `Finished ${new Date(match.finishedAt ?? '').toLocaleString()}`
            : 'Running now'}
        </p>
        {match.winnerId === null ? null : (
          <p className="match-winner">
            <Bean hue={hueOf(match.winnerId)} size={32} />
            <Link to={`/u/${handleOf(match.winnerId)}`}>{handleOf(match.winnerId)}</Link>
            <span className="tag-qualified">Winner</span>
          </p>
        )}
      </section>
      {match.rounds.map((round) => (
        <section className="card round-card" key={round.n}>
          <h2>{`${round.name} · ${roundKindLabel(round.kind)}`}</h2>
          <dl className="round-facts">
            <dt>Seed</dt>
            <dd>{round.seed}</dd>
            <dt>Starters</dt>
            <dd>{round.starters.length}</dd>
            <dt>Slots</dt>
            <dd>{round.slots}</dd>
            <dt>Last tick</dt>
            <dd>{round.lastTick ?? '—'}</dd>
          </dl>
          <ul className="qualified-list">
            {round.results
              .filter((result) => result.outcome === 'qualified')
              .map((result) => (
                <li key={result.userId} data-user-id={result.userId}>
                  <Bean hue={hueOf(result.userId)} size={24} />
                  <span className="handle">{handleOf(result.userId)}</span>
                  <span className="tag-qualified">Qualified</span>
                </li>
              ))}
          </ul>
          <p>
            <Link to={`/matches/${match.id}/rounds/${round.n}`}>
              {`Photo-finish: ${round.name}`}
            </Link>
          </p>
        </section>
      ))}
    </div>
  );
}
