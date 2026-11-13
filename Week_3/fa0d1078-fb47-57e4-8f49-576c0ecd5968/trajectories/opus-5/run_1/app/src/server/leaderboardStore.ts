import type { LeaderboardShape } from '../shared/api';
import {
  rankLeaderboard,
  rankOf,
  type LeaderboardEntry,
} from '../shared/leaderboard';
import { config } from './config';
import { query } from './db';
import { isValkeyUp, keys, publish, valkey } from './valkey';

interface EntryRow {
  player_id: string;
  display_name: string;
  seconds: number;
  score: number;
  mistakes: number;
  hints: number;
  finished_at: string;
}

/** The date's listed results: on-day wins by verified players, best one each. */
async function entriesFor(date: string): Promise<LeaderboardEntry[]> {
  const found = await query<EntryRow>(
    `select distinct on (r.player_id)
            r.player_id, p.display_name, r.seconds, r.score, r.mistakes, r.hints,
            to_char(r.finished_at, 'YYYY-MM-DD"T"HH24:MI:SS.MSOF') as finished_at
       from results r join players p on p.id = r.player_id
      where r.daily_date = $1 and r.daily_state = 'solved' and r.outcome = 'won' and p.verified
      order by r.player_id, r.score desc, r.seconds asc, r.finished_at asc`,
    [date],
  );
  return found.rows.map((row) => ({
    player_id: row.player_id,
    display_name: row.display_name,
    seconds: row.seconds,
    score: row.score,
    mistakes: row.mistakes,
    hints: row.hints,
    finished_at: row.finished_at,
  }));
}

/** The sorted set of the date's listed player ids, rebuilt from Postgres when missing. */
async function syncSet(date: string, entries: readonly LeaderboardEntry[]): Promise<void> {
  if (!isValkeyUp() || entries.length === 0) return;
  const key = keys.leaderboard(date);
  try {
    const redis = valkey();
    const pipeline = redis.multi();
    pipeline.del(key);
    for (const entry of entries) pipeline.zadd(key, entry.score, entry.player_id);
    await pipeline.exec();
  } catch {
    /* the leaderboard falls back to Postgres */
  }
}

export async function leaderboardFor(date: string): Promise<LeaderboardShape> {
  const entries = await entriesFor(date);
  const live = isValkeyUp();
  if (live) await syncSet(date, entries);
  return { date, live, rows: rankLeaderboard(entries, config.leaderboardSize) };
}

/** Fans a newly verified on-day result out to every open leaderboard page. */
export async function announceResult(date: string, displayName: string): Promise<void> {
  const entries = await entriesFor(date);
  await syncSet(date, entries);
  const rank = rankOf(entries, displayName);
  if (rank === null) return;
  await publish(keys.leaderboardChannel(date), {
    type: 'leaderboard',
    date,
    rows: rankLeaderboard(entries, config.leaderboardSize),
    latest: { display_name: displayName, rank },
  });
}
