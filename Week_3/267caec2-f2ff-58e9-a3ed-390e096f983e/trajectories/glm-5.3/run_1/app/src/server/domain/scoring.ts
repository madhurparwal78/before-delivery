import { errors } from "../http/errors.js";

export interface RawScore {
  craft: number;
  clarity: number;
  idea: number;
  story: number;
}

export interface BallotScoreRow {
  entryId: string;
  scores: RawScore;
}

const WEIGHTS = { craft: 35, clarity: 30, idea: 25, story: 10 } as const;

/**
 * Exact round-half-up of a double to `places` decimals, decided on the exact
 * rational value of the double (denominator a power of two), so 6.125 → 6.13.
 */
export function roundHalfUp(value: number, places: number): number {
  const scale = 10n ** BigInt(places);
  if (!Number.isFinite(value)) {
    return value;
  }
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, value);
  const bits = buf.getBigUint64(0);
  const exponent = Number((bits >> 52n) & 0x7ffn);
  const mantissa = bits & 0xfffffffffffffn;
  let numerator: bigint;
  let denominator: bigint;
  if (exponent === 0) {
    numerator = mantissa;
    denominator = 2n ** 1074n;
  } else {
    numerator = mantissa | (1n << 52n);
    denominator = 2n ** (1075n - BigInt(exponent));
  }
  const sign = bits >> 63n === 1n ? -1n : 1n;
  // x = 2*num*scale + den, d = 2*den; rounded = floor(x/d) — exact half-up.
  const x = 2n * sign * numerator * scale + denominator;
  const d = 2n * denominator;
  let q: bigint;
  if (x >= 0n) {
    q = x / d;
  } else {
    q = -((-x + d - 1n) / d);
  }
  return Number(q) / 10 ** places;
}

export function formatScore(value: number): string {
  return value.toFixed(2);
}

/** The single place computing the round score for every entry from counted ballots. */
export function computeRoundScores(ballotsByJuror: Map<string, BallotScoreRow[]>): Map<string, { score: number; ideaMean: number | null }> {
  // 1. Weighted totals per juror.
  const weighted = new Map<string, Map<string, number>>(); // juror -> entry -> weighted total
  for (const [jurorId, rows] of ballotsByJuror) {
    const perEntry = new Map<string, number>();
    for (const row of rows) {
      const total =
        (WEIGHTS.craft * row.scores.craft +
          WEIGHTS.clarity * row.scores.clarity +
          WEIGHTS.idea * row.scores.idea +
          WEIGHTS.story * row.scores.story) /
        100;
      perEntry.set(row.entryId, total);
    }
    weighted.set(jurorId, perEntry);
  }

  // 2-4. Standardise per juror, then average per entry.
  const mappedByEntry = new Map<string, number[]>();
  const ideaRawByEntry = new Map<string, number[]>();
  for (const perEntry of weighted.values()) {
    const totals = [...perEntry.values()];
    const n = totals.length;
    const mean = totals.reduce((a, b) => a + b, 0) / n;
    let variance = 0;
    for (const t of totals) {
      variance += (t - mean) ** 2;
    }
    variance /= n;
    const deviation = Math.sqrt(variance);
    for (const [entryId, total] of perEntry) {
      const z = deviation === 0 ? 0 : (total - mean) / deviation;
      const mapped = Math.min(10, Math.max(0, 5 + 1.5 * z));
      mappedByEntry.set(entryId, [...(mappedByEntry.get(entryId) ?? []), mapped]);
    }
  }

  for (const rows of ballotsByJuror.values()) {
    for (const row of rows) {
      ideaRawByEntry.set(row.entryId, [...(ideaRawByEntry.get(row.entryId) ?? []), row.scores.idea]);
    }
  }

  const result = new Map<string, { score: number; ideaMean: number | null }>();
  for (const [entryId, mapped] of mappedByEntry) {
    let pool = [...mapped].sort((a, b) => a - b);
    if (pool.length >= 5) {
      pool = pool.slice(1, -1);
    }
    const mean = pool.reduce((a, b) => a + b, 0) / pool.length;
    const ideas = ideaRawByEntry.get(entryId) ?? [];
    const ideaMean = ideas.length ? ideas.reduce((a, b) => a + b, 0) / ideas.length : null;
    result.set(entryId, { score: roundHalfUp(mean, 2), ideaMean: ideaMean === null ? null : roundHalfUp(ideaMean, 4) });
  }
  return result;
}

export interface RankRow {
  entryId: string;
  entryNumber: number;
  title: string;
  categoryName: string;
  score: number | null;
  ideaMean: number | null;
  submittedAt: Date | null;
}

export interface RankedRow extends RankRow {
  rank: number;
  cut: "above" | "below";
}

/**
 * The single ranking order: score high to low, nulls last; then higher Idea mean;
 * then earlier submission; then lower entry number. Ranks 1..n with no gaps.
 */
export function rankRows(rows: RankRow[], cutSize: number): RankedRow[] {
  const sorted = [...rows].sort((a, b) => {
    const aScore = a.score ?? Number.NEGATIVE_INFINITY;
    const bScore = b.score ?? Number.NEGATIVE_INFINITY;
    if (aScore !== bScore) {
      return bScore - aScore;
    }
    const aIdea = a.ideaMean ?? Number.NEGATIVE_INFINITY;
    const bIdea = b.ideaMean ?? Number.NEGATIVE_INFINITY;
    if (aIdea !== bIdea) {
      return bIdea - aIdea;
    }
    const aTime = a.submittedAt?.getTime() ?? Number.POSITIVE_INFINITY;
    const bTime = b.submittedAt?.getTime() ?? Number.POSITIVE_INFINITY;
    if (aTime !== bTime) {
      return aTime - bTime;
    }
    return a.entryNumber - b.entryNumber;
  });
  return sorted.map((row, index) => ({
    ...row,
    rank: index + 1,
    cut: index + 1 <= cutSize ? ("above" as const) : ("below" as const),
  }));
}

export function parseScore(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 10) {
    throw errors.validation({ scores: "Scores are whole numbers from 1 to 10." });
  }
  return value;
}

export function ordinal(n: number): string {
  const lastTwo = n % 100;
  const lastOne = n % 10;
  if (lastTwo >= 11 && lastTwo <= 13) {
    return `${n}th`;
  }
  if (lastOne === 1) {
    return `${n}st`;
  }
  if (lastOne === 2) {
    return `${n}nd`;
  }
  if (lastOne === 3) {
    return `${n}rd`;
  }
  return `${n}th`;
}
