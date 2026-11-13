const MAX_POINTS = 1000;
const POINTS_LOST_AT_DEADLINE = 500;
const STREAK_STEPS_CAP = 5;
const TOLERANCE_EPSILON = 1e-9;

type Outcome = "correct" | "partial" | "wrong" | "none";
export type Given = { choice: number } | { estimate: number } | { order: string[] };

export type ScoredQuestion =
  | { type: "multiple_choice"; correctIndex: number }
  | { type: "estimate"; answer: number; tolerance: number }
  | { type: "sequence"; correctOrder: string[] };

export type Scored = { points: number; outcome: Outcome; streak: number; inPlace: number | null };

function basePoints(latencyMs: number, windowMs: number): number {
  return MAX_POINTS - Math.floor((POINTS_LOST_AT_DEADLINE * latencyMs) / windowMs);
}

// Length of the longest strictly increasing run of the submitted items' correct positions.
function longestOrderedRun(positions: number[]): number {
  const tails: number[] = [];
  for (const position of positions) {
    const slot = tails.findIndex((tail) => tail >= position);
    if (slot === -1) tails.push(position);
    else tails[slot] = position;
  }
  return tails.length;
}

// The run length k for a sequence answer; null for any other question type or answer.
function sequenceRun(question: ScoredQuestion, given: Given | null): number | null {
  if (question.type !== "sequence" || given === null || !("order" in given)) return null;
  return longestOrderedRun(given.order.map((id) => question.correctOrder.indexOf(id)));
}

function fullyCorrect(question: ScoredQuestion, given: Given): boolean {
  if (question.type === "multiple_choice" && "choice" in given) return given.choice === question.correctIndex;
  if (question.type === "estimate" && "estimate" in given) {
    return Math.abs(given.estimate - question.answer) <= question.tolerance + TOLERANCE_EPSILON;
  }
  return question.type === "sequence" && sequenceRun(question, given) === question.correctOrder.length;
}

// Scores one seat's answer for one question. The streak argument is the seat's streak before this question.
export function scoreAnswer(question: ScoredQuestion, given: Given | null, latencyMs: number, windowMs: number, streakBefore: number): Scored {
  if (given === null) return { points: 0, outcome: "none", streak: 0, inPlace: null };
  const base = basePoints(latencyMs, windowMs);
  const inPlace = sequenceRun(question, given);
  if (fullyCorrect(question, given)) {
    const streak = streakBefore + 1;
    const points = Math.floor((base * (10 + Math.min(streak - 1, STREAK_STEPS_CAP))) / 10);
    return { points, outcome: "correct", streak, inPlace };
  }
  if (question.type === "sequence" && inPlace !== null) {
    return { points: Math.floor((base * inPlace) / question.correctOrder.length), outcome: "partial", streak: 0, inPlace };
  }
  return { points: 0, outcome: "wrong", streak: 0, inPlace };
}
