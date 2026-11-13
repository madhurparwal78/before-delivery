type RankableSeat = { seatId: string; score: number; cumulativeMs: number; joinSeq: number };

// The one place that orders seats: total score, then lower cumulative response time, then earlier join.
export function rankSeats<T extends RankableSeat>(seats: T[]): (T & { rank: number })[] {
  return [...seats]
    .sort((a, b) => b.score - a.score || a.cumulativeMs - b.cumulativeMs || a.joinSeq - b.joinSeq)
    .map((seat, index) => ({ ...seat, rank: index + 1 }));
}
