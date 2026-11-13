import { Client } from 'pg';
import { seasonDayOf, daysSinceEpoch, dailySelectionFor, formatInstantUtc } from './season.js';
import { computeBoard } from './levels.js';

export interface SeasonShape {
  instant: string;
  localTime: string;
  seasonDay: string;
  dailyDigest: string | null;
  standings: Record<string, unknown> | null;
  streak: number | null;
}

/**
 * Computes every season surface from the same offset-aware day: the inspected
 * instant (or current server time), its local time, the daily challenge for
 * that day, standings for the daily challenge and the viewer's streak.
 */
export async function seasonResponse(client: Client, at: Date | null, viewerAccountId: string | null): Promise<SeasonShape> {
  const instant = at ?? new Date();
  const info = seasonDayOf(instant);
  const dailyDigest = await dailySelectionFor(client, info.seasonDay);
  const standings = dailyDigest
    ? await computeBoard(client, dailyDigest, viewerAccountId, true, info.seasonDay)
    : null;
  const streak = viewerAccountId === null ? null : await computeStreak(client, viewerAccountId, info.seasonDay);
  return {
    instant: formatInstantUtc(instant),
    localTime: info.localTime,
    seasonDay: info.seasonDay,
    dailyDigest,
    standings: standings
      ? { digest: standings.digest, ruleset: standings.ruleset, rows: standings.rows, personalBest: standings.personalBest, completions: standings.completions, crewUsage: standings.crewUsage }
      : null,
    streak,
  };
}

/**
 * Streak counts consecutive season days with at least one accepted daily
 * victory. Anchor at the inspected day if completed; otherwise at its
 * preceding day; if neither is completed, the streak is zero.
 */
export async function computeStreak(client: Client, accountId: string, seasonDay: string): Promise<number> {
  const result = await client.query(
    `SELECT DISTINCT t.season_day FROM tickets t JOIN runs r ON r.ticket_id = t.id
     WHERE t.account_id = $1 AND t.daily = true AND r.state = 'accepted' AND r.outcome = 'victory'`,
    [accountId],
  );
  const completedDays = new Set(result.rows.map((r) => r.season_day as string));
  if (completedDays.size === 0) return 0;
  let anchorDay = seasonDay;
  if (!completedDays.has(anchorDay)) {
    const previous = new Date(Date.UTC(0, 0, daysSinceEpoch(seasonDay) - 1));
    const y = previous.getUTCFullYear();
    const m = (previous.getUTCMonth() + 1).toString().padStart(2, '0');
    const d = previous.getUTCDate().toString().padStart(2, '0');
    anchorDay = `${y}-${m}-${d}`;
    if (!completedDays.has(anchorDay)) return 0;
  }
  let streak = 0;
  let cursor = daysSinceEpoch(anchorDay);
  while (completedDays.has(dayFromEpoch(cursor))) {
    streak++;
    cursor--;
  }
  return streak;
}

function dayFromEpoch(epochDays: number): string {
  const date = new Date(epochDays * 86400000);
  const y = date.getUTCFullYear();
  const m = (date.getUTCMonth() + 1).toString().padStart(2, '0');
  const d = date.getUTCDate().toString().padStart(2, '0');
  return `${y}-${m}-${d}`;
}
