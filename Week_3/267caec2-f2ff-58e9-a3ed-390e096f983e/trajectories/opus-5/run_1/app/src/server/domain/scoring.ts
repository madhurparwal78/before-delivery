export interface CountedScore {
  jurorId: string;
  entryId: string;
  craft: number;
  clarity: number;
  idea: number;
  story: number;
}

export interface EntryScore {
  entryId: string;
  score: number | null;
  ideaMean: number | null;
  ballotsCounted: number;
}

const WEIGHTS = { craft: 35, clarity: 30, idea: 25, story: 10 } as const;

function weightedTotal(s: CountedScore): number {
  return (WEIGHTS.craft * s.craft + WEIGHTS.clarity * s.clarity + WEIGHTS.idea * s.idea + WEIGHTS.story * s.story) / 100;
}

/** Round half-up on the exact decimal value of the double. */
export function roundHalfUp(value: number, places: number): number {
  const exact = value.toFixed(20);
  const dot = exact.indexOf('.');
  const digits = exact.replace('-', '').replace('.', '');
  const intLength = dot - (exact.startsWith('-') ? 1 : 0);
  const keep = intLength + places;
  const next = digits.charCodeAt(keep) - 48;
  let kept = digits.slice(0, keep);
  if (next >= 5) {
    kept = (BigInt(kept) + 1n).toString().padStart(kept.length, '0');
  }
  const result = Number(kept) / 10 ** places;
  return value < 0 ? -result : result;
}

export function computeRoundScores(counted: readonly CountedScore[]): EntryScore[] {
  const byJuror = new Map<string, CountedScore[]>();
  for (const score of counted) {
    const list = byJuror.get(score.jurorId);
    if (list) list.push(score);
    else byJuror.set(score.jurorId, [score]);
  }

  const mapped = new Map<string, number[]>();
  for (const jurorScores of byJuror.values()) {
    const totals = jurorScores.map(weightedTotal);
    const mean = totals.reduce((a, b) => a + b, 0) / totals.length;
    const variance = totals.reduce((a, b) => a + (b - mean) ** 2, 0) / totals.length;
    const deviation = Math.sqrt(variance);
    jurorScores.forEach((score, index) => {
      const standard = deviation === 0 ? 0 : (totals[index] - mean) / deviation;
      const value = Math.min(10, Math.max(0, 5 + 1.5 * standard));
      const list = mapped.get(score.entryId);
      if (list) list.push(value);
      else mapped.set(score.entryId, [value]);
    });
  }

  const ideas = new Map<string, number[]>();
  for (const score of counted) {
    const list = ideas.get(score.entryId);
    if (list) list.push(score.idea);
    else ideas.set(score.entryId, [score.idea]);
  }

  const results: EntryScore[] = [];
  for (const [entryId, values] of mapped) {
    const used = [...values].sort((a, b) => a - b);
    if (used.length >= 5) {
      used.pop();
      used.shift();
    }
    const raw = used.reduce((a, b) => a + b, 0) / used.length;
    const idea = ideas.get(entryId) ?? [];
    results.push({
      entryId,
      score: roundHalfUp(raw, 2),
      ideaMean: roundHalfUp(idea.reduce((a, b) => a + b, 0) / idea.length, 4),
      ballotsCounted: values.length,
    });
  }
  return results;
}

export function formatScore(value: number | null): string | null {
  return value === null ? null : value.toFixed(2);
}
