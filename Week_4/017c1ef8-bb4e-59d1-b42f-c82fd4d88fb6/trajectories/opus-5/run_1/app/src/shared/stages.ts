import type { ApplicationState } from './format';

/** The one published application state machine. */
const ALLOWED_NEXT: Record<ApplicationState, ApplicationState[]> = {
  applied: ['viewed', 'rejected', 'withdrawn'],
  viewed: ['interviewing', 'rejected', 'withdrawn'],
  interviewing: ['offered', 'rejected', 'withdrawn'],
  offered: ['rejected'],
  rejected: [],
  withdrawn: [],
};

export function allowedNext(from: ApplicationState): ApplicationState[] {
  return ALLOWED_NEXT[from];
}

export function isLegalTransition(from: ApplicationState, to: ApplicationState): boolean {
  return ALLOWED_NEXT[from].includes(to);
}
