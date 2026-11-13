import type { BoardKind, BoardLength, BoardRow, Mode, PersonalBest } from "../shared/protocol";
import { BOARD_ROWS } from "./config";
import { pool } from "./db";
import type { Queryable } from "./db";

interface RankedRow extends BoardRow {
  readonly typistId: string;
  readonly runId: string;
}

/** One order decides which run is best: the highest speed, then the higher accuracy, then the earlier finish. */
const BEST_ORDER = "speed DESC, accuracy DESC, finished_at ASC";

export const BOARD_LENGTHS: readonly BoardLength[] = [15, 60];

/** Eligible runs are counted time tests of 15 or 60 seconds, punctuation and numbers off, by verified typists; each typist's best ranks. */
const BOARD_SQL = `
  SELECT row_number() OVER (ORDER BY best.speed DESC, best.accuracy DESC, best.finished_at ASC, best.typist_id) AS rank,
         best.name, best.speed, best.accuracy, best.finished_at, best.typist_id, best.run_id
  FROM (
    SELECT DISTINCT ON (r.typist_id) r.typist_id, t.name, r.speed, r.accuracy, r.finished_at, r.id AS run_id
    FROM runs r JOIN typists t ON t.id = r.typist_id
    WHERE r.verdict = 'counted' AND t.verified AND r.mode = 'time' AND r.length = $1
      AND NOT r.punctuation AND NOT r.numbers
      AND ($2::boolean = false OR (r.finished_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
                                   AND r.finished_at < (date_trunc('day', now() AT TIME ZONE 'UTC') + interval '1 day') AT TIME ZONE 'UTC'))
    ORDER BY r.typist_id, r.${BEST_ORDER.split(", ").join(", r.")}
  ) best
  ORDER BY rank
  LIMIT ${BOARD_ROWS}`;

export async function boardRows(kind: BoardKind, length: BoardLength): Promise<RankedRow[]> {
  const { rows } = await pool.query<{ rank: string; name: string; speed: number; accuracy: number; finished_at: Date; typist_id: string; run_id: string }>(BOARD_SQL, [String(length), kind === "daily"]);
  return rows.map((row) => ({ rank: Number(row.rank), name: row.name, speed: row.speed, accuracy: row.accuracy, finishedAt: row.finished_at.toISOString(), typistId: row.typist_id, runId: row.run_id }));
}

export function publicRow(row: RankedRow): BoardRow {
  return { rank: row.rank, name: row.name, speed: row.speed, accuracy: row.accuracy, finishedAt: row.finishedAt };
}

const MODE_ORDER: readonly Mode[] = ["time", "words", "quote", "custom"];
const QUOTE_ORDER = ["short", "medium", "long", "all"];

export function lengthOf(value: string | null): number | string | null {
  return value === null ? null : /^\d+$/.test(value) ? Number(value) : value;
}


function lengthRank(length: number | string | null): [number, number] {
  return typeof length === "number" ? [0, length] : [1, QUOTE_ORDER.indexOf(length ?? "")];
}

/** The best counted run of each setting; best means the highest speed, then the higher accuracy, then the earlier finish. */
export async function personalBestsOf(typistId: string): Promise<PersonalBest[]> {
  const { rows } = await pool.query<{ id: string; mode: Mode; length: string | null; punctuation: boolean; numbers: boolean; speed: number; accuracy: number; finished_at: Date }>(
    `SELECT DISTINCT ON (mode, length, punctuation, numbers) id, mode, length, punctuation, numbers, speed, accuracy, finished_at
     FROM runs WHERE typist_id = $1 AND verdict = 'counted'
     ORDER BY mode, length, punctuation, numbers, ${BEST_ORDER}`,
    [typistId],
  );
  return rows
    .map((row) => ({ mode: row.mode, length: lengthOf(row.length), punctuation: row.punctuation, numbers: row.numbers, speed: row.speed, accuracy: row.accuracy, finishedAt: row.finished_at.toISOString(), runId: row.id }))
    .sort((a, b) => {
      const [aGroup, aValue] = lengthRank(a.length);
      const [bGroup, bValue] = lengthRank(b.length);
      return (
        MODE_ORDER.indexOf(a.mode) - MODE_ORDER.indexOf(b.mode) ||
        aGroup - bGroup ||
        aValue - bValue ||
        Number(a.punctuation) - Number(b.punctuation) ||
        Number(a.numbers) - Number(b.numbers)
      );
    });
}

/** The id of the typist's best counted run in one setting: the run that holds the personal best. */
export async function bestRunId(db: Queryable, typistId: string, setting: { mode: Mode; length: string | null; punctuation: boolean; numbers: boolean }): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `SELECT id FROM runs WHERE typist_id = $1 AND verdict = 'counted' AND mode = $2 AND length IS NOT DISTINCT FROM $3 AND punctuation = $4 AND numbers = $5 ORDER BY ${BEST_ORDER} LIMIT 1`,
    [typistId, setting.mode, setting.length, setting.punctuation, setting.numbers],
  );
  return rows[0]?.id ?? "";
}
