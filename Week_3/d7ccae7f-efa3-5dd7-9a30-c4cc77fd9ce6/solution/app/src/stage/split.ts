import type { PlayerQuestion, Reveal } from "../../shared/schemas";

type SplitItem = { label: string; count: number; correct: boolean };

export const LETTERS = ["A", "B", "C", "D"];

// One item per pillar: option, estimate bin or sequence bucket, in the order the reveal lists them.
export function splitItems(question: PlayerQuestion, reveal: Reveal): SplitItem[] {
  if (reveal.type === "multiple_choice" && question.type === "multiple_choice") {
    return question.options.map((option, index) => ({ label: `${LETTERS[index]}: ${option}`, count: reveal.counts[index] ?? 0, correct: index === reveal.correctIndex }));
  }
  if (reveal.type === "estimate") {
    return reveal.bins.map((bin, index) => ({ label: `${bin.from} to ${bin.to}`, count: bin.count, correct: reveal.inBandBins.includes(index) }));
  }
  if (reveal.type === "sequence") {
    return reveal.buckets.map((count, index) => ({ label: `${index} in place`, count, correct: index === reveal.buckets.length - 1 }));
  }
  return [];
}

// Share of all counts, halves rounded up; every share is 0 when nothing was counted.
export function share(count: number, total: number): number {
  return total === 0 ? 0 : Math.floor((count * 200 + total) / (2 * total));
}
