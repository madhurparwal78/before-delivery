import type { Seat } from './types.js';

export type ChalkReason = 'match' | 'win' | 'daily' | 'local' | 'purchase' | 'grant';

export const CHALK_MATCH = 20;
export const CHALK_WIN = 30;
export const CHALK_DAILY = 50;
export const CHALK_LOCAL = 10;
export const LOCAL_AWARDS_PER_DAY = 5;

export interface ChalkAward {
  seat: Seat;
  reason: ChalkReason;
  amount: number;
}

/**
 * The awards a finished online match makes. A player who forfeited gets nothing, and an
 * abandoned match awards nothing at all.
 */
export function onlineMatchAwards(input: {
  status: 'completed' | 'forfeit' | 'abandoned';
  winnerSeat: Seat | null;
  forfeitedSeat: Seat | null;
  winnerFirstDailyWin: boolean;
}): ChalkAward[] {
  if (input.status === 'abandoned') return [];
  const awards: ChalkAward[] = [];
  for (const seat of [0, 1] as Seat[]) {
    if (seat === input.forfeitedSeat) continue;
    awards.push({ seat, reason: 'match', amount: CHALK_MATCH });
  }
  if (input.winnerSeat !== null) {
    awards.push({ seat: input.winnerSeat, reason: 'win', amount: CHALK_WIN });
    if (input.winnerFirstDailyWin) {
      awards.push({ seat: input.winnerSeat, reason: 'daily', amount: CHALK_DAILY });
    }
  }
  return awards;
}

/** The chalk a recorded pass-and-play match gives the session's player. */
export function localMatchAward(recordedToday: number): number {
  return recordedToday < LOCAL_AWARDS_PER_DAY ? CHALK_LOCAL : 0;
}
