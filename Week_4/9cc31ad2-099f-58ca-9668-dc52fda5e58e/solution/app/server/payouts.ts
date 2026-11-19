import type { LapResult, Mode } from "../shared/model.js";

// Every payout amount Kerbline credits, decided here.
const CIRCUIT_PLACING: Readonly<Record<number, number>> = { 1: 600, 2: 400, 3: 300 };
const CLEAN_BONUS_PERCENT = 15;
const GUIDED_FIRST_RACE_COINS = 300;
const DRIFT_COIN_DIVISOR = 1000;
const DRIFT_COIN_CAP = 500;
const TIME_TRIAL_COINS = 250;
const ONLINE_PLACING: Readonly<Record<number, number>> = { 1: 200, 2: 100 };
const ONLINE_LATER_PLACE = 50;

interface VerifiedOutcome {
  readonly mode: Mode;
  readonly position: number | null;
  readonly clean: boolean;
  readonly driftScore: number;
  readonly coinsCollected: number;
  readonly lapResults: readonly LapResult[];
  readonly loaner: boolean;
  readonly guidedFirstRace: boolean;
  readonly guidedAlreadyPaid: boolean;
  // The player's best valid time-trial lap on this layout before this run, if any.
  readonly timeTrialBestMs: number | null;
}

interface RunPayout {
  readonly pickups: number;
  readonly result: number;
  // The best valid time-trial lap after this run (time-trial runs only).
  readonly timeTrialBestMs: number | null;
}

export function runPayout(outcome: VerifiedOutcome): RunPayout {
  const pickups = outcome.mode === "practice" || outcome.mode === "circuit" ? outcome.coinsCollected : 0;
  let result = 0;
  let best = outcome.timeTrialBestMs;
  if (outcome.mode === "circuit") {
    const placing = CIRCUIT_PLACING[outcome.position ?? 0] ?? 0;
    result = placing + (outcome.clean ? Math.floor((placing * CLEAN_BONUS_PERCENT) / 100) : 0);
  } else if (outcome.mode === "drift") {
    result = Math.min(Math.floor(outcome.driftScore / DRIFT_COIN_DIVISOR), DRIFT_COIN_CAP);
  } else if (outcome.mode === "time-trial") {
    for (const lap of outcome.lapResults) {
      if (!lap.valid) continue;
      if (best === null || lap.lapMs < best) {
        result += TIME_TRIAL_COINS;
        best = lap.lapMs;
      }
    }
  }
  if (outcome.guidedFirstRace && !outcome.guidedAlreadyPaid) result += GUIDED_FIRST_RACE_COINS;
  if (outcome.loaner) result = Math.floor(result / 2);
  return { pickups, result, timeTrialBestMs: outcome.mode === "time-trial" ? best : null };
}

export function onlinePayout(position: number): number {
  return ONLINE_PLACING[position] ?? ONLINE_LATER_PLACE;
}
