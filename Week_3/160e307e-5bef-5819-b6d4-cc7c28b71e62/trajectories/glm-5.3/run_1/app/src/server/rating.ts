/**
 * Glicko-2 ratings with the published constants. Each ranked match is one
 * rating period for both players, applied once when the match finishes.
 */
export const RATING_START = 1500;
export const RD_START = 350;
export const VOLATILITY_START = 0.06;
export const TAU = 0.5;
export const CONVERGENCE = 0.000001;
export const SCALE = 173.7178;

export interface GlickoRating {
  rating: number;
  rd: number;
  volatility: number;
}

/** One rating period: both players' updates from a single win and loss. */
export function rateMatch(
  winner: GlickoRating,
  loser: GlickoRating
): { winner: GlickoRating; loser: GlickoRating } {
  const gW = g(loser.rd);
  const gL = g(winner.rd);
  const eW = e(winner.rating, loser.rating, gW);
  const eL = e(loser.rating, winner.rating, gL);
  const vW = 1 / (gW * gW * eW * (1 - eW));
  const vL = 1 / (gL * gL * eL * (1 - eL));
  const deltaW = vW * gW * (1 - eW);
  const deltaL = vL * gL * (0 - eL);
  return { winner: step(winner, vW, deltaW), loser: step(loser, vL, deltaL) };
}

/** The rating step: phiStar from the unchanged volatility, then the mu update. */
function step(r: GlickoRating, v: number, delta: number): GlickoRating {
  const phi = r.rd / SCALE;
  const sigma = r.volatility;
  const phiStar = Math.sqrt(phi * phi + sigma * sigma);
  const phiNew = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const muNew = r.rating / SCALE + phiNew * phiNew * (1 / v) * delta;
  return { rating: muNew * SCALE, rd: phiNew * SCALE, volatility: sigma };
}

function g(rd: number): number {
  const phi = rd / SCALE;
  return 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));
}

function e(rating: number, other: number, gOther: number): number {
  return 1 / (1 + Math.exp((-gOther * (rating - other)) / SCALE));
}

export function tierOf(rating: number): string {
  if (rating < 1400) return "Bronze";
  if (rating < 1600) return "Silver";
  if (rating < 1800) return "Gold";
  if (rating < 2000) return "Platinum";
  return "Diamond";
}
