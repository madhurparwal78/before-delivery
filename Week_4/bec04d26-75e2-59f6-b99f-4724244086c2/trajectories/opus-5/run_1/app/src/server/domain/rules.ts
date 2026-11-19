import { isUnfiled } from '../../shared/status';
import { ReturnStatus } from '../../shared/types';

export { isUnfiled };

export type ReturnAction =
  | 'save_amounts'
  | 'prepare'
  | 'approve'
  | 'send_back'
  | 'file'
  | 'extension'
  | 'amend';

export interface MoveSubject {
  status: ReturnStatus;
  awaiting_approval: boolean;
  extended: boolean;
}

/**
 * The status move table. Every legal move for every action lives here and
 * nowhere else; an action absent from the table answers `illegal_status`.
 */
export function isLegalMove(action: ReturnAction, subject: MoveSubject): boolean {
  switch (action) {
    case 'save_amounts':
      return subject.status === 'not_started' || subject.status === 'prepared';
    case 'prepare':
      return subject.status === 'not_started';
    case 'approve':
      return subject.status === 'prepared' && subject.awaiting_approval;
    case 'send_back':
      return (
        (subject.status === 'prepared' && subject.awaiting_approval) ||
        subject.status === 'client_approved'
      );
    case 'file':
      return subject.status === 'client_approved';
    case 'extension':
      return isUnfiled(subject.status) && !subject.extended;
    case 'amend':
      return subject.status === 'filed' || subject.status === 'packeted';
  }
}

/**
 * The overdue edge: unfiled and the practice's current instant strictly after
 * the deadline. At the deadline itself a return is not overdue.
 */
export function isOverdue(status: ReturnStatus, dueAtMs: number, nowMs: number): boolean {
  return isUnfiled(status) && nowMs > dueAtMs;
}

/**
 * The extension edge: granted at the deadline instant itself, refused one
 * millisecond later.
 */
export function extensionAllowed(dueAtMs: number, nowMs: number): boolean {
  return nowMs <= dueAtMs;
}
