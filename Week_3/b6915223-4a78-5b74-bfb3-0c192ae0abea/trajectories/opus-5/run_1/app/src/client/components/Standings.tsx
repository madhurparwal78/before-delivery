import { useEffect, useRef } from 'react';
import type { StandingRow } from '../../shared/types.ts';
import { Link } from '../router.tsx';
import { ROW_MS } from './relay.ts';

export interface StandingsTableProps {
  label: 'League table' | 'Standings';
  rows: StandingRow[];
  leagueId?: string;
  /** The viewer's row, which slides when its rank changes. */
  movingManagerId?: string | null;
}

const RankArrow = ({ row }: { row: StandingRow }) => {
  if (row.last_rank === null || row.last_rank === row.rank) return null;
  const places = Math.abs(row.last_rank - row.rank);
  const up = row.rank < row.last_rank;
  return (
    <span
      role="img"
      aria-label={`${up ? 'Up' : 'Down'} ${places}`}
      className={up ? 'arrow arrow-up' : 'arrow arrow-down'}
    >
      {up ? '▲' : '▼'}
    </span>
  );
};

export const StandingsTable = ({
  label,
  rows,
  leagueId,
  movingManagerId,
}: StandingsTableProps) => {
  const body = useRef<HTMLTableSectionElement | null>(null);
  const offsets = useRef(new Map<string, number>());

  useEffect(() => {
    const node = body.current;
    if (node === null) return;
    const next = new Map<string, number>();
    for (const element of node.querySelectorAll<HTMLTableRowElement>('tr[data-manager-id]')) {
      const managerId = element.dataset.managerId!;
      const top = element.offsetTop;
      const previous = offsets.current.get(managerId);
      next.set(managerId, top);
      if (previous === undefined || previous === top) continue;
      element.animate(
        [{ transform: `translateY(${previous - top}px)` }, { transform: 'translateY(0)' }],
        { duration: ROW_MS, easing: 'ease-out' },
      );
    }
    offsets.current = next;
  }, [rows]);

  return (
    <table aria-label={label} className="figures-table">
      <thead>
        <tr>
          <th scope="col">Rank</th>
          <th scope="col">Team</th>
          <th scope="col">GW</th>
          <th scope="col">Total</th>
        </tr>
      </thead>
      <tbody ref={body}>
        {rows.map((row) => (
          <tr
            key={row.manager_id}
            data-manager-id={row.manager_id}
            data-rank={row.rank}
            data-points={row.season_total}
            className={movingManagerId === row.manager_id ? 'row-moving' : undefined}
          >
            <td className="mono">
              {row.rank}
              <RankArrow row={row} />
            </td>
            <td>
              {leagueId === undefined ? (
                row.team_name
              ) : (
                <Link to={`/leagues/${leagueId}/members/${row.manager_id}`}>{row.team_name}</Link>
              )}
            </td>
            <td className="mono">{row.gameweek_points}</td>
            <td className="mono">{row.season_total}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};
