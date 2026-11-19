/**
 * The rating arithmetic.  The single authority in this application for what a
 * result does to a pair of ratings.
 */

export const RATING_FLOOR = 100;
export const PROVISIONAL_UNDER = 10;

/** The step factor for a player, from the numbers they hold before the game. */
export function stepFactor(rating, ratedGames) {
  if (ratedGames < 30) return 40;
  if (rating < 2400) return 20;
  return 10;
}

/** The standard expectation of `rating` against `opponentRating`. */
export function expectation(rating, opponentRating) {
  return 1 / (1 + 10 ** ((opponentRating - rating) / 400));
}

/** Round half away from zero: 0.5 becomes 1 and -0.5 becomes -1. */
export function roundHalfAwayFromZero(value) {
  return value < 0 ? -Math.floor(-value + 0.5) : Math.floor(value + 0.5);
}

/** The score White takes from a result. */
export function scoreForWhite(result) {
  if (result === '1-0') return 1;
  if (result === '0-1') return 0;
  if (result === '1/2-1/2') return 0.5;
  throw new Error(`result ${result} is not scorable`);
}

/**
 * Both ratings move from the pre-game numbers of both players, so neither
 * player's new rating feeds the other's calculation.
 */
export function applyResult({ white, black, result }) {
  const whiteScore = scoreForWhite(result);
  const blackScore = 1 - whiteScore;

  const sides = [
    { side: 'white', player: white, score: whiteScore, opponent: black },
    { side: 'black', player: black, score: blackScore, opponent: white },
  ];

  const out = {};
  for (const { side, player, score, opponent } of sides) {
    const before = player.rating;
    const k = stepFactor(before, player.rated_games ?? player.ratedGames ?? 0);
    const expected = expectation(before, opponent.rating);
    const delta = roundHalfAwayFromZero(k * (score - expected));
    const after = Math.max(RATING_FLOOR, before + delta);
    out[side] = {
      rating_before: before,
      rating_after: after,
      delta: after - before,
      raw_delta: delta,
      step: k,
      expectation: expected,
      rated_games_before: player.rated_games ?? player.ratedGames ?? 0,
      rated_games_after: (player.rated_games ?? player.ratedGames ?? 0) + 1,
    };
  }
  return out;
}

/** A rating carries a trailing `?` while the member has under ten rated games. */
export function ratingDisplay(rating, ratedGames) {
  return ratedGames < PROVISIONAL_UNDER ? `${rating}?` : String(rating);
}
