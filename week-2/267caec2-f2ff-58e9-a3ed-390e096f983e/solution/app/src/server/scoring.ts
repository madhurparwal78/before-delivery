// The round score and the ranking order, each decided here once (brief: Business rules, Round score and
// Ranking and the cut). Arithmetic is fixed-point decimal on BigInt so rounding is decided on the exact value.

const DIGITS = 40n;
const ONE = 10n ** DIGITS;
const WEIGHTS = { craft: 35n, clarity: 30n, idea: 25n, story: 10n } as const;
const TRIM_FROM = 5;

export interface CountedScore {
  juror_id: string;
  entry_id: string;
  craft: number;
  clarity: number;
  idea: number;
  story: number;
}

export interface RoundEntry {
  entry_id: string;
  entry_number: number;
  submitted_at: Date;
}

interface RankedRow {
  entryId: string;
  rank: number;
  score: string | null;
  ideaMean: number | null;
  ballotsCounted: number;
  cut: "above" | "below";
}

function sqrt(value: bigint): bigint {
  if (value <= 0n) return 0n;
  let x = value;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + value / x) / 2n;
  }
  return x;
}

/** Half-up to `places` decimals; values within 1e-30 under a half are the exact half the arithmetic approximated. */
function roundHalfUp(value: bigint, places: bigint): string {
  const unit = 10n ** (DIGITS - places);
  const quantised = (value + unit / 2n + 10n ** 10n) / unit;
  const text = quantised.toString().padStart(Number(places) + 1, "0");
  return `${text.slice(0, -Number(places))}.${text.slice(-Number(places))}`;
}

/** Each juror's weighted totals, standardised per juror and mapped to 5 ± 1.5 per deviation, clamped to 0..10. */
function mappedScores(counted: CountedScore[]): Map<string, bigint[]> {
  const byJuror = new Map<string, CountedScore[]>();
  for (const row of counted) byJuror.set(row.juror_id, [...(byJuror.get(row.juror_id) ?? []), row]);
  const mapped = new Map<string, bigint[]>();
  for (const rows of byJuror.values()) {
    const totals = rows.map((r) => (WEIGHTS.craft * BigInt(r.craft) + WEIGHTS.clarity * BigInt(r.clarity)
      + WEIGHTS.idea * BigInt(r.idea) + WEIGHTS.story * BigInt(r.story)) * ONE / 100n);
    const n = BigInt(totals.length);
    const mean = totals.reduce((a, b) => a + b, 0n) / n;
    const deviation = sqrt(totals.reduce((a, t) => a + (t - mean) * (t - mean), 0n) / n);
    rows.forEach((row, i) => {
      const z = deviation === 0n ? 0n : ((totals[i] ?? 0n) - mean) * ONE / deviation;
      const value = 5n * ONE + 3n * z / 2n;
      const clamped = value < 0n ? 0n : value > 10n * ONE ? 10n * ONE : value;
      mapped.set(row.entry_id, [...(mapped.get(row.entry_id) ?? []), clamped]);
    });
  }
  return mapped;
}

function ideaMean(counted: CountedScore[], entryId: string): number | null {
  const ideas = counted.filter((r) => r.entry_id === entryId).map((r) => BigInt(r.idea));
  if (!ideas.length) return null;
  return Number(roundHalfUp(ideas.reduce((a, b) => a + b, 0n) * ONE / BigInt(ideas.length), 4n));
}

/** Round scores, then rank by score, higher Idea mean, earlier submission and lower entry number, with the cut. */
export function rankRound(entries: RoundEntry[], counted: CountedScore[], cutSize: number): RankedRow[] {
  const mapped = mappedScores(counted);
  const rows = entries.map((entry) => {
    const values = [...(mapped.get(entry.entry_id) ?? [])].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const kept = values.length >= TRIM_FROM ? values.slice(1, -1) : values;
    const exact = kept.length ? kept.reduce((a, b) => a + b, 0n) / BigInt(kept.length) : null;
    return {
      entry,
      exact,
      score: exact === null ? null : roundHalfUp(exact, 2n),
      ideaMean: ideaMean(counted, entry.entry_id),
      ballotsCounted: values.length,
    };
  });
  rows.sort((a, b) => compareScores(a.score, b.score) || compareIdea(a.ideaMean, b.ideaMean)
    || a.entry.submitted_at.getTime() - b.entry.submitted_at.getTime() || a.entry.entry_number - b.entry.entry_number);
  return rows.map((row, i) => ({
    entryId: row.entry.entry_id,
    rank: i + 1,
    score: row.score,
    ideaMean: row.ideaMean,
    ballotsCounted: row.ballotsCounted,
    cut: i + 1 <= cutSize ? "above" : "below",
  }));
}

function compareScores(a: string | null, b: string | null): number {
  if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1;
  return Number(b) - Number(a);
}

function compareIdea(a: number | null, b: number | null): number {
  if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1;
  return b - a;
}
