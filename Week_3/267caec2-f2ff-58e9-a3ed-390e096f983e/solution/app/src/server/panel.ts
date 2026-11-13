import type pg from "pg";
import { lockKey, many } from "./db.js";
import type { Db } from "./db.js";

// Who is assigned what in a round (brief: Business rules, Jurors, conflicts and assignment). Panel tables and
// ballots both read their counts here, so they always agree.

export interface PanelRow {
  jurorId: string;
  name: string;
  assigned: number;
  scored: number;
  remaining: number;
  ballotSubmitted: boolean;
}

interface RoundRef {
  id: string;
  category_id: string;
  kind: string;
  state: string;
}

/** A juror's excluded studios: the home studio plus every declared conflict. */
const EXCLUDED_STUDIOS = `
  SELECT u.studio_id AS studio_id FROM users u WHERE u.id = $JUROR AND u.studio_id IS NOT NULL
  UNION SELECT k.studio_id FROM conflicts k WHERE k.juror_id = $JUROR`;

function excluded(jurorColumn: string): string {
  return EXCLUDED_STUDIOS.replaceAll("$JUROR", jurorColumn);
}

/** The state an entry must be in to enter the round when it opens. */
export function enteringState(kind: string): "screened" | "shortlisted" {
  return kind === "round_1" ? "screened" : "shortlisted";
}

/** Panel rows: stored assignments once the round has opened, computed on every read while it is scheduled. */
export async function panelRows(db: Db, round: RoundRef, jurorId: string | null = null): Promise<PanelRow[]> {
  const rows = round.state === "scheduled"
    ? await many<{ juror_id: string; name: string; assigned: number; scored: number; submitted: boolean }>(db,
      `SELECT pm.juror_id, u.name, 0 AS scored, false AS submitted,
         (SELECT count(*)::int FROM entries e WHERE e.category_id = $2 AND e.state = $3
            AND e.studio_id NOT IN (${excluded("pm.juror_id")})) AS assigned
       FROM panel_members pm JOIN users u ON u.id = pm.juror_id
       WHERE pm.round_id = $1 AND ($4::text IS NULL OR pm.juror_id = $4)
       ORDER BY pm.added_at, u.name`,
      [round.id, round.category_id, enteringState(round.kind), jurorId])
    : await many<{ juror_id: string; name: string; assigned: number; scored: number; submitted: boolean }>(db,
      `SELECT pm.juror_id, u.name,
         (SELECT count(*)::int FROM assignments a WHERE a.round_id = pm.round_id AND a.juror_id = pm.juror_id) AS assigned,
         (SELECT count(*)::int FROM assignments a JOIN scores s
            ON s.round_id = a.round_id AND s.juror_id = a.juror_id AND s.entry_id = a.entry_id
          WHERE a.round_id = pm.round_id AND a.juror_id = pm.juror_id) AS scored,
         EXISTS (SELECT 1 FROM ballots b WHERE b.round_id = pm.round_id AND b.juror_id = pm.juror_id) AS submitted
       FROM panel_members pm JOIN users u ON u.id = pm.juror_id
       WHERE pm.round_id = $1 AND ($2::text IS NULL OR pm.juror_id = $2)
       ORDER BY pm.added_at, u.name`,
      [round.id, jurorId]);
  return rows.map((r) => ({
    jurorId: r.juror_id,
    name: r.name,
    assigned: r.assigned,
    scored: r.scored,
    remaining: r.submitted ? 0 : r.assigned - r.scored,
    ballotSubmitted: r.submitted,
  }));
}

/** Stores the juror's assignments for an open round: every round entry outside their excluded studios and recusals. */
export async function assignJuror(db: pg.PoolClient, roundId: string, jurorId: string): Promise<void> {
  await lockKey(db, `juror:${jurorId}`);
  await db.query(
    `INSERT INTO assignments (round_id, juror_id, entry_id)
     SELECT re.round_id, $2, re.entry_id FROM round_entries re JOIN entries e ON e.id = re.entry_id
     WHERE re.round_id = $1 AND e.studio_id NOT IN (${excluded("$2")})
       AND NOT EXISTS (SELECT 1 FROM recusals x WHERE x.round_id = re.round_id AND x.juror_id = $2 AND x.entry_id = re.entry_id)
     ON CONFLICT DO NOTHING`,
    [roundId, jurorId]);
}
