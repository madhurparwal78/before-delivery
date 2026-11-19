// Elo rating arithmetic. Both changes are computed from the two players' pre-game
// ratings; the pair is symmetric. Rounding is half away from zero. Floor is 100.
export function stepFactor(rating, ratedGames) {
  if (ratedGames < 30) return 40;
  if (rating < 2400) return 20;
  return 10;
}

function roundHalfAwayFromZero(x) {
  return x < 0 ? -Math.round(-x) : Math.round(x);
}

// Returns { white: {delta}, black: {delta} } from pre-game numbers.
// score is 1 for a white win, 0 for a black win, 0.5 for a draw.
export function ratingDeltas(whiteRating, whiteGames, blackRating, blackGames, score) {
  const k = side => stepFactor(side.rating, side.games);
  const expected = (a, b) => 1 / (1 + Math.pow(10, (b - a) / 400));
  const eW = expected(whiteRating, blackRating);
  const eB = 1 - eW;
  const dW = roundHalfAwayFromZero(k({ rating: whiteRating, games: whiteGames }) * (score - eW));
  const dB = roundHalfAwayFromZero(k({ rating: blackRating, games: blackGames }) * ((1 - score) - eB));
  return { white: dW, black: dB };
}

export function clampRating(r) { return Math.max(100, r); }

export function ratingDisplay(rating, ratedGames) {
  return ratedGames < 10 ? `${rating}?` : String(rating);
}

// A member's baseline is the rating and rated-game count they held before their first
// STORED rated game. The one seeded finished game is historical, so the two players in
// it hold pre-game baselines chosen so that replaying it lands on their seeded ratings.
// For everybody else the baseline is the value they were created with.
export const NEW_MEMBER_RATING = 1500;
export const NEW_MEMBER_GAMES = 0;
export const BASELINES = new Map([
  ['mira_kade', { rating: 1460, games: 41 }],
  ['wren_oyelaran', { rating: 2422, games: 63 }],
  ['tobin_reyes', { rating: 1515, games: 37 }],
  ['jules_amari', { rating: 1190, games: 6 }],
  ['nadia_serrano', { rating: 108, games: 31 }],
  ['ivo_lindqvist', { rating: 112, games: 33 }],
]);
export function baselineFor(username) {
  return BASELINES.get(username) ?? { rating: NEW_MEMBER_RATING, games: NEW_MEMBER_GAMES };
}
