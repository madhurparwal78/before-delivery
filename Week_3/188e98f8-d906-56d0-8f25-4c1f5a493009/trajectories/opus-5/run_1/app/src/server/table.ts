/** The one place the ruled score, the league total and the table order are decided. */

import type { LeagueTable } from '../shared/model.js';
import type { Db } from './db.js';

interface TableRow {
  team_id: number;
  name: string;
  total: number;
  last_score: number | null;
}

export async function leagueTable(db: Db): Promise<LeagueTable> {
  const league = await db.query<{ night: number; table_version: number; last_published_round: number | null }>(
    'select night, table_version, last_published_round from league where id = 1',
  );
  const head = league.rows[0];
  if (head === undefined) throw new Error('league missing');

  const result = await db.query<TableRow>(
    `select t.id as team_id,
            t.name,
            (t.night_1 + t.night_2 + t.night_3 + coalesce(published.total, 0))::int as total,
            last.score as last_score
       from teams t
       left join (
         select team_id, sum(score)::int as total from published_scores group by team_id
       ) published on published.team_id = t.id
       left join published_scores last on last.team_id = t.id and last.round = $1
      order by total desc, t.name collate "C" asc`,
    [head.last_published_round],
  );

  return {
    night: head.night,
    version: head.table_version,
    last_published_round: head.last_published_round,
    teams: result.rows.map((row, index) => ({
      position: index + 1,
      team_id: row.team_id,
      name: row.name,
      total: row.total,
      last_round:
        head.last_published_round === null || row.last_score === null
          ? null
          : { round: head.last_published_round, score: row.last_score },
    })),
  };
}
