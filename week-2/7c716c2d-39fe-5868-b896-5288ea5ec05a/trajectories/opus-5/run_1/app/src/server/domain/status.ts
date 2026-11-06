import type { IssueStatus } from '../../shared/types.js';

export const STATUS_ORDER: readonly IssueStatus[] = [
  'backlog',
  'todo',
  'in_progress',
  'in_review',
  'done',
  'cancelled',
];

export const STATUS_LABELS: Record<IssueStatus, string> = {
  backlog: 'Backlog',
  todo: 'Todo',
  in_progress: 'In progress',
  in_review: 'In review',
  done: 'Done',
  cancelled: 'Cancelled',
};

const edges: Record<IssueStatus, readonly IssueStatus[]> = {
  backlog: ['todo', 'cancelled'],
  todo: ['backlog', 'in_progress', 'cancelled'],
  in_progress: ['todo', 'in_review', 'cancelled'],
  in_review: ['in_progress', 'done', 'cancelled'],
  done: ['in_progress'],
  cancelled: ['backlog'],
};

export function isIssueStatus(value: unknown): value is IssueStatus {
  return typeof value === 'string' && (STATUS_ORDER as readonly string[]).includes(value);
}

export function legalNextStatuses(from: IssueStatus): IssueStatus[] {
  const allowed = edges[from];
  return STATUS_ORDER.filter((status) => allowed.includes(status));
}

export function isLegalTransition(from: IssueStatus, to: IssueStatus): boolean {
  return edges[from].includes(to);
}

export function isClosedStatus(status: IssueStatus): boolean {
  return status === 'done' || status === 'cancelled';
}
