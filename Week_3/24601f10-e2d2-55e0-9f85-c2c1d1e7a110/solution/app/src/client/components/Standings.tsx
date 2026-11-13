import type { ReactNode } from 'react';
import type { StandingRow, StandingsView } from '../../shared/api.js';
import { formatFigure, signed } from '../format.js';

const cells = (row: StandingRow, swiss: boolean): ReactNode[] => {
  const base = [row.place, row.name, row.played, formatFigure(row.match_points)];
  const tail = swiss
    ? [formatFigure(row.buchholz_cut_1 ?? 0), formatFigure(row.buchholz ?? 0), formatFigure(row.sonneborn_berger ?? 0)]
    : [row.head_to_head ?? 0, signed(row.game_difference ?? 0), row.games_won ?? 0];
  return [...base, ...tail, row.seed, row.decided_by];
};

export function Standings({ standings }: { standings: StandingsView }): ReactNode {
  const swiss = standings.columns.includes('Buchholz');
  return (
    <div className="table-scroll" role="group" aria-label="Standings table" tabIndex={0}>
      <table aria-label="Standings" className="standings">
        <thead>
          <tr>{standings.columns.map((column) => <th key={column} scope="col">{column}</th>)}</tr>
        </thead>
        <tbody>
          {standings.rows.map((row) => (
            <tr key={row.entrant_id}>{cells(row, swiss).map((cell, index) => <td key={index}>{cell}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
