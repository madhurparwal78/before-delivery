/** A refusal the caller sees as `{"error": text}` with this status. */
export class Refusal extends Error {
  constructor(
    readonly status: number,
    text: string,
  ) {
    super(text);
  }
}

export const NOT_FOUND = 'Not found.';
export const SIGN_IN_FIRST = 'Sign in first.';
export const TEACHER_ONLY = 'Only the teacher can do that.';
export const BUS_PAUSED = 'Live updates are paused. Try again in a moment.';
export const STORAGE_SAVE = "Files can't be saved right now. Try again in a minute.";
export const STORAGE_LOAD = "Files can't be loaded right now. Try again in a minute.";
export const BREAKOUTS_OVER = 'Breakouts are over.';

export function notFound(): Refusal {
  return new Refusal(404, NOT_FOUND);
}
