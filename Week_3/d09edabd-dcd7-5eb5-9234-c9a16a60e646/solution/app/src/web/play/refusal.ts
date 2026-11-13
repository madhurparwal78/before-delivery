import { ApiFailure } from '../api';

const WRONG_ANSWER = "That's not it.";
const NOT_YET = 'Something else has to happen first.';
const UNREACHABLE = "Can't reach the server.";

/** The message of any refusal: its first field message, else its error code in words. */
export function refusalMessage(failure: unknown): string {
  if (!(failure instanceof ApiFailure)) return UNREACHABLE;
  return Object.values(failure.fieldErrors)[0] ?? failure.code.replaceAll('_', ' ');
}

/** What a refused solve says to the tester. */
export function solveRefusal(failure: unknown): string {
  if (failure instanceof ApiFailure) {
    if (failure.fieldErrors.answer) return WRONG_ANSWER;
    if (failure.code === 'prerequisites_unsolved') return NOT_YET;
  }
  return refusalMessage(failure);
}
