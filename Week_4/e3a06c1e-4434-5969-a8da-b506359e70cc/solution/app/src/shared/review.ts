// Flagging, confidence bands and word error rate: decided here only.
const FLAG_BELOW = 0.85;
const MEDIUM_FROM = 0.6;

type Band = "high" | "medium" | "low";

export function band(confidence: number): Band {
  if (confidence >= FLAG_BELOW) return "high";
  return confidence >= MEDIUM_FROM ? "medium" : "low";
}

export function isFlagged(confidences: readonly number[]): boolean {
  return confidences.length > 0 && Math.min(...confidences) < FLAG_BELOW;
}

const EDGE_PUNCTUATION = /^[.,?!;:]+|[.,?!;:]+$/g;

function normalise(word: string): string {
  return word.toLowerCase().replace(EDGE_PUNCTUATION, "");
}

/** (substitutions + deletions + insertions) / reviewed words, rounded to four decimals; null with no reviewed words. */
export function wordErrorRate(machine: readonly string[], reviewed: readonly string[]): number | null {
  if (reviewed.length === 0) return null;
  const a = machine.map(normalise);
  const b = reviewed.map(normalise);
  let row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) {
      next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    row = next;
  }
  return Math.round((row[b.length] / b.length) * 10_000) / 10_000;
}

export function werText(wer: number): string {
  const basis = Math.round(wer * 10_000);
  return `${Math.floor(basis / 100)}.${String(basis % 100).padStart(2, "0")}%`;
}
