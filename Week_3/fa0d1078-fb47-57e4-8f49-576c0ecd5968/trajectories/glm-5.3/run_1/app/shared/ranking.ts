// The leaderboard ranking rule: score high to low, then time low to high, then
// the earlier finish. Players with the same score and time share a rank, and
// the next rank skips (1, 2, 2, 4).

export interface RankedRow {
  rank: number;
  display_name: string;
  seconds: number;
  score: number;
  mistakes: number;
  hints: number;
}

export interface RankInput {
  display_name: string;
  seconds: number;
  score: number;
  mistakes: number;
  hints: number;
  finished_seq: number;
}

export function rankRows(rows: readonly RankInput[]): RankedRow[] {
  const sorted = [...rows].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.seconds !== b.seconds) return a.seconds - b.seconds;
    return a.finished_seq - b.finished_seq;
  });
  const out: RankedRow[] = [];
  let lastKey = '';
  let lastRank = 0;
  sorted.forEach((r, i) => {
    const key = `${r.score}:${r.seconds}`;
    const rank = key === lastKey ? lastRank : i + 1;
    lastKey = key;
    lastRank = rank;
    out.push({
      rank,
      display_name: r.display_name,
      seconds: r.seconds,
      score: r.score,
      mistakes: r.mistakes,
      hints: r.hints,
    });
  });
  return out;
}

