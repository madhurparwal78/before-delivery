import type { PollResult } from '../../shared/wire';

/** Each option's share of all answers, rounded half up to a whole number; no answers is 0%. */
export function tally(options: string[], counts: number[]): { total: number; results: PollResult[] } {
  const total = counts.reduce((sum, count) => sum + count, 0);
  const results = options.map((option, index) => {
    const count = counts[index] ?? 0;
    return { option, count, percent: total === 0 ? 0 : Math.floor((200 * count + total) / (2 * total)) };
  });
  return { total, results };
}

/** The answers hash of Valkey (learner to option text) as learner to option number. */
export function answersFrom(hash: Record<string, string>): Record<string, number> {
  return Object.fromEntries(Object.entries(hash).map(([learnerId, option]) => [learnerId, Number(option)]));
}

/** The live count of each option, from the Valkey hash of option number to count. */
export function countsFrom(optionCount: number, hash: Record<string, string>): number[] {
  return Array.from({ length: optionCount }, (_, index) => Number(hash[String(index + 1)] ?? 0));
}
