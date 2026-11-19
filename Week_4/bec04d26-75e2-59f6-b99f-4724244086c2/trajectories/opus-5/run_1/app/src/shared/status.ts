import { ReturnStatus } from './types';

/** The statuses a return can still be overdue, extended or reminded in. */
export function isUnfiled(status: ReturnStatus): boolean {
  return status === 'not_started' || status === 'prepared' || status === 'client_approved';
}

/** A band strip's past mark: the now line has reached or passed the deadline. */
export function isPast(dueAtMs: number, nowMs: number): boolean {
  return nowMs >= dueAtMs;
}
