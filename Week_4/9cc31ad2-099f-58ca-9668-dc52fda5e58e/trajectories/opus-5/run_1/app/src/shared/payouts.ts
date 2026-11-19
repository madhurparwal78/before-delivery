/** Every payout amount in the game is decided here. */

export const GUIDED_FIRST_RACE_COINS = 300;
export const CIRCUIT_PLACE_COINS: Record<number, number> = { 1: 600, 2: 400, 3: 300 };
export const CLEAN_BONUS_PERCENT = 15;
export const DRIFT_COINS_PER_1000 = 1000;
export const DRIFT_COINS_CAP = 500;
export const TIME_TRIAL_LAP_COINS = 250;
export const ONLINE_PLACE_COINS: Record<number, number> = { 1: 200, 2: 100 };
export const ONLINE_OTHER_PLACE_COINS = 50;

export function circuitResultCoins(position: number, clean: boolean): number {
  const placing = CIRCUIT_PLACE_COINS[position] ?? 0;
  const bonus = clean ? Math.floor((placing * CLEAN_BONUS_PERCENT) / 100) : 0;
  return placing + bonus;
}

export function driftResultCoins(score: number): number {
  return Math.min(Math.floor(score / DRIFT_COINS_PER_1000), DRIFT_COINS_CAP);
}

export function onlineResultCoins(position: number): number {
  return ONLINE_PLACE_COINS[position] ?? ONLINE_OTHER_PLACE_COINS;
}

/**
 * Time-trial coins: a valid lap pays when it is the player's first valid lap on the
 * layout, or strictly faster than their best so far. Laps are taken in lap order.
 */
export function timeTrialCoins(
  lapTimesMs: number[],
  previousBestMs: number | null,
): { coins: number; bestMs: number | null } {
  let best = previousBestMs;
  let coins = 0;
  for (const lapMs of lapTimesMs) {
    if (best === null || lapMs < best) {
      coins += TIME_TRIAL_LAP_COINS;
      best = lapMs;
    }
  }
  return { coins, bestMs: best };
}

export function applyLoaner(resultCoins: number, loaner: boolean): number {
  return loaner ? Math.floor(resultCoins / 2) : resultCoins;
}

export function refitRefund(paid: number): number {
  return Math.floor(paid / 2);
}

export function circuitEventPoints(position: number): number {
  if (position === 1) return 25;
  if (position === 2) return 18;
  if (position === 3) return 15;
  return 0;
}

export function driftEventPoints(score: number): number {
  return Math.min(Math.floor(score / 1000), 25);
}

export function timeTrialEventPoints(bestValidLapMs: number | null): number {
  return bestValidLapMs !== null && bestValidLapMs <= 60000 ? 25 : 10;
}
