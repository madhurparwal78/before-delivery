import { one, pool, query, type Queryable } from '../db.ts';
import type { CurrentGameweek, FixtureRow, GameweekStatus } from '../../shared/types.ts';
import { formatLeagueDeadline } from '../../shared/leagueTime.ts';
import { TOTAL_GAMEWEEKS } from '../domain/seed.ts';
import { conflict } from '../http/errors.ts';

export const DEADLINE_LEAD_MINUTES = 90;

export interface GameweekRecord {
  number: number;
  status: GameweekStatus;
  deadline: Date | null;
  first_kickoff: Date | null;
  locked_at: Date | null;
  closed_at: Date | null;
}

const SELECT = 'select number, status, deadline, first_kickoff, locked_at, closed_at from gameweeks';

export const deadlineFor = (firstKickoff: Date): Date =>
  new Date(firstKickoff.getTime() - DEADLINE_LEAD_MINUTES * 60_000);

/** The status the server stands behind right now, even before the tick commits it. */
export const effectiveStatus = (gameweek: GameweekRecord, now: Date): GameweekStatus => {
  if (
    gameweek.status === 'open' &&
    gameweek.deadline !== null &&
    now.getTime() >= gameweek.deadline.getTime()
  ) {
    return 'locked';
  }
  if (
    gameweek.status === 'locked' &&
    gameweek.first_kickoff !== null &&
    now.getTime() >= gameweek.first_kickoff.getTime()
  ) {
    return 'live';
  }
  return gameweek.status;
};

export const listGameweeks = async (): Promise<GameweekRecord[]> =>
  query<GameweekRecord>(pool, `${SELECT} order by number`);

export const gameweekByNumber = async (number: number): Promise<GameweekRecord | undefined> =>
  one<GameweekRecord>(pool, `${SELECT} where number = $1`, [number]);

export const currentGameweek = async (on: Queryable = pool): Promise<GameweekRecord> => {
  const active = await one<GameweekRecord>(
    on,
    `${SELECT} where status in ('open','locked','live') order by number limit 1`,
  );
  if (active !== undefined) return active;
  return (await one<GameweekRecord>(on, `${SELECT} where number = $1`, [TOTAL_GAMEWEEKS]))!;
};

export const fixturesFor = async (gameweek: number): Promise<FixtureRow[]> => {
  const rows = await query<{ id: string; home: string; away: string; kickoff: Date }>(
    pool,
    'select id, home, away, kickoff from fixtures where gameweek = $1 order by kickoff, id',
    [gameweek],
  );
  return rows.map((fixture) => ({
    id: fixture.id,
    home: fixture.home,
    away: fixture.away,
    kickoff: fixture.kickoff.toISOString(),
  }));
};

export const currentGameweekView = async (): Promise<CurrentGameweek> => {
  const gameweek = await currentGameweek();
  const now = new Date();
  const deadline = gameweek.deadline;
  return {
    number: gameweek.number,
    status: effectiveStatus(gameweek, now),
    deadline: deadline === null ? null : deadline.toISOString(),
    deadline_local: deadline === null ? null : formatLeagueDeadline(deadline.toISOString()),
    first_kickoff: gameweek.first_kickoff === null ? null : gameweek.first_kickoff.toISOString(),
    fixtures: await fixturesFor(gameweek.number),
    server_time: now.toISOString(),
  };
};

/** Manager writes are refused once the named gameweek has left the open state. */
export const assertOpenForManager = (gameweek: GameweekRecord, now: Date): void => {
  const status = effectiveStatus(gameweek, now);
  if (status === 'upcoming') {
    throw conflict('gameweek_not_open', `Gameweek ${gameweek.number} is not open yet.`);
  }
  if (status !== 'open') {
    throw conflict('gameweek_locked', `Gameweek ${gameweek.number} is locked.`);
  }
};
