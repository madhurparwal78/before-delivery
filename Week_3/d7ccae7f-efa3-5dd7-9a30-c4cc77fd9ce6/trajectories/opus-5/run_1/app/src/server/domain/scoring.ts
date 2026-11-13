import type { Outcome } from '../../shared/protocol.js';
import type { QuestionSpec } from './questions.js';

export interface Submission {
  choice?: number;
  estimate?: number;
  order?: string[];
}

export interface Scored {
  points: number;
  outcome: Outcome;
  streak: number;
}

const MAX_STREAK_BONUS = 5;

/** 1000 points at the opening falling linearly to 500 at the deadline. */
function baseScore(latencyMs: number, windowMs: number): number {
  return 1000 - Math.floor((500 * latencyMs) / windowMs);
}

function withStreak(base: number, streak: number): number {
  return Math.floor((base * (10 + Math.min(streak - 1, MAX_STREAK_BONUS))) / 10);
}

/** Length of the longest strictly increasing subsequence. */
function longestIncreasingRun(positions: readonly number[]): number {
  const tails: number[] = [];
  for (const value of positions) {
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if ((tails[mid] as number) < value) low = mid + 1;
      else high = mid;
    }
    tails[low] = value;
  }
  return tails.length;
}

function estimateIsCorrect(estimate: number, answer: number, tolerance: number): boolean {
  return Math.abs(estimate - answer) <= tolerance;
}

/** Items of the submitted order mapped to their correct positions. */
function sequencePositions(order: readonly string[], correctIds: readonly string[]): number[] {
  return order.map((id) => correctIds.indexOf(id));
}

export function sequenceRun(order: readonly string[], correctIds: readonly string[]): number {
  return longestIncreasingRun(sequencePositions(order, correctIds));
}

export function scoreSubmission(
  spec: QuestionSpec,
  correctIds: readonly string[],
  submission: Submission | null,
  latencyMs: number,
  windowMs: number,
  previousStreak: number,
): Scored {
  if (submission === null) return { points: 0, outcome: 'none', streak: 0 };
  const base = baseScore(latencyMs, windowMs);
  const correct = (): Scored => {
    const streak = previousStreak + 1;
    return { points: withStreak(base, streak), outcome: 'correct', streak };
  };

  if (spec.type === 'multiple_choice') {
    return submission.choice === spec.correctIndex
      ? correct()
      : { points: 0, outcome: 'wrong', streak: 0 };
  }
  if (spec.type === 'estimate') {
    const estimate = submission.estimate;
    if (estimate !== undefined && estimateIsCorrect(estimate, spec.answer, spec.tolerance)) {
      return correct();
    }
    return { points: 0, outcome: 'wrong', streak: 0 };
  }
  const order = submission.order ?? [];
  const itemCount = correctIds.length;
  const run = sequenceRun(order, correctIds);
  if (run === itemCount) return correct();
  return { points: Math.floor((base * run) / itemCount), outcome: 'partial', streak: 0 };
}
