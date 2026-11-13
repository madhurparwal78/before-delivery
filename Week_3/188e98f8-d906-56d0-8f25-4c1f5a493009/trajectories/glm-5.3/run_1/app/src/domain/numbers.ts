import { QUESTIONS_PER_ROUND, TOTAL_ROUNDS } from "./constants";

export function isRoundNumber(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= TOTAL_ROUNDS;
}

export function isQuestionNumber(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= QUESTIONS_PER_ROUND;
}
