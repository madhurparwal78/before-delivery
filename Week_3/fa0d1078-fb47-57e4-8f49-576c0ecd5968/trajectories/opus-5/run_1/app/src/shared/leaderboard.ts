export interface LeaderboardEntry {
  player_id: string;
  display_name: string;
  seconds: number;
  score: number;
  mistakes: number;
  hints: number;
  finished_at: string;
}

export interface LeaderboardRow {
  rank: number;
  display_name: string;
  seconds: number;
  score: number;
  mistakes: number;
  hints: number;
}

/** Score high to low, then time low to high, then the earlier finish. */
export function compareEntries(a: LeaderboardEntry, b: LeaderboardEntry): number {
  if (a.score !== b.score) return b.score - a.score;
  if (a.seconds !== b.seconds) return a.seconds - b.seconds;
  return a.finished_at < b.finished_at ? -1 : a.finished_at > b.finished_at ? 1 : 0;
}

/** Equal score and time share a rank, and the next rank skips: 1, 2, 2, 4. */
export function rankLeaderboard(entries: readonly LeaderboardEntry[], size: number): LeaderboardRow[] {
  const sorted = [...entries].sort(compareEntries);
  const rows: LeaderboardRow[] = [];
  let rank = 0;
  let previous: LeaderboardEntry | null = null;
  sorted.forEach((entry, index) => {
    if (!previous || previous.score !== entry.score || previous.seconds !== entry.seconds) {
      rank = index + 1;
    }
    previous = entry;
    rows.push({
      rank,
      display_name: entry.display_name,
      seconds: entry.seconds,
      score: entry.score,
      mistakes: entry.mistakes,
      hints: entry.hints,
    });
  });
  return rows.slice(0, size);
}

export function rankOf(entries: readonly LeaderboardEntry[], displayName: string): number | null {
  const rows = rankLeaderboard(entries, entries.length);
  const found = rows.find((row) => row.display_name === displayName);
  return found ? found.rank : null;
}
