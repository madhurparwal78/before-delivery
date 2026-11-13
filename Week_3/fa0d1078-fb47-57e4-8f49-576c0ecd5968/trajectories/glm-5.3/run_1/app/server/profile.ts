import type { PostgresService } from './postgres.js';
import type { FinishedGame, ProfileLevelStats, ProfileShape } from '../shared/api.js';
import type { Level } from '../shared/puzzles.js';
import { LEVELS } from '../shared/puzzles.js';
import { formatClock } from '../shared/score.js';

// Profile and statistics. Statistics cover solo games only, per level, and
// every value is derived from the stored finished games when it is read, so it
// always equals a recount.

export interface ProfileDeps {
  db: PostgresService;
  dailyTz: string;
  dateInTz: (instant: Date) => string;
}

export class ProfileService {
  constructor(private readonly deps: ProfileDeps) {}

  async profile(playerId: string): Promise<ProfileShape> {
    const startedRows = await this.deps.db.query<{ level: string; n: string }>(
      `SELECT level, COUNT(*) AS n FROM games WHERE player_id = $1 AND mode = 'solo' GROUP BY level`,
      [playerId],
    );
    const started = new Map<string, number>(startedRows.map((r) => [r.level, Number(r.n)]));

    const finished = await this.finishedGames(playerId);
    const levels = {} as Record<Level, ProfileLevelStats>;
    for (const level of LEVELS) {
      const wonRows = finished.filter((f) => f.level === level && f.result === 'won');
      const startedN = started.get(level) ?? 0;
      const wonN = wonRows.length;
      // Win rate is a whole percent rounded half up, or null when none were
      // started.
      const winRate = startedN === 0 ? null : Math.round((wonN * 100) / startedN + Number.EPSILON);
      const seconds = wonRows.map((f) => f.seconds);
      const bestSeconds = seconds.length > 0 ? Math.min(...seconds) : null;
      const averageSeconds = seconds.length > 0
        ? Math.floor(seconds.reduce((a, b) => a + b, 0) / seconds.length)
        : null;
      const scores = wonRows.map((f) => f.score).filter((s): s is number => s !== null);
      levels[level] = {
        started: startedN,
        won: wonN,
        win_rate: winRate,
        best_seconds: bestSeconds,
        average_seconds: averageSeconds,
        best_score: scores.length > 0 ? Math.max(...scores) : null,
      };
    }
    return { levels, finished_games: finished.slice(0, 20) };
  }

  // Won solo games and closed lost solo games, newest first, at most 20. Open
  // lost games are not listed.
  async finishedGames(playerId: string): Promise<FinishedGame[]> {
    const rows = await this.deps.db.query<{
      id: string; level: string; result: string; seconds: number; score: number | null;
      finished_at: Date; closed_at: Date | null; status: string;
    }>(
      `SELECT f.id, f.level, f.result, f.seconds, f.score, f.finished_at,
              (SELECT MIN(g2.created_at) FROM games g2
                WHERE g2.player_id = f.player_id AND g2.mode = 'solo'
                  AND g2.level = f.level AND g2.created_at > g.created_at) AS closed_at,
              g.status, g.created_at
       FROM finished_games f JOIN games g ON g.id = f.game_id
       WHERE f.player_id = $1 AND f.mode = 'solo'
       ORDER BY f.finished_at DESC`,
      [playerId],
    );
    const out: FinishedGame[] = [];
    for (const r of rows) {
      if (r.result === 'won') {
        out.push({
          id: r.id,
          date: this.deps.dateInTz(new Date(r.finished_at)),
          level: r.level as Level,
          result: 'won',
          seconds: r.seconds,
          score: r.score,
        });
      } else {
        // A lost game's date is the date the game closed: the moment a newer
        // game at its level started, or the finish date when it closed at
        // finish.
        const closed = r.closed_at ? new Date(r.closed_at) : new Date(r.finished_at);
        out.push({
          id: r.id,
          date: this.deps.dateInTz(closed),
          level: r.level as Level,
          result: 'lost',
          seconds: r.seconds,
          score: null,
        });
      }
    }
    return out.slice(0, 20);
  }
}

export { formatClock };
