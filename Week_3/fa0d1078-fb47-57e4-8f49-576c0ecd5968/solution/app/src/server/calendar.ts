import type { DailyMonth, DailyState, Player } from "../shared/protocol";
import { calendarState, dailyStateOf, daysOfMonth, streaks, today } from "./daily";
import { query } from "./db";
import { ApiError } from "./errors";

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

interface DailyRow {
  id: string;
  daily_date: string;
  status: string;
  finished_at: Date | null;
}

/** One month of the player's calendar plus both streaks, all decided from the server clock. */
export async function dailyMonth(player: Player, month: unknown): Promise<DailyMonth> {
  const todayDate = today();
  const shown = month === undefined ? todayDate.slice(0, 7) : month;
  if (typeof shown !== "string" || !MONTH_PATTERN.test(shown)) {
    throw new ApiError("VALIDATION", { fields: { month: "Use a month written yyyy-mm." } });
  }
  const rows = await query<DailyRow>("SELECT id, daily_date, status, finished_at FROM games WHERE player_id = $1 AND mode = 'daily'", [player.player_id]);
  const finished = new Map<string, DailyState>();
  const ids = new Map<string, string>();
  for (const row of rows) {
    ids.set(row.daily_date, row.id);
    if (row.status === "won" && row.finished_at) finished.set(row.daily_date, dailyStateOf(row.finished_at, row.daily_date));
  }
  const solved = new Set([...finished].filter(([, state]) => state === "solved").map(([date]) => date));
  const { current, best } = streaks(solved, todayDate);
  return {
    today: todayDate,
    month: shown,
    days: daysOfMonth(shown).map((date) => ({ date, state: calendarState(date, todayDate, finished.get(date) ?? null), id: ids.get(date) ?? null })),
    current_streak: current,
    best_streak: best,
  };
}
