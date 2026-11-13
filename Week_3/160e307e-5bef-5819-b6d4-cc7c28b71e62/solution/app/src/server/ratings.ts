/** Glicko-2 with the published constants. Each ranked match is one rating period for both players. */

const TAU = 0.5;
const CONVERGENCE = 0.000001;
const SCALE = 173.7178;
const DEFAULT_RATING = 1500;

interface Rating {
  rating: number;
  rd: number;
  volatility: number;
}

function g(phi: number): number {
  return 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));
}

function expected(mu: number, opponentMu: number, opponentPhi: number): number {
  return 1 / (1 + Math.exp(-g(opponentPhi) * (mu - opponentMu)));
}

function newVolatility(phi: number, sigma: number, v: number, delta: number): number {
  const a = Math.log(sigma * sigma);
  const f = (x: number): number => {
    const ex = Math.exp(x);
    const top = ex * (delta * delta - phi * phi - v - ex);
    const bottom = 2 * (phi * phi + v + ex) ** 2;
    return top / bottom - (x - a) / (TAU * TAU);
  };
  let upper = a;
  let lower: number;
  if (delta * delta > phi * phi + v) {
    lower = Math.log(delta * delta - phi * phi - v);
  } else {
    let k = 1;
    while (f(a - k * TAU) < 0) k++;
    lower = a - k * TAU;
  }
  let fUpper = f(upper);
  let fLower = f(lower);
  while (Math.abs(upper - lower) > CONVERGENCE) {
    const c = upper + ((upper - lower) * fUpper) / (fLower - fUpper);
    const fC = f(c);
    if (fC * fLower <= 0) {
      upper = lower;
      fUpper = fLower;
    } else {
      fUpper /= 2;
    }
    lower = c;
    fLower = fC;
  }
  return Math.exp(upper / 2);
}

/** The rating after one period against one opponent: `score` is 1 for a win and 0 for a loss. */
export function updateRating(player: Rating, opponent: Rating, score: 0 | 1): Rating {
  const mu = (player.rating - DEFAULT_RATING) / SCALE;
  const phi = player.rd / SCALE;
  const opponentMu = (opponent.rating - DEFAULT_RATING) / SCALE;
  const opponentPhi = opponent.rd / SCALE;
  const weight = g(opponentPhi);
  const e = expected(mu, opponentMu, opponentPhi);
  const v = 1 / (weight * weight * e * (1 - e));
  const delta = v * weight * (score - e);
  const sigma = newVolatility(phi, player.volatility, v, delta);
  const phiStar = Math.sqrt(phi * phi + sigma * sigma);
  const phiNext = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const muNext = mu + phiNext * phiNext * weight * (score - e);
  return { rating: SCALE * muNext + DEFAULT_RATING, rd: SCALE * phiNext, volatility: sigma };
}

type Tier = "Bronze" | "Silver" | "Gold" | "Platinum" | "Diamond";

export function tierOf(rating: number): Tier {
  if (rating < 1400) return "Bronze";
  if (rating < 1600) return "Silver";
  if (rating < 1800) return "Gold";
  if (rating < 2000) return "Platinum";
  return "Diamond";
}

export function twoDecimals(value: number): number {
  return Math.round(value * 100) / 100;
}
