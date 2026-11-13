import type { Table, TableTeam } from "../shared/api-types";
import { NIGHT } from "./seed";
import type { Db } from "./db";

interface TableRow extends TableTeam {
  version: number;
  last_published_round: number | null;
  last_score: number | null;
}

/**
 * The league table, derived at read time: a team's total is its seeded past scores plus the
 * ruled score of its current answers in every published round; order is total, highest first,
 * then team name in ascending Unicode code-point order.
 */
export async function loadTable(db: Db): Promise<Table> {
  const result = await db.query<TableRow>(`
    WITH last AS (
      SELECT number FROM rounds WHERE status = 'published' ORDER BY published_at DESC, number DESC LIMIT 1
    ), scores AS (
      SELECT t.id, t.name,
        (SELECT coalesce(sum(score), 0) FROM past_scores p WHERE p.team_id = t.id)
          + (SELECT coalesce(sum(ra.ruled), 0) FROM ruled_answers ra JOIN rounds r ON r.number = ra.round
             WHERE ra.team_id = t.id AND ra.current AND r.status = 'published') AS total,
        (SELECT coalesce(sum(ra.ruled), 0) FROM ruled_answers ra
           WHERE ra.team_id = t.id AND ra.current AND ra.round = (SELECT number FROM last)) AS last_score
      FROM teams t
    )
    SELECT row_number() OVER (ORDER BY total DESC, name COLLATE "C")::int AS position,
      id AS team_id, name, total::int AS total, last_score::int AS last_score,
      (SELECT number FROM last) AS last_published_round,
      (SELECT table_version FROM league) AS version
    FROM scores ORDER BY position`);
  const first = result.rows[0];
  return {
    night: NIGHT,
    version: first?.version ?? 1,
    last_published_round: first?.last_published_round ?? null,
    teams: result.rows.map((row) => ({
      position: row.position,
      team_id: row.team_id,
      name: row.name,
      total: row.total,
      last_round: row.last_published_round === null ? null : { round: row.last_published_round, score: row.last_score ?? 0 },
    })),
  };
}
