import { useEffect, useState, type KeyboardEvent, type ReactNode } from 'react';
import { formatNumber } from '../../shared/domain';
import { api } from '../api';
import type { Store } from '../store';
import { RackGlyph, Screen } from '../ui';

const SCOPES = ['Global', 'Friends', 'Club'] as const;
type Scope = (typeof SCOPES)[number];
const EMPTY: Record<Scope, string> = { Global: '', Friends: 'No friends on the board yet.', Club: 'Join a club to see this board.' };

interface Board {
  rows: { rank: number; playerId: string; displayName: string; wins: number }[];
  own: { rank: number | null; wins: number };
}

export function Leaderboards({ store }: { store: Store }): ReactNode {
  const [scope, setScope] = useState<Scope>('Global');
  const [board, setBoard] = useState<Board | null>(null);
  useEffect(() => {
    void api<Board>('GET', `/api/leaderboards?scope=${scope.toLowerCase()}`).then(setBoard).catch(() => undefined);
  }, [scope]);
  const onKey = (event: KeyboardEvent): void => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    const step = event.key === 'ArrowRight' ? 1 : -1;
    setScope(SCOPES[(SCOPES.indexOf(scope) + step + SCOPES.length) % SCOPES.length]);
  };
  const name = store.me?.displayName ?? '';
  return (
    <Screen store={store} title="Leaderboards">
      <div className="tablist" role="tablist" aria-label="Scope" onKeyDown={onKey}>
        {SCOPES.map((item) => (
          <button key={item} type="button" role="tab" aria-selected={scope === item} tabIndex={scope === item ? 0 : -1} onClick={() => setScope(item)}>{item}</button>
        ))}
      </div>
      {board?.rows.length === 0 && EMPTY[scope] !== '' ? (
        <div className="empty"><RackGlyph /><p>{EMPTY[scope]}</p></div>
      ) : (
        <table className="figures" aria-label="Weekly wins">
          <thead><tr><th scope="col">Rank</th><th scope="col">Name</th><th scope="col">Wins</th></tr></thead>
          <tbody>
            {board?.rows.map((row) => (
              <tr key={row.playerId} className="rank-row">
                <td>{formatNumber(row.rank)}</td>
                <td>{row.displayName}</td>
                <td>{formatNumber(row.wins)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <section className="rank-pin" role="region" aria-label="Your rank">
        {board === null ? '–' : board.own.rank === null ? 'Unranked' : `#${formatNumber(board.own.rank)} ${name} ${formatNumber(board.own.wins)} wins`}
      </section>
    </Screen>
  );
}
