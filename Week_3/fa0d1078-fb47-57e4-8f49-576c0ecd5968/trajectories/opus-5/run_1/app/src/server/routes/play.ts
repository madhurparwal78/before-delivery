import type { DailyDayShape, FinishedGameShape, LevelStatsShape, ProfileShape } from '../../shared/api';
import {
  bestStreak,
  currentStreak,
  dayState,
  type DailyResultState,
} from '../../shared/daily';
import { dailyPuzzleId, isMonthKey, isPlainDate, monthDates, monthKeyOf } from '../../shared/dates';
import { LEVELS, isLevel, type Level } from '../../shared/puzzles';
import { winRatePercent } from '../../shared/score';
import { config } from '../config';
import { query } from '../db';
import { ApiError } from '../errors';
import { sendJson, type RequestContext, type Router } from '../http';
import { today } from '../clock';
import {
  createDailyGame,
  createSoloGame,
  finishGame,
  gameShape,
  loadGame,
  saveMoves,
} from '../games';
import { announceResult, leaderboardFor } from '../leaderboardStore';
import { requirePlayer } from '../players';

function levelFrom(body: unknown): Level {
  const value = typeof body === 'object' && body !== null ? (body as { level?: unknown }).level : undefined;
  if (!isLevel(value)) throw new ApiError('VALIDATION', { fields: { level: 'Choose a level.' } });
  return value;
}

interface DailyResultRow {
  date: string;
  daily_state: DailyResultState;
}

async function dailyResults(playerId: string): Promise<Map<string, DailyResultState>> {
  const found = await query<DailyResultRow>(
    `select to_char(daily_date, 'YYYY-MM-DD') as date, daily_state
       from results
      where player_id = $1 and daily_date is not null and outcome = 'won'
      order by finished_at asc`,
    [playerId],
  );
  const states = new Map<string, DailyResultState>();
  for (const row of found.rows) {
    if (row.daily_state === 'solved' || states.get(row.date) !== 'solved') {
      states.set(row.date, row.daily_state);
    }
  }
  return states;
}

export function registerPlayRoutes(router: Router): void {
  router.post('/api/games', async (context) => {
    const player = await requirePlayer(context);
    const level = levelFrom(context.body);
    const row = await createSoloGame(player.id, level);
    sendJson(context.res, 201, { game: await gameShape(row) });
  });

  router.get('/api/games/:id', async (context) => {
    const player = await requirePlayer(context);
    const row = await loadGame(context.params.id as string, player.id);
    sendJson(context.res, 200, { game: await gameShape(row) });
  });

  router.put('/api/games/:id/moves', async (context) => {
    const player = await requirePlayer(context);
    const row = await loadGame(context.params.id as string, player.id);
    const next = await saveMoves(row, context.body);
    sendJson(context.res, 200, { game: await gameShape(next) });
  });

  router.post('/api/games/:id/finish', async (context: RequestContext) => {
    const player = await requirePlayer(context);
    const outcome = await finishGame(context.params.id as string, player.id, context.body);
    sendJson(context.res, 200, { result: outcome.result });
    if (outcome.daily?.state === 'solved' && player.verified) {
      await announceResult(outcome.daily.date, player.display_name);
    }
  });

  router.get('/api/daily', async (context) => {
    const player = await requirePlayer(context);
    const asked = context.query.get('month');
    if (asked !== null && !isMonthKey(asked)) throw new ApiError('VALIDATION');
    const current = today();
    const month = asked ?? monthKeyOf(current);
    const states = await dailyResults(player.id);
    const games = await query<{ id: string; date: string }>(
      `select id, to_char(daily_date, 'YYYY-MM-DD') as date
         from games
        where player_id = $1 and daily_date is not null and to_char(daily_date, 'YYYY-MM') = $2`,
      [player.id, month],
    );
    const byDate = new Map(games.rows.map((row) => [row.date, row.id]));
    const days: DailyDayShape[] = monthDates(month).map((date) => ({
      date,
      state: dayState(date, current, config.dailyStart, states.get(date) ?? null),
      id: byDate.get(date) ?? null,
    }));
    const solved = new Set(
      [...states.entries()].filter(([, state]) => state === 'solved').map(([date]) => date),
    );
    sendJson(context.res, 200, {
      today: current,
      month,
      days,
      current_streak: currentStreak(solved, current),
      best_streak: bestStreak(solved),
    });
  });

  router.post('/api/daily/:date/game', async (context) => {
    const player = await requirePlayer(context);
    const date = context.params.date as string;
    if (!isPlainDate(date) || date < config.dailyStart) throw new ApiError('DAILY_NOT_FOUND');
    if (date > today()) throw new ApiError('DAILY_NOT_OPEN');
    const { row, created } = await createDailyGame(player.id, date, dailyPuzzleId(date));
    sendJson(context.res, created ? 201 : 200, { game: await gameShape(row) });
  });

  router.get('/api/leaderboard/:date', async (context) => {
    await requirePlayer(context);
    const date = context.params.date as string;
    if (!isPlainDate(date)) throw new ApiError('VALIDATION');
    sendJson(context.res, 200, await leaderboardFor(date));
  });

  router.get('/api/profile', async (context) => {
    const player = await requirePlayer(context);
    sendJson(context.res, 200, await profileFor(player.id));
  });
}

interface StartedRow {
  level: Level;
  started: number;
}

interface WonRow {
  level: Level;
  won: number;
  best_seconds: number | null;
  average_seconds: string | null;
  best_score: number | null;
}

interface FinishedRow {
  id: string;
  date: string;
  level: Level;
  outcome: 'won' | 'lost';
  seconds: number;
  score: number | null;
}

/** Every number is recounted from the stored games and results when it is read. */
async function profileFor(playerId: string): Promise<ProfileShape> {
  const started = await query<StartedRow>(
    `select level, count(*)::int as started from games
      where player_id = $1 and mode = 'solo' group by level`,
    [playerId],
  );
  const won = await query<WonRow>(
    `select level, count(*)::int as won, min(seconds)::int as best_seconds,
            avg(seconds)::text as average_seconds, max(score)::int as best_score
       from results
      where player_id = $1 and mode = 'solo' and outcome = 'won' group by level`,
    [playerId],
  );
  const finished = await query<FinishedRow>(
    `select coalesce(game_id, id) as id,
            to_char(finished_at at time zone $2, 'YYYY-MM-DD') as date,
            level, outcome, seconds, score
       from results
      where player_id = $1 and mode = 'solo'
      order by finished_at desc limit 20`,
    [playerId, config.dailyTz],
  );

  const startedBy = new Map(started.rows.map((row) => [row.level, row.started]));
  const wonBy = new Map(won.rows.map((row) => [row.level, row]));
  const levels = {} as Record<Level, LevelStatsShape>;
  for (const level of LEVELS) {
    const startedCount = startedBy.get(level) ?? 0;
    const wonRow = wonBy.get(level);
    const average = wonRow?.average_seconds;
    levels[level] = {
      started: startedCount,
      won: wonRow?.won ?? 0,
      win_rate: winRatePercent(wonRow?.won ?? 0, startedCount),
      best_seconds: wonRow?.best_seconds ?? null,
      average_seconds: average === null || average === undefined ? null : Math.floor(Number(average)),
      best_score: wonRow?.best_score ?? null,
    };
  }

  const finishedGames: FinishedGameShape[] = finished.rows.map((row) => ({
    id: row.id,
    date: row.date,
    level: row.level,
    result: row.outcome,
    seconds: row.seconds,
    score: row.score,
  }));
  return { levels, finished_games: finishedGames };
}
