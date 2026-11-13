import type { Standing } from '../../shared/protocol.js';

export interface RankableSeat {
  seatId: string;
  nickname: string;
  score: number;
  streak: number;
  cumulativeMs: number;
  joinSeq: number;
}

/** Score first, then the lower cumulative response time, then the earlier join. */
export function rankSeats(seats: readonly RankableSeat[]): (Standing & { cumulativeMs: number })[] {
  return [...seats]
    .sort(
      (a, b) =>
        b.score - a.score || a.cumulativeMs - b.cumulativeMs || a.joinSeq - b.joinSeq,
    )
    .map((seat, index) => ({
      rank: index + 1,
      seatId: seat.seatId,
      nickname: seat.nickname,
      score: seat.score,
      streak: seat.streak,
      cumulativeMs: seat.cumulativeMs,
    }));
}
