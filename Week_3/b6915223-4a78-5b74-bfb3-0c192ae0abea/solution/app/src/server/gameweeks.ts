import type { CurrentGameweek, Fixture, GameweekStatus } from "../shared/api.ts";
import type { Db } from "./db.ts";
import { pool } from "./db.ts";
import { leagueTime } from "../shared/leaguetime.ts";
import { queueNotice, noticeText } from "./notices.ts";
import { managerWriteRefusal } from "./rules/gameweek.ts";
import { ApiError } from "./errors.ts";
import { LAST_GAMEWEEK } from "./seed.ts";

export interface GameweekRow {
  number: number;
  status: GameweekStatus;
  deadline: Date | null;
  first_kickoff: Date | null;
}

const COLUMNS = "number, status, deadline, first_kickoff";

// The current gameweek is the one that is open, locked or live; after the season, gameweek 36.
export async function currentGameweek(db: Db | typeof pool, forShare = false): Promise<GameweekRow> {
  const lock = forShare ? " FOR SHARE" : "";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const found = await db.query<GameweekRow>(
      `SELECT ${COLUMNS} FROM gameweeks WHERE status IN ('open', 'locked', 'live') ORDER BY number LIMIT 1${lock}`,
    );
    if (found.rows[0]) return found.rows[0];
  }
  const last = await db.query<GameweekRow>(`SELECT ${COLUMNS} FROM gameweeks WHERE number = $1${lock}`, [LAST_GAMEWEEK]);
  return last.rows[0]!;
}

export async function gameweekForShare(db: Db, number: number): Promise<GameweekRow> {
  const found = await db.query<GameweekRow>(`SELECT ${COLUMNS} FROM gameweeks WHERE number = $1 FOR SHARE`, [number]);
  return found.rows[0]!;
}

export async function describeGameweek(db: Db | typeof pool, gameweek: GameweekRow): Promise<CurrentGameweek> {
  const fixtures = await db.query<{ id: string; home: string; away: string; kickoff: Date }>(
    "SELECT id, home, away, kickoff FROM fixtures WHERE gameweek = $1 ORDER BY kickoff, id",
    [gameweek.number],
  );
  return {
    number: gameweek.number,
    status: gameweek.status,
    deadline: gameweek.deadline?.toISOString() ?? null,
    deadline_local: gameweek.deadline ? leagueTime(gameweek.deadline) : null,
    first_kickoff: gameweek.first_kickoff?.toISOString() ?? null,
    fixtures: fixtures.rows.map((row): Fixture => ({ id: row.id, home: row.home, away: row.away, kickoff: row.kickoff.toISOString() })),
    server_time: new Date().toISOString(),
  };
}

export function assertWritable(gameweek: GameweekRow): void {
  const refusal = managerWriteRefusal(gameweek.number, gameweek.status, gameweek.deadline, new Date());
  if (refusal) throw refusal;
}

// A squad, transfer, pick or chip change refused at or after the deadline leaves a notice (brief: DP-32).
export async function withLateNotice<T>(managerId: string, gameweek: () => number | null, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    const number = gameweek();
    if (error instanceof ApiError && error.code === "gameweek_locked" && number !== null) {
      await queueNotice(pool, managerId, "transfer_refused", number, noticeText.transferRefused(number));
    }
    throw error;
  }
}
