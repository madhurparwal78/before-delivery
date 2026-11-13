import type { PostgresService } from './postgres.js';
import {
  monthGrid, shiftDate, streaks,
} from '../shared/daily.js';
import type { DailyDay, DailyShape } from '../shared/api.js';

// The daily calendar. Today is the server clock's date in DAILY_TZ; the
// calendar starts at DAILY_START. Each date's state is decided by the server,
// never the device. A date's daily game id is the player's own game.

export interface DailyDeps {
  db: PostgresService;
  dailyStart: string;
}

export interface CalendarDay extends DailyDay {}

export class DailyService {
  constructor(private readonly deps: DailyDeps) {}

  async dailyCalendar(playerId: string, today: string, month: string): Promise<DailyShape> {
    const [year, mon] = month.split('-').map(Number);
    const grid = monthGrid(year, mon);
    const first = `${month}-01`;
    const last = shiftDate(`${Number(month.slice(0, 4))}-${String(mon + 1).padStart(2, '0')}-01`, -1);
    const solvedRows = await this.deps.db.query<{ daily_date: string; daily_state: string }>(
      `SELECT daily_date, daily_state FROM finished_games
       WHERE player_id = $1 AND mode = 'daily' AND daily_date >= $2 AND daily_date <= $3`,
      [playerId, first, last],
    );
    const stateByDate = new Map(solvedRows.map((r) => [r.daily_date, r.daily_state]));

    // The game ids the player already has for the shown month.
    const gameRows = await this.deps.db.query<{ date: string; id: string }>(
      `SELECT date, id FROM games WHERE player_id = $1 AND mode = 'daily' AND date >= $2 AND date <= $3`,
      [playerId, first, last],
    );
    const idByDate = new Map(gameRows.map((r) => [r.date as string, r.id]));

    const days: CalendarDay[] = [];
    for (const week of grid.weeks) {
      for (const date of week) {
        if (date === null) continue;
        days.push(this.dayState(date, today, stateByDate.get(date), idByDate.get(date) ?? null));
      }
    }

    const { current, best } = await this.streaksFor(playerId, today);
    return { today, month, days, current_streak: current, best_streak: best };
  }

  private dayState(date: string, today: string, result: string | undefined, id: string | null): CalendarDay {
    if (date < this.deps.dailyStart) return { date, state: 'closed', id: null };
    if (date > today) return { date, state: 'future', id: null };
    if (result === 'solved') return { date, state: 'solved', id };
    if (result === 'late') return { date, state: 'late', id };
    if (date === today) return { date, state: 'today', id };
    return { date, state: 'missed', id };
  }

  async streaksFor(playerId: string, today: string): Promise<{ current: number; best: number }> {
    // Solved and late dates decide the streaks; late dates never count.
    const rows = await this.deps.db.query<{ daily_date: string; daily_state: string }>(
      `SELECT daily_date, daily_state FROM finished_games
       WHERE player_id = $1 AND mode = 'daily' AND daily_date >= $2 AND daily_date <= $3
       ORDER BY daily_date`,
      [playerId, this.deps.dailyStart, today],
    );
    // A past date with no result at all is a missed date and ends a run.
    const byDate = new Map(rows.map((r) => [r.daily_date, r.daily_state]));
    const days: Array<{ date: string; state: string }> = [];
    let cursor = this.deps.dailyStart;
    while (cursor <= today) {
      const state = byDate.get(cursor);
      days.push({
        date: cursor,
        state: state === 'solved' ? 'solved' : state === 'late' ? 'late' : cursor === today ? 'today' : 'missed',
      });
      cursor = shiftDate(cursor, 1);
    }
    return streaks(days, today);
  }
}
