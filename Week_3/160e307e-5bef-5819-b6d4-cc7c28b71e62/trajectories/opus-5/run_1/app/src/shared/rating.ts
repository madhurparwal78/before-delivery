import type { Tier } from './types.js';

export const GLICKO_SCALE = 173.7178;
export const GLICKO_TAU = 0.5;
export const GLICKO_CONVERGENCE = 0.000001;
export const START_RATING = 1500;
export const START_RD = 350;
export const START_VOLATILITY = 0.06;

export interface RatingRow {
  rating: number;
  rd: number;
  volatility: number;
}

export interface RatingUpdate {
  rating: number;
  rd: number;
  volatility: number;
  delta: number;
}

function g(phi: number): number {
  return 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));
}

function expected(mu: number, muOpponent: number, phiOpponent: number): number {
  return 1 / (1 + Math.exp(-g(phiOpponent) * (mu - muOpponent)));
}

function newVolatility(phi: number, v: number, delta: number, sigma: number): number {
  const a = Math.log(sigma * sigma);
  const deltaSq = delta * delta;
  const phiSq = phi * phi;
  const f = (x: number): number => {
    const ex = Math.exp(x);
    const denominator = phiSq + v + ex;
    return (ex * (deltaSq - phiSq - v - ex)) / (2 * denominator * denominator) - (x - a) / (GLICKO_TAU * GLICKO_TAU);
  };

  let A = a;
  let B: number;
  if (deltaSq > phiSq + v) {
    B = Math.log(deltaSq - phiSq - v);
  } else {
    let k = 1;
    while (f(a - k * GLICKO_TAU) < 0) k += 1;
    B = a - k * GLICKO_TAU;
  }
  let fA = f(A);
  let fB = f(B);
  while (Math.abs(B - A) > GLICKO_CONVERGENCE) {
    const C = A + ((A - B) * fA) / (fB - fA);
    const fC = f(C);
    if (fC * fB <= 0) {
      A = B;
      fA = fB;
    } else {
      fA = fA / 2;
    }
    B = C;
    fB = fC;
  }
  return Math.exp(A / 2);
}

/**
 * One Glicko-2 rating period holding a single result. `score` is 1 for a win and 0 for a
 * loss; a forfeit or resignation is a loss.
 */
export function updateRating(player: RatingRow, opponent: RatingRow, score: number): RatingUpdate {
  const mu = (player.rating - START_RATING) / GLICKO_SCALE;
  const phi = player.rd / GLICKO_SCALE;
  const muOpponent = (opponent.rating - START_RATING) / GLICKO_SCALE;
  const phiOpponent = opponent.rd / GLICKO_SCALE;

  const gOpponent = g(phiOpponent);
  const e = expected(mu, muOpponent, phiOpponent);
  const v = 1 / (gOpponent * gOpponent * e * (1 - e));
  const delta = v * gOpponent * (score - e);

  const sigma = newVolatility(phi, v, delta, player.volatility);
  const phiStar = Math.sqrt(phi * phi + sigma * sigma);
  const phiNew = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const muNew = mu + phiNew * phiNew * gOpponent * (score - e);

  const rating = round2(GLICKO_SCALE * muNew + START_RATING);
  const rd = round2(GLICKO_SCALE * phiNew);
  return { rating, rd, volatility: sigma, delta: round2(rating - player.rating) };
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function tierOf(rating: number): Tier {
  if (rating < 1400) return 'Bronze';
  if (rating < 1600) return 'Silver';
  if (rating < 1800) return 'Gold';
  if (rating < 2000) return 'Platinum';
  return 'Diamond';
}

export const LEADERBOARD_MIN_GAMES = 10;
export const LEADERBOARD_MAX_RD = 150;
export const LEADERBOARD_SIZE = 100;

/** The signed whole rating change as history and the match-over dialog show it. */
export function signedDelta(delta: number): string {
  const whole = Math.round(delta);
  return whole >= 0 ? `+${whole}` : `${whole}`;
}
